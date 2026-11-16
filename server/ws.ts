/**
 * A small WebSocket (RFC 6455) server endpoint on node:http, so the game
 * server has no third-party dependencies. Text frames only, no extensions,
 * messages capped at 64 KB, ping/pong heartbeat to notice dead connections.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

export class WsSocket {
  onMessage: (text: string) => void = () => {};
  onClose: (code: number) => void = () => {};
  /** Set by pong frames; cleared by the heartbeat. */
  alive = true;
  private buf: Buffer = Buffer.alloc(0);
  private frags: Buffer[] = [];
  private fragBytes = 0;
  private closed = false;
  private readonly sock: Duplex;

  constructor(sock: Duplex) {
    this.sock = sock;
    sock.on('data', (d: Buffer) => this.feed(d));
    sock.on('close', () => this.finish(1006));
    sock.on('error', () => this.finish(1006));
  }

  get open(): boolean {
    return !this.closed;
  }

  feed(d: Buffer): void {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.closed || this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      if (b0 & 0x70) return this.close(1002); // no extensions were negotiated
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.close(1009);
        len = this.buf.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (!masked) return this.close(1002); // browsers always mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        this.close(code);
        return;
      }
      if (op === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (op === 0xa) {
        this.alive = true;
        continue;
      }
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.frags.push(payload);
        this.fragBytes += payload.length;
        if (this.fragBytes > MAX_MESSAGE) return this.close(1009);
        if (fin) {
          const all = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
          this.frags = [];
          this.fragBytes = 0;
          try {
            this.onMessage(all.toString('utf8'));
          } catch (e) {
            console.error('[ws] handler error', e);
          }
        }
        continue;
      }
      return this.close(1002);
    }
  }

  private frame(op: number, payload: Buffer): void {
    if (this.closed) return;
    const len = payload.length;
    let head: Buffer;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeUInt32BE(0, 2);
      head.writeUInt32BE(len, 6);
    }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(text: string): void {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  ping(): void {
    this.frame(0x9, Buffer.alloc(0));
  }

  close(code = 1000): void {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code === 1005 || code === 1006 ? 1000 : code, 0);
    this.frame(0x8, p);
    this.sock.end();
    this.finish(code);
  }

  /** Drop the connection without a handshake (dead peer). */
  terminate(): void {
    this.sock.destroy();
    this.finish(1006);
  }

  private finish(code: number): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(code);
  }
}

/** Complete the HTTP upgrade. Returns null if the request isn't a WebSocket handshake. */
export function acceptUpgrade(req: IncomingMessage, sock: Duplex, head: Buffer): WsSocket | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  (sock as unknown as { setNoDelay?: (b: boolean) => void }).setNoDelay?.(true);
  const ws = new WsSocket(sock);
  if (head.length) ws.feed(head);
  return ws;
}
