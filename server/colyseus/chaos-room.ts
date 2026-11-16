/**
 * The authoritative game room. Colyseus handles connections, matchmaking and
 * reconnection; the shared TableHost decides everything about the game. The
 * room's id is the short code players type to join.
 */
import { Room } from 'colyseus';
import type { Client } from 'colyseus';
import { TableHost, makeCode } from '../../shared/table-host.ts';
import type { ClientMsg, Profile } from '../../shared/protocol.ts';

/** Codes in use on this server process. */
const live = new Set<string>();

/** Seconds a dropped player may take to come back before a computer takes their seat for good. */
export const RECONNECT_SECONDS = 90;

export class ChaosRoom extends Room {
  maxClients = 4;
  table!: TableHost;
  private lastPose = new Map<string, number>();

  onCreate(): void {
    let code = makeCode(Math.random);
    while (live.has(code)) code = makeCode(Math.random);
    live.add(code);
    this.roomId = code;
    this.table = new TableHost(code, {
      send: (id, type, msg) => this.clientById(id)?.send(type, msg),
      schedule: (fn, ms) => {
        const d = this.clock.setTimeout(fn, ms);
        return () => d.clear();
      },
      now: () => Date.now(),
      seed: () => Math.floor(Math.random() * 2 ** 31),
    });

    this.onMessage('msg', (client: Client, m: ClientMsg) => {
      if (!m || typeof m !== 'object') return;
      this.table.handle(client.sessionId, m);
      // nobody can join a game in progress
      if (this.table.phase === 'game') void this.lock();
      else if (this.clients.length < 4) void this.unlock();
    });
    this.onMessage('sync', (client: Client) => this.table.sync(client.sessionId));

    // presence: relayed to everyone else, stamped with the sender's seat
    this.onMessage('pose', (client: Client, p: Record<string, unknown>) => {
      const seat = this.table.seatOf(client.sessionId);
      if (seat < 0) return;
      // cap relayed pose traffic at ~30 Hz per player
      const now = Date.now();
      if (now - (this.lastPose.get(client.sessionId) ?? 0) < 30) return;
      this.lastPose.set(client.sessionId, now);
      this.broadcast('pose', { ...p, seat }, { except: client });
    });
    this.onMessage('emote', (client: Client, e: Record<string, unknown>) => {
      const seat = this.table.seatOf(client.sessionId);
      if (seat >= 0) this.broadcast('emote', { kind: e.kind, seat });
    });
    this.onMessage('prank', (client: Client, p: Record<string, unknown>) => {
      const seat = this.table.seatOf(client.sessionId);
      const target = Number(p.target);
      const victim = this.table.seats[target];
      // a player who has switched pranks off is never targeted
      if (seat < 0 || !victim || !victim.pranks) return;
      this.broadcast('prank', { ...p, seat });
    });
    // WebRTC voice signalling: offers, answers and ICE candidates between two players
    this.onMessage('rtc', (client: Client, m: { to: string; data: unknown }) => {
      const to = this.clientById(String(m?.to));
      if (to) to.send('rtc', { from: client.sessionId, to: to.sessionId, data: m.data });
    });
  }

  private clientById(id: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === id);
  }

  onJoin(client: Client, options: { profile?: Profile; pranks?: boolean }): void {
    const profile: Profile = options?.profile ?? { name: 'Player', look: [] };
    const seat = this.table.join(client.sessionId, profile, options?.pranks !== false);
    if (seat < 0) throw new Error('This table is full or already playing.');
    this.table.sync(client.sessionId);
  }

  async onLeave(client: Client, consented?: boolean | number): Promise<void> {
    const deliberate = consented === true || consented === 1000 || consented === 4000;
    if (deliberate) {
      this.table.leave(client.sessionId);
      return;
    }
    this.table.drop(client.sessionId);
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      this.table.reconnect(client.sessionId);
      this.table.sync(client.sessionId);
    } catch {
      this.table.leave(client.sessionId);
    }
  }

  onDispose(): void {
    live.delete(this.roomId);
    this.table.dispose();
  }
}
