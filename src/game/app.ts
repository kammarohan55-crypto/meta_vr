/**
 * CHAOS TABLE: the game client. Screens, the table connection, the event
 * timeline that turns host events into animations and effects, and the
 * per-frame update. Engine-agnostic: the IWSDK system (../chaos-system.ts)
 * feeds it head and hand data and renders `root`.
 */
import { BackSide, Group, Mesh, MeshBasicMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import type { Difficulty } from '../../shared/ai.ts';
import type { EmoteKind, EmoteMsg, EventsMsg, LobbyMsg, PoseMsg, PrankKind, PrankMsg, Profile, RtcMsg, SeatInfo, ViewMsg } from '../../shared/protocol.ts';
import type { Card, Color, GameEvent, HouseRules } from '../../shared/rules.ts';
import { CODE_CHARS, isCode } from '../../shared/table-host.ts';
import { NAME_MAX, cleanName } from '../../shared/names.ts';
import { Sound } from './audio.js';
import { Cast, HAIR_STYLES, HumanAvatar, HAIR, OUTFIT, PersonAvatar, RobotAvatar, SKIN, personFor } from './avatars.js';
import { PEOPLE, castSize, createPersonRig, loadPeople, peopleReady } from './people.js';
import { COLOR_HEX, COLOR_LABEL, drawCardTo, makePosterCanvas } from './cards.js';
import { Lounge, TABLE_Y } from './env.js';
import { Frostpeak } from './frostpeak.js';
import { AnimeArena } from './arena.js';
import { MIXED_REALITY, PENTHOUSE, SETTINGS_KEY, WORLDS, savedWorld, setSavedWorld, useHeroes, worldInfo, type WorldName } from './world-choice.js';
import { heroTitle } from './heroes.js';
import { LocalTable, OnlineTable, serverAvailable } from './net.js';
import type { TableConn, TableListener } from './net.js';
import { Pranks } from './pranks.js';
import { Magic } from './magic.js';
import { HandInput, PILE, Tabletop } from './tabletop.js';
import { Button, Panel, drawButton, glass, roundRect, row, text } from './ui.js';
import { EMOTE_ICONS, GLYPHS, TOY_ICONS, drawIcon, iconTile, initialIcon } from './icons.js';
import type { Icon } from './icons.js';
import { ColorPicker, Effects } from './vfx.js';
import { Voice } from './voice.js';
import type { Warmup } from './warmup.js';
import { shareDepthMaterials, singlePassTransparent } from './draw-tuning.js';
import { faceTablePoint, setTableRoot } from './util.js';

type Screen = 'title' | 'solo' | 'join' | 'connecting' | 'lobby' | 'avatar' | 'name' | 'settings' | 'arena' | 'game' | 'pause' | 'results' | 'error';

const artCache = new Map<string, HTMLImageElement | null>();
/** Arena card art, loaded once; `onReady` repaints when it arrives. */
function arenaArt(path: string, onReady: () => void): HTMLImageElement | null {
  if (artCache.has(path)) return artCache.get(path) ?? null;
  artCache.set(path, null);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    artCache.set(path, img);
    onReady();
  };
  img.src = `${(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL}${path}`;
  return null;
}

/** One line about each hero (same order as HEROES), shown on the avatar card. */
const HERO_LINES = ['Never folds. Never bluffs.', 'Reads the deck like a spellbook.', 'Quick hands, quicker grin.', 'Plays every card like a hammer.', 'Lucky, and knows it.'];

/** Did the head, hands or voice move enough since the last pose to be worth sending? */
function poseMoved(a: PoseMsg | null, b: PoseMsg): boolean {
  if (!a || a.l.length !== b.l.length || a.r.length !== b.r.length) return true;
  const far = (x: number[], y: number[], eps: number) => x.some((v, i) => Math.abs(v - y[i]) > eps);
  // ~6 mm of position or ~0.6 degrees of head turn, hands or voice level
  return far(a.h, b.h, 0.006) || far(a.l, b.l, 0.006) || far(a.r, b.r, 0.006) || Math.abs(a.v - b.v) > 0.05;
}

/** Which menu sound a button makes: back and close are lower, starting things rises, settings pluck. */
function uiKind(id: string): 'press' | 'back' | 'confirm' | 'toggle' {
  if (id === 'back' || id === 'leave' || id === 'close' || id === 'done' || id === 'del' || id === 'lobby') return 'back';
  if (id === 'start' || id === 'go' || id === 'ready' || id === 'rematch' || id === 'host' || id === 'tutorial' || id === 'vr' || id === 'mr' || id.startsWith('w:')) return 'confirm';
  if (['until', 'stack', 'timer', 'rfx', 'rflash', 'pranks', 'tut', 'mic'].includes(id) || /[-+]$/.test(id) || id.startsWith('opp') || id.startsWith('dif:') || id.startsWith('ai:')) return 'toggle';
  return 'press';
}

/** Build the world around the table by name. */
function makeWorld(w: WorldName): Lounge | Frostpeak | AnimeArena {
  if (w === 'lounge') return new Lounge();
  if (w === 'frostpeak') return new Frostpeak();
  return new AnimeArena(w);
}

export interface Settings {
  master: number;
  fx: number;
  music: number;
  voice: number;
  reducedEffects: boolean;
  reducedFlashing: boolean;
  pranks: boolean;
  tableHeight: number;
  tutorial: boolean;
  name: number;
  /** The name the player typed ('' until they do: one of NAMES stands in). */
  nameText: string;
  look: number[];
  /** Which world surrounds the table. */
  world: WorldName;
}

/** Badge colours for the seats you can throw a toy at. */
const TARGET_COLORS = ['#c0564b', '#3f8f6b', '#4a78c2', '#b58a2e'];
const NAMES = ['Aarav', 'Meera', 'Rohan', 'Sara', 'Kabir', 'Zoya', 'Leo', 'Maya', 'Kai', 'Ivy', 'Arjun', 'Noor', 'Dev', 'Tara'];
const KEY = SETTINGS_KEY;
/** Reactions, with the caption under each one's picture (the pictures are drawn in icons.ts). */
const EMOTES: [EmoteKind, string][] = [
  ['laugh', 'Laugh'],
  ['clap', 'Clap'],
  ['point', 'Point'],
  ['facepalm', 'Oh no'],
  ['cheer', 'Cheer'],
  ['angry', 'Grr'],
  ['cool', 'Cool'],
  ['cry', 'Sob'],
];
/** Toys to throw: the short caption on the action bar, and the full name. */
const TOYS: [PrankKind, string, string][] = [
  ['dart', 'Dart', 'Foam dart'],
  ['chicken', 'Chicken', 'Rubber chicken'],
  ['snowball', 'Snowball', 'Snowball'],
  ['pie', 'Pie', 'Cream pie'],
  ['hammer', 'Hammer', 'Squeaky hammer'],
  ['confetti', 'Confetti', 'Confetti'],
];

/** One frame of tracking, already converted to table space by the host system. */
export interface FrameInput {
  head: Vector3;
  headQ: Quaternion;
  hands: Record<'left' | 'right', { pos: Vector3 | null; pinching: boolean; started: boolean; ended: boolean; /** wrist + fingertips in table space (PoseMsg layout) */ joints: number[] | null }>;
  immersive: boolean;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _UP_CAPTION = new Vector3(0, 0.14, 0);
const _UP_MAGIC = new Vector3(0, 0.32, 0.02);
const _UP_STACK = new Vector3(0, 0.36, 0);
const _UP_TAKE = new Vector3(0, 0.3, 0);
const _UP_LAST = new Vector3(0, 0.06, 0);

/** Plain-language name of a card: Red 7, Blue Skip, Wild +4. */
function cardName(c: Card): string {
  const colour = c.color >= 0 ? COLOR_LABEL[c.color as 0 | 1 | 2 | 3] + ' ' : '';
  switch (c.kind) {
    case 'num': return colour + c.value;
    case 'skip': return colour + 'Skip';
    case 'reverse': return colour + 'Reverse';
    case 'draw2': return colour + '+2';
    case 'wild': return 'Wild';
    case 'wild4': return 'Wild +4';
  }
}
const _q = new Quaternion();
const _q2 = new Quaternion();

export class ChaosApp {
  /** Everything, in table space. Place this where the table should stand. */
  readonly root = new Group();
  /** The world around the table (Frostpeak by default; the penthouse lounge is kept as an option). */
  lounge: Lounge | Frostpeak | AnimeArena = makeWorld(savedWorld());
  readonly table: Tabletop;
  readonly cast = new Cast();
  private mascot = new RobotAvatar(0x7dd3fc);
  private mascotStand = new Group();
  readonly fx = new Effects();
  /** Summoning circles, light pillars and the stack counter for special cards. */
  readonly magic = new Magic();
  readonly picker = new ColorPicker();
  readonly sound = new Sound();
  /** GPU warm-up; set by the host system, which owns the renderer. */
  warmup: Warmup | null = null;
  /** A dark sphere round your head that covers a world change while the new world gets ready. */
  private veilMat = new MeshBasicMaterial({ color: 0x06070c, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: BackSide, fog: false, toneMapped: false });
  private veil = new Mesh(new SphereGeometry(0.35, 24, 12), this.veilMat);
  /** A world change in progress: cover, build and compile out of sight, then reveal. */
  private swap: { name: WorldName; phase: 'cover' | 'warm' | 'show' | 'reveal'; t: number; frames: number; ready: boolean; held: Object3D[] } | null = null;
  private swapNext: WorldName | null = null;
  private builtWorld: WorldName = savedWorld();
  readonly pranks: Pranks;
  voice: Voice | null = null;
  readonly panel = new Panel('menu', 0.86, 0.60);
  readonly dock = new Panel('dock', 0.44, 0.1);
  readonly hint = new Panel('hint', 0.4, 0.07);
  private preview: HumanAvatar | PersonAvatar | null = null;

  screen: Screen = 'title';
  private back: Screen = 'title';
  settings: Settings;
  conn: TableConn | null = null;
  lobby: LobbyMsg | null = null;
  view: ViewMsg | null = null;
  private pendingView: ViewMsg | null = null;
  private queue: GameEvent[] = [];
  private wait = 0;
  private code = '';
  private error = '';
  private status = '';
  private solo = { opponents: 3, difficulty: 'normal' as Difficulty, drawUntil: false, timer: 0, stack: true };
  /** Viewer head, in table space. */
  readonly viewer = new Vector3(0, 1.2, 0.98);
  private viewerFwd = new Vector3(0, -0.3, -1);
  private time = 0;
  private poseClock = 0;
  /** The action bar's open tray: reactions, toys, or who to throw the chosen toy at. */
  private tray: '' | 'emote' | 'toy' | 'target' = '';
  private toyKind: PrankKind = 'dart';
  /** Someone just hit you with a Draw card or a skip: one tap throws a toy back at them. */
  private revengeSeat = -1;
  private revengeUntil = 0;
  /** Who played the last card (a skip's victim can throw back at them). */
  private lastPlayer = -1;
  private hintText = '';
  private resultsAt = 0;
  private tutorialStep = 0;
  /** Set when the world should enter XR (the host system calls launchXR). */
  onEnterXR: ((mr: boolean) => void) | null = null;
  /** Re-seat the player at the table (pause menu). */
  onRecenter: (() => void) | null = null;
  mixedReality = false;

  constructor() {
    this.root.name = 'ChaosTable';
    setTableRoot(this.root);
    this.settings = this.loadSettings();
    this.table = new Tabletop({
      play: (card) => this.onLocalPlay(card),
      draw: () => this.send({ t: 'act', action: { type: 'draw' } }),
      // long enough to read: about fifteen characters a second, never under 2.4 s
      nope: (reason) => this.showHint(reason, Math.max(2.4, reason.length * 0.07)),
      sound: (k) => {
        const at = this.table.fanCenter;
        if (k === 'pick') this.sound.cardPick(at);
        else if (k === 'slide') this.sound.cardSlide(at);
        else if (k === 'place') this.sound.cardPlace(PILE);
        else if (k === 'flick') this.sound.cardFlick(at);
        else if (k === 'nope') this.sound.nope();
        else this.sound.hover();
      },
    });
    this.table.onReveal = (seat, card, at) => this.captionPlay(seat, card, at);

    this.pranks = new Pranks(this.sound, this.fx);
    this.root.add(this.lounge.root, this.table.group, this.cast.group, this.fx.group, this.magic.group, this.picker.group, this.pranks.group);
    this.root.add(this.panel.group, this.dock.group, this.hint.group);
    this.veil.name = 'WorldVeil';
    this.veil.renderOrder = 10000;
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    this.veil.raycast = () => {};
    this.root.add(this.veil);
    // the table's little mascot: it watches the game and reacts with everyone else
    this.mascot.plate.mesh.visible = false;
    this.mascot.root.position.set(0, -0.76, -1.0);
    // the mascot is a dozen small primitives: only its two largest parts cast a shadow
    const parts: { o: Object3D; r: number }[] = [];
    this.mascot.root.traverse((o) => {
      o.raycast = () => {};
      o.castShadow = false;
      const g = (o as Mesh).geometry;
      if ((o as Mesh).isMesh && g) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        parts.push({ o, r: (g.boundingSphere?.radius ?? 0) * o.scale.x });
      }
    });
    parts.sort((a, b) => b.r - a.r).slice(0, 2).forEach((p) => (p.o.castShadow = true));
    this.mascotStand.add(this.mascot.root);
    this.mascotStand.scale.setScalar(0.3);
    this.mascotStand.position.set(-0.4, TABLE_Y + 0.004, 0.1);
    this.mascotStand.rotation.y = Math.PI + 0.42;
    this.root.add(this.mascotStand);
    this.panel.setBackdropImage(worldInfo(savedWorld()).art);
    this.panel.group.position.set(0, TABLE_Y + 0.42, 0.12);
    this.panel.group.rotation.x = -0.12;
    this.layoutBars();
    this.hint.visible = false;
    this.dock.visible = false;
    // a desk keyboard types into the name and table-code screens
    window.addEventListener('keydown', (e) => this.onKey(e));
    // cards and piles are clickable as well as pinchable
    const tm = this.table.drawHit as unknown as { addEventListener(t: string, f: () => void): void };
    tm.addEventListener('click', () => {
      const v = this.view;
      if (v && v.phase === 'play' && v.current === v.seat && !v.hasDrawn && this.table.clickAllowed()) this.send({ t: 'act', action: { type: 'draw' } });
    });
    for (const p of this.picker.petals) {
      (p as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('click', () => this.pickColor(p.userData.color as Color));
    }
    // audio is made and decoded now, while the world loads, not on the first click
    this.sound.boot();
    this.applySettings();
    this.sound.playTrack(worldInfo(savedWorld()).music);
    this.show('title');
    void loadPeople().then((ok) => {
      if (!ok) return;
      if (this.lobby) this.cast.sync(this.lobby.seats, this.mySeat());
      if (this.screen === 'avatar') this.renderAvatar();
      this.syncMenuCast();
    });
  }

  // ------------------------------------------------------------ settings

  private loadSettings(): Settings {
    const d: Settings = { master: 0.9, fx: 0.9, music: 0.55, voice: 1, reducedEffects: false, reducedFlashing: false, pranks: true, tableHeight: 0, tutorial: true, nameText: '', name: Math.floor(Math.random() * NAMES.length), look: [Math.floor(Math.random() * 3), 0, 1, 0], world: 'frostpeak' };
    try {
      const s = { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
      // a world saved by an earlier build that this one does not offer
      if (!WORLDS.some((w) => w.id === s.world)) s.world = 'frostpeak';
      return s;
    } catch {
      return d;
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
  }

  private applySettings(): void {
    const s = this.settings;
    this.sound.volumes = { master: s.master, fx: s.fx, music: s.music, voice: s.voice };
    this.sound.applyVolumes();
    this.fx.settings = { reducedEffects: s.reducedEffects, reducedFlashing: s.reducedFlashing };
    this.magic.settings = { reducedEffects: s.reducedEffects, reducedFlashing: s.reducedFlashing };
    this.panel.reducedMotion = this.dock.reducedMotion = this.hint.reducedMotion = s.reducedEffects || s.reducedFlashing;
    this.lounge.setReducedMotion(s.reducedEffects || s.reducedFlashing);
    this.cast.setReducedMotion(s.reducedEffects || s.reducedFlashing);
    if (this.self) this.self.motionScale = s.reducedEffects || s.reducedFlashing ? 0 : 1;
    this.fanHomeY = TABLE_Y + 0.25 + s.tableHeight;
    this.table.fanCenter.y = Math.min(this.table.fanCenter.y, this.fanHomeY);
    if (this.table.fanCenter.y < TABLE_Y + 0.1) this.table.fanCenter.y = this.fanHomeY;
  }

  /** Where your fan sits when nothing is in the way (the table-height preference raises it). */
  private fanHomeY = TABLE_Y + 0.25;

  /**
   * Keep your own fan's top edge under your line of sight to the discard pile and deck,
   * so a low seated head never loses the table behind its own cards. It follows the head
   * slowly, so the hand does not bob with every small movement.
   */
  private placeFan(dt: number): void {
    const fan = this.table.fanCenter;
    const run = this.viewer.z - PILE.z;
    let want = this.fanHomeY;
    if (run > 0.25) {
      const k = (this.viewer.z - fan.z) / run;
      const sight = this.viewer.y + (PILE.y - this.viewer.y) * k;
      // the top edge of a raised card sits about 6 cm above the fan centre, plus a margin
      want = Math.max(TABLE_Y + 0.12, Math.min(this.fanHomeY, sight - 0.085));
    }
    fan.y += (want - fan.y) * (1 - Math.exp(-dt * 1.5));
    if (Math.abs(fan.y - this.fanLaidY) > 0.002) {
      this.fanLaidY = fan.y;
      this.table.relayoutHand();
    }
  }
  private fanLaidY = 0;

  profile(): Profile {
    return { name: cleanName(this.settings.nameText) || NAMES[this.settings.name % NAMES.length], look: this.settings.look.slice() };
  }

  // ------------------------------------------------------------ connection

  private listener(): TableListener {
    return {
      lobby: (m) => this.onLobby(m),
      view: (m) => this.onView(m),
      events: (m) => this.onEvents(m),
      reject: (m) => {
        // the host refused a play: every card still waiting goes back to the fan
        for (const hc of this.table.hand.values()) if (hc.pending) this.table.returnCard(hc.card.id, m.error);
        this.picker.hide();
        if (m.view) this.onView(m.view);
      },
      pose: (m) => this.cast.pose(m),
      emote: (m) => this.onEmote(m),
      prank: (m) => this.onPrank(m),
      rtc: (m: RtcMsg) => void this.voice?.signal(m.from, m.data as never),
      status: (s, detail) => {
        if (s === 'lost') {
          this.error = detail === 'the host closed the table' ? 'The host closed the table.' : `Connection lost${detail ? ` (${detail})` : ''}. Check the network and join again.`;
          this.leaveTable(false);
          this.show('error');
        } else if (s === 'reconnecting') {
          this.status = 'Reconnecting…';
          this.showHint('Connection dropped. Reconnecting…', 6);
        } else {
          this.status = '';
        }
      },
    };
  }

  private send(m: Parameters<TableConn['send']>[0]): void {
    this.conn?.send(m);
  }

  startSolo(): void {
    this.sound.unlock();
    this.leaveTable(false);
    const local = new LocalTable(this.listener(), this.profile());
    this.conn = local;
    const host = local.host;
    host.rules = { drawUntilPlayable: this.solo.drawUntil, turnSeconds: this.solo.timer, stacking: this.solo.stack };
    for (let i = 1; i <= this.solo.opponents; i++) {
      // opponents sit opposite first (seat 2), then left and right
      const seat = this.solo.opponents === 1 ? 2 : this.solo.opponents === 2 ? [1, 3][i - 1] : i;
      host.setAi(seat, true, this.solo.difficulty);
    }
    host.start();
    this.tutorialStep = this.settings.tutorial ? 1 : 0;
  }

  /**
   * Open a private table for friends. With a game server it lives there; without one (plain
   * file hosting, or a dev run without the server) this browser hosts it and friends anywhere
   * connect to it directly with the same room code.
   */
  async hostOnline(): Promise<void> {
    this.sound.unlock();
    this.leaveTable(false);
    const attempt = ++this.connectAttempt;
    this.status = 'Opening your private table…';
    this.show('connecting');
    try {
      const server = await serverAvailable();
      if (attempt !== this.connectAttempt) return;
      const conn = server
        ? await OnlineTable.host(this.listener(), this.profile(), this.settings.pranks)
        : await OnlineTable.hostDirect(this.listener(), this.profile(), this.settings.pranks);
      if (attempt !== this.connectAttempt) return conn.leave();
      this.conn = conn;
      await this.startVoice();
    } catch (e) {
      if (attempt !== this.connectAttempt) return;
      this.error = `${(e as Error).message ?? 'Could not open a table.'} Solo play always works.`;
      this.show('error');
    }
  }
  /**
   * Quick match: a seat at any public table that is filling, or a new one. Strangers need a
   * meeting point, so this uses the game server (the free cloud server once deployed, or
   * `npm run dev:all` locally); Play with friends works without one.
   */
  async quickMatch(): Promise<void> {
    this.sound.unlock();
    this.leaveTable(false);
    const attempt = ++this.connectAttempt;
    this.status = 'Finding a table…';
    this.show('connecting');
    try {
      const server = await serverAvailable();
      if (attempt !== this.connectAttempt) return;
      if (!server) {
        this.error = 'Quick match needs the online game server, which this copy of the game can\u2019t reach. Play with friends works anywhere: share your room code.';
        this.show('error');
        return;
      }
      const conn = await OnlineTable.quick(this.listener(), this.profile(), this.settings.pranks);
      if (attempt !== this.connectAttempt) return conn.leave();
      this.conn = conn;
      await this.startVoice();
    } catch (e) {
      if (attempt !== this.connectAttempt) return;
      this.error = `${(e as Error).message ?? 'Could not find a table.'} Solo play always works.`;
      this.show('error');
    }
  }

  /** Bumped by every connection attempt and by Cancel, so a late result can tell it is stale. */
  private connectAttempt = 0;

  async joinOnline(code: string): Promise<void> {
    this.sound.unlock();
    this.leaveTable(false);
    const attempt = ++this.connectAttempt;
    this.status = `Finding table ${code}…`;
    this.show('connecting');
    try {
      // a code can belong to a table on the server or to one a friend hosts in their browser
      const server = await serverAvailable();
      let conn: OnlineTable | null = null;
      if (server && attempt === this.connectAttempt) {
        try {
          conn = await OnlineTable.join(code, this.listener(), this.profile(), this.settings.pranks);
        } catch (e) {
          if ((e as { reason?: string }).reason !== 'not-found') throw e;
        }
      }
      if (attempt !== this.connectAttempt) return conn?.leave();
      if (!conn) {
        this.status = `Connecting to your friend\u2019s table ${code}…`;
        if (this.screen === 'connecting') this.show('connecting');
        conn = await OnlineTable.joinDirect(code, this.listener(), this.profile(), this.settings.pranks);
      }
      if (attempt !== this.connectAttempt) return conn.leave();
      this.conn = conn;
      await this.startVoice();
    } catch (e) {
      if (attempt !== this.connectAttempt) return;
      this.error = String((e as Error).message ?? e);
      this.show('error');
    }
  }

  private async startVoice(): Promise<void> {
    if (!this.conn?.online) return;
    const conn = this.conn;
    this.voice = new Voice(this.sound, (to, data) => conn.rtc(to, data));
    const ok = await this.voice.start(conn.id);
    if (!ok) this.showHint(this.voice.problem + ' You can still play; voice is off.', 4);
  }

  leaveTable(toTitle = true): void {
    this.timers = [];
    this.conn?.leave();
    this.conn = null;
    this.voice?.stop();
    this.voice = null;
    this.lobby = null;
    this.view = null;
    this.pendingView = null;
    this.queue = [];
    this.table.clear();
    this.cast.clear();
    this.menuCast = false;
    this.fx.clearWin();
    this.picker.hide();
    this.lounge.setMood(0);
    this.lounge.setGlow(0x719e94, 1);
    if (toTitle) this.show('title');
  }

  // ------------------------------------------------------------ host messages

  private mySeat(): number {
    if (!this.lobby || !this.conn) return -1;
    return this.lobby.seats.findIndex((s) => s?.id === this.conn!.id);
  }

  private slotOf = (seat: number): number => {
    const me = Math.max(0, this.mySeat());
    return (seat - me + 4) % 4;
  };

  private onLobby(m: LobbyMsg): void {
    const prev = this.lobby?.phase;
    this.lobby = m;
    this.quickDeadline = m.quick && m.phase === 'lobby' && typeof m.startsIn === 'number' ? this.time + m.startsIn : 0;
    this.table.slotOfSeat = this.slotOf;
    this.cast.slotOfSeat = this.slotOf;
    this.cast.sync(m.seats, this.mySeat());
    this.menuCast = false;
    // voice: one connection per other person in the room
    this.voice?.syncPeers(m.seats.filter((s): s is SeatInfo => !!s && !s.ai && s.connected && !s.id.startsWith('gone')).map((s) => s.id));
    if (m.phase === 'lobby' && this.screen !== 'avatar' && this.screen !== 'settings') this.show('lobby');
    if (m.phase === 'game' && prev !== 'game') {
      this.fx.clearWin();
      this.table.clear();
      this.table.slotOfSeat = this.slotOf;
      this.lounge.setMood(0);
      this.sound.shuffle(PILE);
      this.show('game');
    }
    if (m.phase === 'results' && this.screen === 'results') this.renderResults();
    if (this.screen === 'lobby') this.renderLobby();
  }

  private onView(v: ViewMsg): void {
    this.pendingView = v;
    if (this.queue.length === 0 && this.wait <= 0) this.applyView();
  }

  private applyView(): void {
    const v = this.pendingView;
    if (!v) return;
    const first = !this.view || this.view.round !== v.round;
    this.view = v;
    this.pendingView = null;
    this.table.view = v;
    if (first) {
      this.table.clear();
      this.table.view = v;
      this.table.slotOfSeat = this.slotOf;
    }
    this.table.setTop(v.top);
    this.table.setDrawCount(v.drawPile);
    if (first && v.phase === 'play' && v.turn === 0) {
      // a fresh round: the shuffle finishes, then the cards are dealt round the table one at a
      // time, each with its own flick; the first move waits for the deal
      const total = v.counts.reduce((a, b) => a + b, 0);
      const gap = Math.min(0.07, 1.15 / Math.max(1, total));
      const lead = 0.55;
      const dealt = this.table.deal(v, gap, lead);
      this.sound.deal(total, gap, lead + 0.05, PILE);
      this.wait = Math.max(this.wait, dealt);
      if (v.timer > 0) v.timer += dealt;
    }
    this.table.syncFans();
    this.table.syncHand();
    this.lounge.setGlow(COLOR_HEX[v.color], 1);
    this.table.pileTop(_v3);
    this.magic.setStack(v.phase === 'play' ? v.pending ?? 0 : 0, _v3);
    const owed = v.phase === 'play' && v.current === v.seat ? v.pending ?? 0 : 0;
    if (owed > 0 && owed !== this.owedShown) this.showHint(`+${owed} coming your way! Stack a Draw card on it, or take +${owed}.`, 3.2);
    this.owedShown = owed;
    this.timerEnd = v.timer > 0 && v.phase === 'play' ? this.time + v.timer : 0;
    // your turn starting brings the main bar back (draw, take, pass), whatever tray was open
    const myTurn = v.phase === 'play' && v.current === v.seat;
    if (myTurn && !this.wasMyTurn && this.tray) this.tray = '';
    this.wasMyTurn = myTurn;
    this.renderDock();
    this.updateTutorial();
  }

  private onEvents(m: EventsMsg): void {
    this.queue.push(...m.events);
  }

  /** Turn one host event into animation, effects and sound. Returns seconds to wait before the next. */
  private run(ev: GameEvent): number {
    const me = this.mySeat();
    const reduced = this.settings.reducedEffects;
    switch (ev.e) {
      case 'play': {
        this.lastPlayer = ev.seat;
        const mine = ev.seat === me;
        if (mine) this.picker.hide();
        const flight = this.table.animatePlay(ev.seat, ev.card, mine);
        this.sound.cardSlide(this.seatHead(ev.seat, _v));
        const card = ev.card;
        this.later(Math.max(0.05, flight), () => this.cardLanded(card));
        // an opponent's card is held up to be read: let the reveal finish before the next move
        return mine ? 0.3 : Math.max(0.6, flight - 0.2);
      }
      case 'color':
        this.lounge.setGlow(COLOR_HEX[ev.color], 1.4);
        this.fx.colorChange(ev.color);
        this.table.pileTop(_v);
        this.magic.pillar(_v, COLOR_HEX[ev.color], 1.4);
        this.magic.circle(_v.setY(TABLE_Y + 0.003), COLOR_HEX[ev.color], 0.75, 1.3, 0, 'table', 2.2);
        this.sound.color(ev.color);
        return 0.25;
      case 'draw4': {
        this.table.pileTop(_v);
        this.magic.circle(_v3.copy(_v).setY(TABLE_Y + 0.003), '#b26bff', 1.0, 1.9, 1, 'table', 1.8);
        this.magic.circle(_v3.copy(_v).add(_UP_MAGIC), '#7dd3fc', 0.42, 1.6, 0, 'viewer', -1.4);
        if (ev.stack) this.stackWord(ev.stack, _v);
        this.fx.drawFourCharge(_v, COLOR_HEX[this.view?.color ?? 0]);
        if (!reduced) this.lounge.setMood(-1);
        this.sound.draw4(this.seatHead(ev.target, _v2));
        const victim = this.cast.get(ev.target);
        this.later(reduced ? 0.3 : 1.0, () => {
          this.fx.drawFourBlast();
          this.lounge.setMood(0);
          victim?.react('frustrated', 2.6);
          // everyone else enjoys it
          for (const [seat, av] of this.cast.all()) if (seat !== ev.target && seat !== ev.from) av.react(Math.random() < 0.5 ? 'laugh' : 'point', 2.4);
          this.mascot.react('laugh', 2.4);
          if (ev.target === me) this.showHint('Ouch. Four cards for you.', 2);
        });
        this.pendingFrom = 'draw4';
        if (ev.target === me) this.later(1.2, () => this.offerRevenge(ev.from));
        else this.botHitsBack(ev.target, ev.from, 0.3);
        return reduced ? 0.35 : 1.05;
      }
      case 'draw2': {
        this.table.pileTop(_v);
        this.magic.circle(_v3.copy(_v).setY(TABLE_Y + 0.003), '#ff9a3c', 0.62, 1.2, 0, 'table', 2);
        if (ev.stack) this.stackWord(ev.stack, _v);
        this.fx.drawTwo(_v, this.table.seatFan(ev.target, _v2));
        this.sound.draw2(_v2);
        this.cast.get(ev.target)?.react('frustrated', 1.6);
        this.pendingFrom = 'draw2';
        if (ev.target === me) this.later(0.8, () => this.offerRevenge(ev.from));
        else this.botHitsBack(ev.target, ev.from, 0.2);
        return 0.35;
      }
      case 'draw': {
        const mine = ev.seat === me;
        if (ev.penalty && ev.count >= 2) {
          // whoever eats the Draw cards (or the whole stack) gets it in big letters
          this.seatHead(ev.seat, _v3).add(_UP_TAKE);
          this.fx.word('take', `+${ev.count}!`, ['#ffffff', '#ffb3be', '#d6243a'], _v3, 1.5, ev.count >= 6 ? 0.42 : 0.32, '#ff3b5c', true);
          this.magic.circle(this.seatHead(ev.seat, _v3), '#ff4d6a', 0.42, 1.2, 2, 'viewer', 0.9);
          this.sound.take(ev.count, _v3, mine);
        }
        const from = this.pendingFrom === 'draw4' ? this.fx.drawFourLift.clone() : undefined;
        const stagger = this.pendingFrom === 'draw4' ? 0.16 : 0.1;
        this.pendingFrom = '';
        this.table.animateDraw(ev.seat, ev.count, ev.cards, mine, stagger, from);
        return ev.penalty ? 0.25 + ev.count * stagger : 0.3;
      }
      case 'skip':
        this.fx.skip(this.seatHead(ev.seat, _v));
        this.magic.circle(_v, '#ff4d5e', 0.4, 1.3, 2, 'viewer', 0.8);
        this.sound.skip(_v);
        this.cast.get(ev.seat)?.react('skipped', 1.4);
        if (ev.seat === me) {
          this.showHint('Skipped!', 1.4);
          const by = this.lastPlayer;
          this.later(1.0, () => this.offerRevenge(by));
        }
        return 0.55;
      case 'reverse':
        this.fx.reverse(ev.direction);
        this.magic.circle(_v3.set(0, TABLE_Y + 0.003, 0), '#5fd8ff', 1.35, 1.5, 1, 'table', ev.direction * 2.6);
        this.sound.reverse(null);
        return 0.6;
      case 'lastCard':
        this.fx.lastCard(this.seatHead(ev.seat, _v));
        this.magic.circle(_v3.copy(_v).add(_UP_LAST), '#ffd56a', 0.5, 2.0, 0, 'viewer', 1);
        this.fx.word('lastcard', ev.seat === me ? 'LAST CARD!' : `${this.seatTitle(ev.seat)}: LAST CARD!`, ['#fff7d6', '#ffd56a', '#c58b2a'], _v3.copy(_v).add(_UP_TAKE), 1.8, 0.3, '#ffd56a', true);
        this.sound.lastCard(_v);
        return 0.35;
      case 'reshuffle':
        this.sound.shuffle(PILE);
        return 0.5;
      case 'turn':
        if (ev.seat === me && this.lobby?.phase === 'game') {
          this.sound.turn();
          this.fx.word('yourturn', 'YOUR TURN', ['#f5f3ff', '#c4b5fd', '#7c3aed'], _v.copy(this.table.fanCenter).add(new Vector3(0, 0.2, -0.05)), 1.3, 0.24, '#a78bfa');
        }
        return 0;
      case 'win': {
        const mine = ev.seat === me;
        this.magic.setStack(0, _v3);
        this.table.pileTop(_v3);
        this.magic.pillar(_v3, '#ffd56a', 2.4);
        this.magic.circle(_v3.setY(TABLE_Y + 0.003), '#ffd56a', 1.5, 2.6, 1, 'table', 1.2);
        if (!mine) this.magic.circle(this.seatHead(ev.seat, _v2), '#ffe7a3', 0.6, 2.4, 0, 'viewer', 1);
        this.dock.visible = false;
        this.hint.visible = false;
        this.fx.win(this.seatHead(ev.seat, _v), mine, this.viewer);
        this.lounge.setGlow(0xffc94a, 2);
        this.lounge.setMood(1);
        if (mine) this.sound.win();
        else {
          this.sound.lose();
          this.fx.lose(this.viewer);
          // the winner can't resist: a foam dart, right at you (only you see it)
          const winner = ev.seat;
          if (me >= 0 && this.cast.get(winner) && this.lobby?.seats[me]?.pranks !== false) {
            this.later(1.1, () => this.launchPrank('dart', winner, me));
          }
        }
        const w = this.cast.get(ev.seat);
        w?.react('win', 5);
        this.mascot.react('cheer', 5);
        for (const [seat, av] of this.cast.all()) if (seat !== ev.seat) av.react(Math.random() < 0.6 ? 'clap' : 'facepalm', 3);
        this.resultsAt = this.time + 3.2;
        return 0.2;
      }
      default:
        return 0;
    }
  }
  private pendingFrom: '' | 'draw2' | 'draw4' = '';
  /** Dev and capture aid: slow the whole table down (1 = real time). */
  timeScale = 1;
  private owedShown = 0;
  private wasMyTurn = false;
  /** The last pose sent, and seconds since (for the once-a-second keep-alive). */
  private lastPose: PoseMsg | null = null;
  private poseIdle = 0;
  /** When a public table deals by itself (game clock), and the seconds last shown. */
  private quickDeadline = 0;
  private quickShown = -1;
  /** Callbacks on the game clock (so effects stay in step with the animation, even when paused). */
  private timers: { at: number; fn: () => void }[] = [];

  /** A played card hits the pile: a puff of snow, a ring in its colour and a flare of the rune ring. */
  private cardLanded(card: Card): void {
    const at = this.table.pileTop(_v3);
    const hex = card.color >= 0 ? COLOR_HEX[card.color] : 0xffd27a;
    const reduced = this.settings.reducedEffects || this.settings.reducedFlashing;
    this.fx.ring(at, reduced ? 0.22 : 0.4, 0.9, hex);
    this.fx.burst(at, reduced ? 8 : 26, 0.62, [0xffffff, 0xe3e9ff, hex], 0.55);
    // the pile itself plays the place sound when the card settles
    if (!reduced) {
      this.lounge.setGlow(hex, 2.1);
      this.later(0.7, () => this.lounge.setGlow(COLOR_HEX[this.view?.color ?? 0] ?? hex, 1));
    }
  }

  /** What a seat is called at the table: a computer player is introduced by its hero in Frostpeak. */
  private seatTitle(seat: number): string {
    const s = this.lobby?.seats[seat];
    if (!s) return 'Player';
    return useHeroes() && s.ai ? heroTitle(personFor(s)) : s.name;
  }

  /** An opponent's card is held up: caption it with who played what, in the card's colour. */
  private captionPlay(seat: number, card: Card, at: Vector3): void {
    const label = cardName(card);
    const tones: string[][] = [
      ['#fff1ef', '#ff9d8f', '#d83a2e'],
      ['#fffbea', '#ffe28a', '#e0a500'],
      ['#effff4', '#8fe3aa', '#1f9d55'],
      ['#eef5ff', '#94bdff', '#2f6fdb'],
    ];
    const colors = card.color >= 0 ? tones[card.color] : ['#fffaf0', '#ffd98a', '#c58b2a'];
    this.fx.word('played', `${this.seatTitle(seat)}  ·  ${label}`, colors, _v3.copy(at).add(_UP_CAPTION), this.table.revealHold + 0.35, 0.4, colors[1], true);
  }

  /** The stack grew: show the running total over the pile. */
  private stackWord(n: number, pile: Vector3): void {
    const hot = n >= 8 ? ['#f5eaff', '#c79bff', '#7a2ee0'] : n >= 6 ? ['#fff0f2', '#ff8fa3', '#d6243a'] : ['#fff6e8', '#ffc078', '#e0701a'];
    this.fx.word('stack', `+${n} STACK`, hot, _v3.copy(pile).add(_UP_STACK), 1.8, n >= 6 ? 0.4 : 0.32, hot[1], true);
    this.sound.stack(n);
  }

  private later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }
  private timerEnd = 0;
  private timerShown = -1;

  private timeLeft(): number {
    return this.timerEnd ? Math.max(0, Math.ceil(this.timerEnd - this.time)) : -1;
  }

  private onEmote(m: EmoteMsg): void {
    const av = this.cast.get(m.seat);
    av?.react(m.kind, 2.2);
    this.sound.emote(m.kind, this.seatHead(m.seat, _v));
  }

  private onPrank(m: PrankMsg): void {
    if (m.seat === this.mySeat()) return;
    this.cast.get(m.seat)?.react('throw', 0.9);
    this.launchPrank(m.kind, m.seat, m.target);
  }

  /** Head of a seat, in table space (yours is the viewer). */
  /** Your own body on the flat screen: arms and hands holding your cards (a headset shows your real hands). */
  private self: PersonAvatar | null = null;
  private selfFan = { pos: new Vector3(), normal: new Vector3(), up: new Vector3() };

  private updateSelf(dt: number, t: number): void {
    const want = !this.immersive && peopleReady() && (this.screen === 'game' || this.screen === 'results') && this.table.hand.size > 0;
    if (!want) {
      if (this.self) this.self.root.visible = false;
      return;
    }
    const person = Math.abs(this.settings.look[0] ?? 0) % castSize();
    if (!this.self || this.self.person !== person) {
      this.self?.root.removeFromParent();
      const rig = createPersonRig(person);
      if (!rig) return;
      rig.firstPerson();
      this.self = new PersonAvatar(rig);
      this.self.motionScale = this.settings.reducedEffects || this.settings.reducedFlashing ? 0 : 1;
      this.self.plate.mesh.visible = false;
      this.self.slot = 0;
      this.root.add(this.self.root);
    }
    const me = this.self;
    me.root.visible = true;
    this.table.ownFanGrip(this.selfFan.pos, this.selfFan.normal, this.selfFan.up);
    me.ownFan = this.selfFan;
    const w = this.table.handReach(0, _v);
    me.setReach(w > 0 ? this.table.group.localToWorld(_v) : null, w);
    me.update(dt, t, this.viewer);
  }

  seatHead(seat: number, out: Vector3): Vector3 {
    if (seat === this.mySeat()) return out.copy(this.viewer);
    const av = this.cast.get(seat);
    if (!av) return out.set(0, TABLE_Y + 0.4, 0);
    av.head.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }

  // ------------------------------------------------------------ playing

  private onLocalPlay(card: Card): void {
    if (card.kind === 'wild' || card.kind === 'wild4') {
      this.picker.show(new Vector3(PILE.x, TABLE_Y + 0.45, PILE.z + 0.05));
      this.showHint(!this.immersive ? 'Choose a colour: click it.' : this.gaze ? 'Choose a colour: look at it and pinch.' : 'Choose a colour: point at it and pinch.', 3);
      return;
    }
    this.send({ t: 'act', action: { type: 'play', cardId: card.id } });
  }

  pickColor(c: Color): void {
    const hc = this.table.pendingWild;
    if (!hc) return;
    this.picker.hide();
    this.hint.visible = false;
    this.send({ t: 'act', action: { type: 'play', cardId: hc.card.id, color: c } });
  }

  clickCard(id: number): void {
    this.sound.unlock();
    this.table.clickCard(id);
  }

  emote(kind: EmoteKind): void {
    const me = this.mySeat();
    if (this.conn?.online) this.conn.emote({ seat: me, kind });
    this.sound.emote(kind, this.viewer);
    // computer players respond in solo games
    if (!this.conn?.online && (kind === 'laugh' || kind === 'point' || kind === 'angry')) {
      for (const [, av] of this.cast.all()) av.react(kind === 'angry' ? 'laugh' : 'facepalm', 1.8);
    }
  }

  /** Throw a toy at a seat (by default, whoever you are facing). */
  prank(kind: PrankKind, target = this.facingSeat()): void {
    const me = this.mySeat();
    if (target < 0 || target === me) return this.showHint('Pick someone to throw at.', 1.6);
    const info = this.lobby?.seats[target];
    if (info && !info.pranks) return this.showHint(`${this.seatTitle(target)} has toys switched off.`, 2);
    if (!this.pranks.ready()) return;
    this.launchPrank(kind, me, target);
    this.conn?.prank({ seat: me, kind, target, p: [], vel: [] });
    this.botHitsBack(target, me, 0.45);
  }

  /** Everyone at the table you could throw a toy at (they allow it). */
  private toyTargets(): number[] {
    const me = this.mySeat();
    const out: number[] = [];
    this.lobby?.seats.forEach((s, seat) => {
      if (s && seat !== me && s.pranks !== false) out.push(seat);
    });
    return out;
  }

  /** Someone just got you: open the toy tray aimed at them for a few seconds. */
  private offerRevenge(from: number): void {
    const me = this.mySeat();
    if (from < 0 || from === me || !this.toyTargets().includes(from) || this.screen !== 'game') return;
    this.revengeSeat = from;
    this.revengeUntil = this.time + 6;
    // the Toys button lights up; the main bar (draw, pause) stays where it is
    this.renderDock();
    this.showHint(`Get even with ${this.seatTitle(from)}: pick Get even on the bar!`, 3);
  }

  /** A computer player sometimes throws something back (solo games only). */
  private botHitsBack(bot: number, at: number, chance: number): void {
    if (this.conn?.online || bot === at) return;
    const s = this.lobby?.seats[bot];
    if (!s?.ai || Math.random() > chance) return;
    // never at a player who switched toys off
    if (at === this.mySeat() ? !this.settings.pranks : this.lobby?.seats[at]?.pranks === false) return;
    const kind = TOYS[Math.floor(Math.random() * (TOYS.length - 1))][0];
    this.later(1.3 + Math.random() * 1.3, () => {
      if (this.screen !== 'game' && this.screen !== 'results') return;
      this.cast.get(bot)?.react('throw', 0.9);
      this.later(0.35, () => this.launchPrank(kind, bot, at));
    });
  }

  private launchPrank(kind: PrankKind, from: number, target: number): void {
    const a = from === this.mySeat() ? _v.copy(this.table.fanCenter).add(new Vector3(0.1, 0.1, 0)) : this.seatHead(from, _v);
    const b = this.seatHead(target, _v2);
    this.pranks.launch(kind, a, b, () => {
      const av = this.cast.get(target);
      av?.react(kind === 'pie' ? 'cry' : kind === 'confetti' ? 'laugh' : 'hit', 1.8);
      if (target === this.mySeat()) this.showHint(kind === 'pie' ? 'Splat! Right in the face.' : kind === 'snowball' ? 'Brr! Snowball!' : 'Bonk!', 1.2);
    });
  }

  /** The other seat closest to where you are looking. */
  private facingSeat(): number {
    let best = -1;
    let bd = -0.2;
    for (const [seat] of this.cast.all()) {
      this.seatHead(seat, _v).sub(this.viewer).normalize();
      const d = _v.dot(_v2.copy(this.viewerFwd).normalize());
      if (d > bd) {
        bd = d;
        best = seat;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ device fit

  /** Nobody can see or hear the game (headset off, browser tab hidden): it falls silent until they are back. */
  setAway(away: boolean): void {
    this.sound.setAway(away);
  }

  /** A colour on the picker is being pointed at (hand ray, gaze or mouse), or no longer is. */
  pointAtColor(color: number, on: boolean): void {
    if (on) this.pointColor = color;
    else if (this.pointColor === color) this.pointColor = -1;
  }
  private pointColor = -1;

  /**
   * How much the game draws: 0 full (a monitor), 1 headset (your own cards cast no shadow; the
   * host system also redraws the shadow map every other frame), 2 lean (no shadows; thinner mist
   * and snow). The host system picks 1 on entering a headset and steps down to 2 if the frame
   * rate stays under 57 fps (see ChaosSystem.govern).
   */
  quality = 0;
  /** Frames per second over the last three seconds in a headset (0 until the first reading). */
  fps = 0;
  /** The last readings (one per three seconds), for checking a headset over remote debugging. */
  readonly fpsLog: number[] = [];
  /** The display rate the game asked the headset for when it could not hold a faster one (0: never asked). */
  displayRate = 0;
  setQuality(level: number): void {
    if (level === this.quality) return;
    this.quality = level;
    this.table.setHandShadows(level === 0);
    (this.lounge as { setLean?: (on: boolean) => void }).setLean?.(level >= 2);
  }

  /**
   * Start-up or a world change is still under way: shaders compiling, textures going up to the
   * GPU, sounds being rendered. Frames during it say nothing about the device's steady speed.
   */
  get busy(): boolean {
    return this.swap !== null || this.compiling > 0 || (this.warmup?.pending ?? 0) > 0 || !this.sound.ready;
  }
  private compiling = 0;

  /** Compile every shader in the background, counted as busy until it is done. */
  warmShaders(maxMs: number): void {
    if (!this.warmup) return;
    this.compiling++;
    void this.warmup.compile(maxMs).then(() => this.compiling--);
  }

  /** Looking picks and a pinch selects (Meta VR Glasses): hints say "look at", not "point at". */
  gaze = false;
  private narrow = false;

  /**
   * A headset with a narrow view (Meta VR Glasses show 37 degrees to each side and 43 down):
   * the action bar lies at the table's edge under your cards and hints sit just past the pile,
   * so everything a turn needs is in view while you look at your hand or at the pile. A wider
   * view (Quest) keeps the bar by your right hand and hints by your left.
   */
  setNarrowView(narrow: boolean): void {
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    this.layoutBars();
    this.placePanel();
    if (this.dock.visible) this.renderDock();
  }

  /**
   * Where the menu stands for the current screen. In a narrow view the wide title is a little
   * smaller and lower (its top edge sat right on the 25-degree upper limit) and the avatar card
   * comes in from 27 degrees to your left to 21.
   */
  private placePanel(): void {
    const s = this.screen;
    const g = this.panel.group;
    if (s === 'avatar') g.position.set(this.narrow ? -0.36 : -0.45, TABLE_Y + 0.42, 0.09);
    else g.position.set(0, TABLE_Y + (s === 'title' ? (this.narrow ? 0.4 : 0.46) : 0.42), 0.12);
    g.scale.setScalar(this.narrow && s === 'title' ? 0.86 : 1);
  }

  private layoutBars(): void {
    if (this.narrow) {
      this.dock.group.position.set(0, TABLE_Y + 0.05, 0.76);
      this.dock.group.rotation.set(-1.05, 0, 0, 'YXZ');
      this.hint.group.position.set(0, TABLE_Y + 0.075, -0.3);
      this.hint.group.rotation.set(-0.8, 0, 0, 'YXZ');
      this.hint.group.scale.setScalar(1.35);
    } else {
      // the small action bar sits on the table to your right, out of the way of your cards
      this.dock.group.position.set(0.56, TABLE_Y + 0.035, 0.3);
      this.dock.group.rotation.set(-1.0, -0.62, 0, 'YXZ');
      // hints sit low on your left, mirroring the action bar on your right
      this.hint.group.position.set(-0.5, TABLE_Y + 0.06, 0.34);
      this.hint.group.rotation.set(-0.95, 0.6, 0, 'YXZ');
      this.hint.group.scale.setScalar(1);
    }
  }

  private showHint(s: string, seconds: number): void {
    this.hintText = s;
    this.hintUntil = this.time + seconds;
    const p = this.hint;
    p.set(
      [],
      (pp) => {
        glass(pp.ctx, 4, 4, pp.W - 8, pp.H - 8, 40, '#a78bfa');
        text(pp.ctx, s, pp.W / 2, pp.H / 2, 34, { align: 'center', weight: 600, max: pp.W - 60 });
      },
      () => {},
    );
    p.visible = true;
  }
  private hintUntil = 0;

  private updateTutorial(): void {
    if (!this.tutorialStep || !this.view || this.conn?.online) return;
    const v = this.view;
    if (v.phase !== 'play' || v.current !== v.seat) return;
    if (this.tutorialStep === 1 && v.playable.length) {
      this.showHint(!this.immersive ? 'Your turn. Click a glowing card to play it.' : this.gaze ? 'Your turn. Look at a raised card and pinch.' : 'Your turn. Pinch a raised card and push it forward.', 7);
      this.tutorialStep = 2;
    } else if (this.tutorialStep <= 2 && !v.playable.length && !v.hasDrawn) {
      this.showHint(!this.immersive ? 'No match? Click the deck, or Draw a card on the bar.' : this.gaze ? 'No match? Look at the deck and pinch to draw.' : 'No match? Point at the deck and pinch to draw.', 7);
      this.tutorialStep = 3;
    } else if (this.tutorialStep >= 2 && this.tutorialStep < 4 && v.hand.some((c) => c.kind === 'wild' || c.kind === 'wild4')) {
      this.showHint(!this.immersive || this.gaze ? 'Wild cards change the colour: play one, then pick a colour.' : 'Wild cards change the colour. You can also point and pinch.', 6);
      this.tutorialStep = 4;
    }
  }

  // ------------------------------------------------------------ menu cast

  /** True while the idle heroes seated for the menu (not a real game) are at the table. */
  private menuCast = false;

  /**
   * On the title and setup screens the table is not empty: the computer players sit
   * waiting, idle. They are the same characters the bots play, so dealing a solo game
   * keeps them in their chairs. Cleared for the avatar preview, which uses a seat.
   */
  private syncMenuCast(): void {
    const want = (this.screen === 'title' || this.screen === 'solo' || this.screen === 'join') && !this.lobby && !this.view;
    if (want && !this.menuCast && peopleReady() && this.cast.all().length === 0) {
      const seat = (i: number, name: string): SeatInfo => ({
        id: `menu:${i}`, name, look: [i - 1, 0, 1, 0], ai: true, difficulty: 'normal', ready: true,
        connected: true, autopilot: false, pranks: false, wins: 0,
      });
      this.cast.slotOfSeat = (s) => s;
      this.cast.sync([null, seat(1, 'Guest'), seat(2, 'Guest'), seat(3, 'Guest')], 0);
      for (const [, av] of this.cast.all()) {
        av.plate.mesh.visible = false;
        if (av instanceof PersonAvatar && 'holding' in av.rig) av.rig.holding = false;
      }
      this.menuCast = true;
    } else if (!want && this.menuCast && (this.screen === 'avatar' || this.screen === 'connecting')) {
      this.cast.clear();
      this.menuCast = false;
    }
  }

  // ------------------------------------------------------------ screens

  show(s: Screen): void {
    if (s !== 'settings' && s !== 'avatar' && s !== 'name' && s !== 'arena') this.back = s === 'pause' ? 'game' : s;
    this.screen = s;
    this.syncMenuCast();
    // The idle shimmer repainted and re-uploaded the 1680x945 title canvas 12 times a second,
    // which dropped a frame each time (title at 50 fps, p95 33 ms). The 3D cards and the heroes
    // keep the title alive; the panel itself rests once its intro has played.
    this.panel.ambientMotion = false;
    this.panel.setShape(s === 'title' ? 'title' : s === 'avatar' ? 'card' : 'menu');
    const inGame = s === 'game';
    this.panel.visible = !inGame;
    // On the avatar screen the menu is a narrow card about 27 degrees to your left and a metre
    // away, so it and the hero across the table are both fully in view (monitor and headset).
    this.placePanel();
    this.dock.visible = inGame || s === 'pause';
    if (this.preview) this.preview.root.visible = s === 'avatar';
    if (this.conn instanceof LocalTable) this.conn.setPaused(s === 'pause' || s === 'settings' || s === 'arena' || s === 'avatar' || s === 'name');
    this.tray = '';
    switch (s) {
      case 'title':
        return this.renderTitle();
      case 'solo':
        return this.renderSolo();
      case 'join':
        return this.renderJoin();
      case 'connecting':
        return this.renderMessage(this.status || 'Connecting…', [{ id: 'cancel', label: 'Cancel', x: 0, y: 0, w: 0, h: 0 }]);
      case 'lobby':
        return this.renderLobby();
      case 'avatar':
        return this.renderAvatar();
      case 'name':
        return this.renderName();
      case 'settings':
        return this.renderSettings();
      case 'arena':
        return this.renderArena();
      case 'pause':
        return this.renderPause();
      case 'results':
        return this.renderResults();
      case 'error':
        return this.renderMessage(this.error, [{ id: 'ok', label: 'OK', x: 0, y: 0, w: 0, h: 0, kind: 'primary' }]);
      case 'game':
        this.renderDock();
        return;
    }
  }

  private press(id: string): void {
    this.sound.unlock();
    this.sound.ui(uiKind(id));
    switch (this.screen) {
      case 'title':
        if (id === 'quick') return void this.quickMatch();
        if (id === 'solo') this.show('solo');
        else if (id === 'tutorial') {
          this.solo = { opponents: 1, difficulty: 'easy', drawUntil: false, timer: 0, stack: false };
          this.settings.tutorial = true;
          this.startSolo();
        } else if (id === 'host') void this.hostOnline();
        else if (id === 'join') {
          this.code = '';
          this.show('join');
        } else if (id === 'avatar') this.show('avatar');
        else if (id === 'settings') this.show('settings');
        else if (id === 'arena') this.show('arena');
        else if (id === 'vr') this.onEnterXR?.(false);
        else if (id === 'mr') this.onEnterXR?.(true);
        return;
      case 'solo':
        if (id.startsWith('opp')) this.solo.opponents = Number(id.slice(3));
        else if (id.startsWith('dif:')) this.solo.difficulty = id.slice(4) as Difficulty;
        else if (id === 'until') this.solo.drawUntil = !this.solo.drawUntil;
        else if (id === 'stack') this.solo.stack = !this.solo.stack;
        else if (id === 'timer') this.solo.timer = [0, 15, 30][([0, 15, 30].indexOf(this.solo.timer) + 1) % 3];
        else if (id === 'start') return this.startSolo();
        else if (id === 'back') return this.show('title');
        return this.renderSolo();
      case 'join':
        if (id === 'back') return this.show('title');
        if (id === 'del') this.code = this.code.slice(0, -1);
        else if (id === 'go') {
          if (isCode(this.code)) void this.joinOnline(this.code);
          return;
        } else if (id.startsWith('k:') && this.code.length < 5) this.code += id.slice(2);
        return this.renderJoin();
      case 'lobby': {
        const l = this.lobby;
        if (!l) return;
        if (id === 'leave') return this.leaveTable();
        if (id === 'ready') this.send({ t: 'ready', ready: !l.seats[this.mySeat()]?.ready });
        else if (id === 'start') this.send({ t: 'start' });
        else if (id === 'mic') this.voice?.setMuted(!this.voice.muted);
        else if (id === 'until') this.send({ t: 'rules', rules: { ...l.rules, drawUntilPlayable: !l.rules.drawUntilPlayable } });
        else if (id === 'stack') this.send({ t: 'rules', rules: { ...l.rules, stacking: !l.rules.stacking } });
        else if (id === 'timer') this.send({ t: 'rules', rules: { ...l.rules, turnSeconds: [0, 15, 30][([0, 15, 30].indexOf(l.rules.turnSeconds) + 1) % 3] } });
        else if (id.startsWith('ai:')) {
          const seat = Number(id.slice(3));
          const s = l.seats[seat];
          const next: Difficulty | null = !s ? 'easy' : s.difficulty === 'easy' ? 'normal' : s.difficulty === 'normal' ? 'hard' : null;
          this.send({ t: 'seatAi', seat, on: next !== null, difficulty: next ?? 'normal' });
        }
        return this.renderLobby();
      }
      case 'name':
        return this.pressName(id);
      case 'avatar': {
        const L = this.settings.look;
        const cyc = (i: number, n: number, d: number) => (L[i] = (((L[i] ?? 0) + d) % n + n) % n);
        if (id === 'done') {
          this.saveSettings();
          this.send({ t: 'profile', profile: this.profile(), pranks: this.settings.pranks });
          return this.show(this.back === 'game' ? 'pause' : this.back);
        }
        if (id === 'editname') {
          this.nameDraft = this.profile().name.slice(0, NAME_MAX);
          return this.show('name');
        }
        if (id === 'skin-') cyc(0, SKIN.length, -1);
        if (id === 'skin+') cyc(0, SKIN.length, 1);
        if (id === 'hair-') cyc(1, HAIR.length, -1);
        if (id === 'hair+') cyc(1, HAIR.length, 1);
        if (id === 'fit-') cyc(2, OUTFIT.length, -1);
        if (id === 'fit+') cyc(2, OUTFIT.length, 1);
        if (id === 'style-') cyc(3, HAIR_STYLES, -1);
        if (id === 'style+') cyc(3, HAIR_STYLES, 1);
        if (id === 'person-') cyc(0, castSize(), -1);
        if (id === 'person+') cyc(0, castSize(), 1);
        if (id.startsWith('person')) this.later(0.25, () => (this.preview instanceof PersonAvatar ? this.preview.react('cheer', 1.4) : undefined));
        if (this.preview instanceof HumanAvatar) this.preview.setLook(L);
        return this.renderAvatar();
      }
      case 'settings': {
        const s = this.settings;
        const step = (k: 'master' | 'fx' | 'music' | 'voice', d: number) => (s[k] = Math.round(Math.min(1, Math.max(0, s[k] + d)) * 10) / 10);
        if (id === 'back') {
          this.saveSettings();
          this.send({ t: 'profile', profile: this.profile(), pranks: s.pranks });
          return this.show(this.back === 'game' ? 'pause' : this.back);
        }
        for (const k of ['master', 'fx', 'music', 'voice'] as const) {
          if (id === `${k}-`) step(k, -0.1);
          if (id === `${k}+`) step(k, 0.1);
        }
        if (id === 'rfx') s.reducedEffects = !s.reducedEffects;
        if (id === 'rflash') s.reducedFlashing = !s.reducedFlashing;
        if (id === 'pranks') s.pranks = !s.pranks;
        if (id === 'tut') s.tutorial = !s.tutorial;
        if (id === 'world') return this.show('arena');
        if (id === 'h-') s.tableHeight = Math.max(-0.15, s.tableHeight - 0.03);
        if (id === 'h+') s.tableHeight = Math.min(0.15, s.tableHeight + 0.03);
        this.applySettings();
        this.table.syncHand();
        return this.renderSettings();
      }
      case 'arena': {
        if (id === 'back') return this.show(this.back === 'game' ? 'pause' : this.back);
        if (id.startsWith('w:')) this.switchWorld(id.slice(2) as WorldName);
        return this.renderArena();
      }
      case 'pause':
        if (id === 'resume') return this.show('game');
        if (id === 'settings') return this.show('settings');
        if (id === 'avatar') return this.show('avatar');
        if (id === 'recenter') {
          this.onRecenter?.();
          return this.show('game');
        }
        if (id === 'leave') return this.leaveTable();
        return;
      case 'results':
        if (id === 'rematch') {
          if (this.conn instanceof LocalTable) this.conn.host.start();
          else this.send({ t: 'rematch' });
          return this.renderResults();
        }
        if (id === 'lobby') {
          if (this.conn?.online) {
            this.send({ t: 'menu' });
            return;
          }
          return this.leaveTable();
        }
        if (id.startsWith('prank:')) return this.prank(id.slice(6) as PrankKind);
        return;
      case 'error':
        return this.show('title');
      case 'connecting':
        if (id === 'cancel') {
          this.connectAttempt++;
          this.leaveTable();
        }
        return;
      default:
        return;
    }
  }

  private pressDock(id: string): void {
    this.sound.unlock();
    // drawing makes its own card sound
    if (id !== 'draw') this.sound.ui(uiKind(id));
    if (id === 'pause') return this.show('pause');
    if (id === 'resume') return this.show('game');
    if (id === 'emotes') this.tray = 'emote';
    else if (id === 'toys') this.tray = 'toy';
    else if (id === 'close') {
      this.tray = '';
      this.revengeSeat = -1;
    } else if (id === 'draw') this.send({ t: 'act', action: { type: 'draw' } });
    else if (id === 'keep') this.send({ t: 'act', action: { type: 'pass' } });
    else if (id.startsWith('e:')) {
      this.emote(id.slice(2) as EmoteKind);
      this.tray = '';
    } else if (id.startsWith('t:')) {
      this.toyKind = id.slice(2) as PrankKind;
      const targets = this.toyTargets();
      if (this.revengeSeat >= 0 && targets.includes(this.revengeSeat)) {
        this.prank(this.toyKind, this.revengeSeat);
        this.tray = '';
        this.revengeSeat = -1;
      } else if (targets.length === 1) {
        this.prank(this.toyKind, targets[0]);
        this.tray = '';
      } else this.tray = 'target';
    } else if (id.startsWith('at:')) {
      this.prank(this.toyKind, Number(id.slice(3)));
      this.tray = '';
    } else if (id.startsWith('prank:')) this.prank(id.slice(6) as PrankKind);
    this.renderDock();
  }

  private logo(p: Panel, y: number): void {
    const ctx = p.ctx;
    const entrance = p.reducedMotion ? 1 : 1 - Math.pow(1 - Math.min(1, p.age / 1.25), 4);
    text(ctx, 'O P E N   L A T E .   P L A Y   L O N G .', 56, y - 58, 15, { weight: 500, color: '#9f9ba7' });
    ctx.save();
    ctx.font = '400 65px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    const ivory = ctx.createLinearGradient(0, y - 30, 0, y + 30);
    ivory.addColorStop(0, '#f8f1e3'); ivory.addColorStop(1, '#cfc0a5');
    ctx.fillStyle = ivory;
    ctx.fillText('AFTERHOURS', 52, y, 592);
    ctx.restore();
    text(ctx, 'T H E   C A R D   L O U N G E', 56, y + 47, 17, { weight: 450, color: '#c6b99f' });
    ctx.save();
    ctx.strokeStyle = 'rgba(193,175,140,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(372, y + 47); ctx.lineTo(551, y + 47); ctx.stroke();
    ctx.translate(566, y + 47); ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-3, -3, 6, 6);
    ctx.restore();
    // The little fan opens once with the menu and settles; it never repaints an idle panel.
    ctx.save();
    ctx.translate(p.W - 129, y + 4 + 10 * (1 - entrance));
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i - 1) * 0.28 * (0.25 + 0.75 * entrance));
      ctx.translate((i - 1) * (8 + 7 * entrance), -Math.abs(i - 1) * 3);
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
      roundRect(ctx, -30, -44, 60, 88, 6);
      ctx.fillStyle = ['#424e70', '#65506d', '#46615f'][i]; ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = 'rgba(225,213,190,0.85)'; ctx.lineWidth = 2; ctx.stroke();
      roundRect(ctx, -25, -39, 50, 78, 3);
      ctx.strokeStyle = 'rgba(225,213,190,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      text(ctx, ['7', '4', '2'][i], 0, 0, 34, { align: 'center', weight: 500, color: '#eee4d2' });
      text(ctx, ['7', '4', '2'][i], -18, -27, 13, { align: 'center', weight: 600, color: '#eee4d2' });
      if (entrance < 1) {
        const shine = ctx.createLinearGradient(-65 + entrance * 150, -44, -20 + entrance * 150, 44);
        shine.addColorStop(0, 'rgba(247,235,210,0)'); shine.addColorStop(0.5, 'rgba(247,235,210,0.13)'); shine.addColorStop(1, 'rgba(247,235,210,0)');
        ctx.fillStyle = shine; ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private frame(p: Panel, title?: string): void {
    glass(p.ctx, 10, 10, p.W - 20, p.H - 20, 22);
    if (title) {
      text(p.ctx, title, 74, 90, 49, { weight: 500 });
      p.ctx.strokeStyle = 'rgba(196,183,153,0.20)';
      p.ctx.lineWidth = 1;
      p.ctx.beginPath(); p.ctx.moveTo(74, 140); p.ctx.lineTo(p.W - 74, 140); p.ctx.stroke();
    }
  }

  private renderTitle(): void {
    const p = this.panel;
    const W = p.W;
    p.ambientMotion = false;
    const launch = (id: string, label: string, description: string, x: number, w: number, primary = false): Button => ({
      id, label, description, x, y: 636, w, h: 138,
      paint: (ctx, button, hover) => {
        const { x, y, w, h } = button;
        roundRect(ctx, x, y, w, h, 18);
        const fill = ctx.createLinearGradient(x, y, x + w, y + h);
        if (primary) {
          fill.addColorStop(0, hover ? '#fff2cd' : '#ecd8ad'); fill.addColorStop(1, hover ? '#d8bd87' : '#bfa479');
          ctx.shadowColor = 'rgba(240,191,112,0.25)'; ctx.shadowBlur = hover ? 26 : 12;
        } else {
          fill.addColorStop(0, hover ? 'rgba(41,58,64,0.97)' : 'rgba(17,30,37,0.93)'); fill.addColorStop(1, 'rgba(9,19,26,0.97)');
        }
        ctx.fillStyle = fill; ctx.fill(); ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5; ctx.strokeStyle = primary ? 'rgba(255,242,211,0.8)' : hover ? 'rgba(227,201,154,0.85)' : 'rgba(176,191,189,0.35)'; ctx.stroke();
        text(ctx, label, x + 26, y + 49, 33, { weight: 600, color: primary ? '#1b252a' : '#fff4e0', max: w - 76 });
        text(ctx, description, x + 26, y + 96, 21, { weight: 450, color: primary ? '#434548' : '#acb9bb', max: w - 44 });
        text(ctx, '↗', x + w - 32, y + 40, 31, { align: 'center', weight: 400, color: primary ? '#3e4548' : '#d4bd91' });
        if (primary || hover) {
          const sweep = p.reducedMotion ? 0.5 : (Math.sin(p.age * 0.55) + 1) * 0.5;
          const edge = ctx.createLinearGradient(x, 0, x + w, 0);
          edge.addColorStop(0, 'rgba(255,251,230,0)'); edge.addColorStop(sweep * 0.8 + 0.1, 'rgba(255,251,230,0.8)'); edge.addColorStop(1, 'rgba(255,251,230,0)');
          ctx.strokeStyle = edge; ctx.beginPath(); ctx.moveTo(x + 22, y + 2); ctx.lineTo(x + w - 22, y + 2); ctx.stroke();
        }
      },
    });
    const pill = (id: string, label: string, x: number, w: number): Button => ({ id, x, y: 839, w, h: 51, label, paint: (ctx, b, hover) => {
      roundRect(ctx, b.x, b.y, b.w, b.h, 25);
      ctx.fillStyle = hover ? 'rgba(218,196,154,0.16)' : 'rgba(5,14,20,0.58)'; ctx.fill();
      ctx.strokeStyle = hover ? 'rgba(233,211,172,0.65)' : 'rgba(164,182,182,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      text(ctx, label, b.x + b.w / 2, b.y + b.h / 2, 22, { weight: 450, align: 'center', color: hover ? '#fff2d7' : '#c3cece', max: b.w - 30 });
    } });
    const b: Button[] = [
      // four ways in, side by side: on your own, with anyone online, with friends, by code
      ...(() => {
        const gap = 20;
        const w = (W - 136 - gap * 3) / 4;
        const at = (i: number) => 68 + i * (w + gap);
        return [
          launch('solo', 'Play solo', 'Your seat against the house.', at(0), w, true),
          launch('quick', 'Quick match', 'Play anyone online, right now.', at(1), w),
          launch('host', 'Play with friends', 'A private table for your people.', at(2), w),
          launch('join', 'Join with code', 'Your friends are waiting.', at(3), w),
        ];
      })(),
      pill('tutorial', 'How to play', 68, 196), pill('avatar', 'Your hero', 278, 180), pill('arena', 'Arenas', 472, 150), pill('settings', 'Preferences', 636, 196),
    ];
    if (!this.immersive) {
      if (MIXED_REALITY) b.push(pill('vr', 'Enter VR', W - 426, 170), pill('mr', 'Mixed reality', W - 242, 174));
      else b.push(pill('vr', 'Enter VR', W - 238, 170));
    }
    p.set(b, (pp) => {
      const ctx = pp.ctx;
      pp.drawCinematicBackdrop();
      const t = pp.reducedMotion ? 0 : pp.age;
      ctx.save();
      ctx.translate(78, 63); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#e7c78d'; ctx.lineWidth = 2; ctx.strokeRect(-10, -10, 20, 20); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      const info = worldInfo(this.settings.world);
      text(ctx, info.kicker, 112, 63, 22, { weight: 500, color: '#d3c4a9' });
      text(ctx, info.label, W - 68, 63, 19, { align: 'right', weight: 450, color: '#d0d5d2' });
      ctx.save();
      ctx.font = '400 167px Georgia, "Times New Roman", serif'; ctx.textBaseline = 'middle';
      const foil = ctx.createLinearGradient(0, 129, 0, 270);
      foil.addColorStop(0, '#fff8e9'); foil.addColorStop(0.55, '#e8dbbd'); foil.addColorStop(1, '#c0a77b');
      ctx.fillStyle = foil; ctx.shadowColor = 'rgba(0,0,0,0.44)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 7;
      ctx.fillText('AFTERHOURS', 61, 213, W - 130); ctx.restore();
      ctx.strokeStyle = 'rgba(232,212,170,0.36)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(70, 315); ctx.lineTo(734, 315); ctx.stroke();
      ctx.save(); ctx.font = '400 57px Georgia, "Times New Roman", serif'; ctx.fillStyle = '#fff5e2';
      ctx.fillText('Great hands.', 68, 404); ctx.fillText('Better company.', 68, 472); ctx.restore();
      text(ctx, info.line, 71, 531, 27, { weight: 450, color: '#c6ceca' });
      text(ctx, 'Bring your friends. Make your next move.', 71, 570, 24, { weight: 400, color: '#a9b9bc' });
      // A restrained moving reflection ties the real 3D featured cards to the cover art.
      const glow = ctx.createRadialGradient(W * 0.76, 455, 30, W * 0.76, 455, 300);
      glow.addColorStop(0, `rgba(186,145,80,${(0.12 + Math.sin(t * 0.5) * 0.025).toFixed(3)})`); glow.addColorStop(1, 'rgba(186,145,80,0)');
      ctx.fillStyle = glow; ctx.fillRect(W * 0.5, 240, W * 0.5, 380);
      text(ctx, '01   /   THE NEXT HAND IS YOURS', W - 75, 583, 18, { align: 'right', weight: 500, color: '#d7c39c' });
      ctx.strokeStyle = 'rgba(181,194,190,0.18)'; ctx.beginPath(); ctx.moveTo(70, 809); ctx.lineTo(W - 70, 809); ctx.stroke();
      if (this.immersive) text(ctx, `Welcome, ${this.profile().name}. Settle in.`, W - 70, 866, 23, { align: 'right', weight: 450, color: '#d7c8ac' });
    }, (id) => this.press(id));
  }
  immersive = false;

  private renderSolo(): void {
    const p = this.panel;
    const W = p.W;
    const s = this.solo;
    const b: Button[] = [
      ...row([['opp1', '1 opponent'], ['opp2', '2 opponents'], ['opp3', '3 opponents']], 74, 240, W - 148, 90, 16, 'toggle').map((x) => ({ ...x, on: x.id === `opp${s.opponents}` })),
      ...row([['dif:easy', 'Easy'], ['dif:normal', 'Normal'], ['dif:hard', 'Hard']], 74, 415, W - 148, 90, 16, 'toggle').map((x) => ({ ...x, on: x.id === `dif:${s.difficulty}` })),
      ...row([['stack', `Stack +2/+4: ${s.stack ? 'On' : 'Off'}`], ['until', `Draw till playable: ${s.drawUntil ? 'On' : 'Off'}`], ['timer', `Turn timer: ${s.timer ? s.timer + 's' : 'Off'}`]], 74, 577, W - 148, 70, 16, 'toggle').map((x) => ({
        ...x,
        on: x.id === 'stack' ? s.stack : x.id === 'until' ? s.drawUntil : s.timer > 0,
      })),
      { id: 'back', label: 'Back', x: 74, y: 710, w: 220, h: 76 },
      { id: 'start', label: 'Deal the cards', x: W - 474, y: 710, w: 400, h: 76, kind: 'primary' },
    ];
    p.set(b, (pp) => {
      this.frame(pp, 'Play the house');
      text(pp.ctx, '01  ·  How many at the table?', 74, 204, 29, { color: '#b5b8b6' });
      text(pp.ctx, '02  ·  Choose your competition', 74, 380, 29, { color: '#b5b8b6' });
      text(pp.ctx, '03  ·  Make it your game', 74, 546, 27, { color: '#b5b8b6' });
    }, (id) => this.press(id));
  }

  private renderJoin(): void {
    const p = this.panel;
    const W = p.W;
    const keys: Button[] = [];
    const cols = 9;
    const kw = 100;
    const kh = 78;
    const x0 = (W - (cols * kw + (cols - 1) * 10)) / 2;
    [...CODE_CHARS].forEach((ch, i) => {
      keys.push({ id: `k:${ch}`, label: ch, x: x0 + (i % cols) * (kw + 10), y: 350 + Math.floor(i / cols) * (kh + 14), w: kw, h: kh, kind: 'key' });
    });
    keys.push({ id: 'del', label: '⌫', x: x0 + 8 * (kw + 10), y: 350 + 2 * (kh + 14), w: kw, h: kh, kind: 'key' });
    keys.push({ id: 'back', label: 'Back', x: 74, y: 710, w: 220, h: 76 });
    keys.push({ id: 'go', label: 'Join Game', x: W - 424, y: 710, w: 350, h: 76, kind: 'primary', disabled: !isCode(this.code) });
    p.set(keys, (pp) => {
      this.frame(pp, 'Your invitation to the table');
      const ctx = pp.ctx;
      for (let i = 0; i < 5; i++) {
        const x = W / 2 - 310 + i * 126;
        roundRect(ctx, x, 194, 116, 118, 14);
        ctx.fillStyle = i === this.code.length ? 'rgba(90,114,96,0.24)' : 'rgba(58,87,80,0.16)';
        ctx.fill();
        ctx.strokeStyle = i === this.code.length ? '#d1bc91' : 'rgba(153,179,165,0.30)';
        ctx.lineWidth = i === this.code.length ? 2 : 1.5;
        ctx.stroke();
        text(ctx, this.code[i] ?? '·', x + 58, 255, this.code[i] ? 72 : 38, { weight: 650, align: 'center', color: this.code[i] ? '#eef2ff' : '#66799f' });
      }
    }, (id) => this.press(id));
  }

  // ------------------------------------------------------------ your name

  private nameDraft = '';

  /** The name on the avatar screens: a field that opens the name screen. */
  private nameField(x: number, y: number, w: number, h: number): Button {
    return {
      id: 'editname', x, y, w, h,
      paint: (ctx, b, hover) => {
        roundRect(ctx, b.x, b.y, b.w, b.h, 16);
        ctx.fillStyle = hover ? 'rgba(96,120,104,0.34)' : 'rgba(58,87,80,0.20)';
        ctx.fill();
        ctx.strokeStyle = hover ? '#e8d3a6' : 'rgba(153,179,165,0.38)';
        ctx.lineWidth = hover ? 2.5 : 1.5;
        ctx.stroke();
        text(ctx, this.profile().name, b.x + 26, b.y + b.h / 2 + 2, 40, { weight: 700, max: b.w - 170 });
        text(ctx, 'Change', b.x + b.w - 26, b.y + b.h / 2 + 2, 24, { weight: 600, align: 'right', color: hover ? '#fff6dc' : '#d1bc91' });
      },
    };
  }

  /**
   * Type your own name. The keys take a pinch, a gaze and pinch, a fingertip or a mouse; a
   * desk keyboard types straight in. Up to NAME_MAX characters: letters, digits and spaces.
   */
  private renderName(): void {
    const p = this.panel;
    const W = p.W;
    const keys: Button[] = [];
    const kw = 96;
    const kh = 66;
    const gap = 10;
    const top = 292;
    ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].forEach((letters, r) => {
      // the bottom row of letters shares its line with a wide delete key
      const x0 = (W - (letters.length * kw + (letters.length - 1) * gap)) / 2 - (r === 3 ? 0.75 * (kw + gap) : 0);
      [...letters].forEach((ch, i) => keys.push({ id: `n:${ch}`, label: ch, x: x0 + i * (kw + gap), y: top + r * (kh + gap), w: kw, h: kh, kind: 'key' }));
      if (r === 3) keys.push({ id: 'ndel', label: '⌫', x: x0 + 7 * (kw + gap), y: top + r * (kh + gap), w: kw * 1.5 + gap, h: kh, kind: 'key' });
    });
    keys.push({ id: 'nspace', label: 'Space', x: W / 2 - 230, y: top + 4 * (kh + gap), w: 460, h: kh, kind: 'key' });
    const typed = this.nameDraft;
    const ok = cleanName(typed) !== '';
    keys.push({ id: 'back', label: 'Cancel', x: 74, y: 712, w: 220, h: 76 });
    keys.push({ id: 'go', label: 'Save name', x: W - 424, y: 712, w: 350, h: 76, kind: 'primary', disabled: !ok });
    p.set(keys, (pp) => {
      this.frame(pp, 'Your name');
      const ctx = pp.ctx;
      roundRect(ctx, W / 2 - 330, 164, 660, 104, 16);
      ctx.fillStyle = 'rgba(58,87,80,0.20)';
      ctx.fill();
      ctx.strokeStyle = '#d1bc91';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (typed) text(ctx, `${typed}_`, W / 2, 214, 58, { weight: 700, align: 'center', max: 560 });
      else text(ctx, 'Type your name', W / 2, 216, 36, { weight: 450, align: 'center', color: '#7f8ea3' });
      text(ctx, `${typed.length} / ${NAME_MAX}`, W / 2 + 312, 248, 19, { weight: 500, align: 'right', color: '#8b97a8' });
      if (typed.trim() && !ok) text(ctx, 'Please pick another name.', W / 2, 750, 24, { weight: 500, align: 'center', color: '#ffb4a8' });
    }, (id) => this.press(id));
  }

  private pressName(id: string): void {
    if (id === 'back') return this.show('avatar');
    if (id === 'go') {
      const name = cleanName(this.nameDraft);
      if (!name) return;
      this.settings.nameText = name;
      this.saveSettings();
      this.send({ t: 'profile', profile: this.profile(), pranks: this.settings.pranks });
      return this.show('avatar');
    }
    if (id === 'ndel') this.nameDraft = this.nameDraft.slice(0, -1);
    else if (id === 'nspace') this.typeName(' ');
    else if (id.startsWith('n:')) this.typeName(id.slice(2));
    this.renderName();
  }

  /** One more character from the on-panel keys: a capital starts each word, the rest follow in lower case. */
  private typeName(ch: string): void {
    const d = this.nameDraft;
    if (d.length >= NAME_MAX) return;
    if (ch === ' ') {
      if (d && !d.endsWith(' ')) this.nameDraft = `${d} `;
      return;
    }
    this.nameDraft = d + (d === '' || /[ '-]$/.test(d) ? ch.toUpperCase() : ch.toLowerCase());
  }

  /** A desk keyboard: type a name as you would anywhere, or a table code. */
  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.screen === 'name') {
      if (e.key === 'Enter') this.press('go');
      else if (e.key === 'Escape') this.press('back');
      else if (e.key === 'Backspace') this.press('ndel');
      else if (e.key.length === 1 && /[\p{L}\p{M}\p{N} '.-]/u.test(e.key)) {
        if (this.nameDraft.length < NAME_MAX && (e.key !== ' ' || (this.nameDraft && !this.nameDraft.endsWith(' ')))) this.nameDraft += e.key;
        this.renderName();
      } else return;
      e.preventDefault();
    } else if (this.screen === 'join') {
      const ch = e.key.toUpperCase();
      if (e.key === 'Enter') this.press('go');
      else if (e.key === 'Backspace') this.press('del');
      else if (e.key.length === 1 && CODE_CHARS.includes(ch)) this.press(`k:${ch}`);
      else return;
      e.preventDefault();
    }
  }

  private renderMessage(msg: string, buttons: Button[]): void {
    const p = this.panel;
    const W = p.W;
    const b = buttons.map((x) => ({ ...x, x: W / 2 - 150, y: 710, w: 300, h: 76 }));
    p.set(b, (pp) => {
      this.frame(pp);
      this.logo(pp, 120);
      const words = msg.split(' ');
      let line = '';
      let y = 370;
      for (const w of words) {
        if ((line + w).length > 42) {
          text(pp.ctx, line, W / 2, y, 34, { align: 'center' });
          line = '';
          y += 48;
        }
        line += w + ' ';
      }
      text(pp.ctx, line, W / 2, y, 34, { align: 'center' });
    }, (id) => this.press(id));
  }

  private renderLobby(): void {
    const l = this.lobby;
    if (!l) return;
    const p = this.panel;
    const W = p.W;
    const me = this.mySeat();
    // at a public table nobody is in charge: no bots, rules or start button, just Ready
    const host = l.hostId === this.conn?.id && !l.quick;
    const b: Button[] = [];
    l.seats.forEach((s, i) => {
      const y = 248 + i * 88;
      if (host && i !== me && (!s || s.ai)) {
        b.push({ id: `ai:${i}`, label: !s ? '+ Add bot' : s.difficulty === 'hard' ? 'Remove' : `${s.difficulty} ›`, x: W - 270, y: y - 30, w: 196, h: 60 });
      }
    });
    if (host) {
      const r = l.rules;
      b.push(
        ...row([['stack', `Stack +2/+4: ${r.stacking ? 'On' : 'Off'}`], ['until', `Draw till playable: ${r.drawUntilPlayable ? 'On' : 'Off'}`], ['timer', `Turn timer: ${r.turnSeconds ? r.turnSeconds + 's' : 'Off'}`]], 74, 610, W - 148, 60, 14, 'toggle').map((x) => ({
          ...x,
          on: x.id === 'stack' ? !!r.stacking : x.id === 'until' ? r.drawUntilPlayable : r.turnSeconds > 0,
        })),
      );
    }
    const filled = l.seats.filter((s) => s).length;
    const everyoneReady = l.seats.every((s) => !s || s.ai || s.ready || s.id === l.hostId || !s.connected);
    b.push({ id: 'leave', label: 'Leave room', x: 74, y: 720, w: 220, h: 70 });
    // without a microphone (declined or none) say so, rather than show a "Mic on" that does nothing
    if (this.voice) b.push(this.voice.problem ? { id: 'mic', label: 'No mic', x: 314, y: 720, w: 180, h: 70, disabled: true } : { id: 'mic', label: this.voice.muted ? 'Mic off' : 'Mic on', x: 314, y: 720, w: 180, h: 70, kind: 'toggle', on: !this.voice.muted });
    if (host) b.push({ id: 'start', label: filled < 2 ? 'Add a friend or bot' : everyoneReady ? 'Start game  →' : 'Waiting for ready…', x: W - 434, y: 720, w: 360, h: 70, kind: 'primary', disabled: filled < 2 || !everyoneReady });
    else if (l.quick) b.push({ id: 'ready', label: l.seats[me]?.ready ? 'Ready ✓  waiting…' : 'Ready: start now', x: W - 434, y: 720, w: 360, h: 70, kind: l.seats[me]?.ready ? 'toggle' : 'primary', on: true });
    else b.push({ id: 'ready', label: l.seats[me]?.ready ? 'Ready ✓' : 'Ready to play', x: W - 434, y: 720, w: 360, h: 70, kind: l.seats[me]?.ready ? 'toggle' : 'primary', on: true });
    p.set(b, (pp) => {
      this.frame(pp, l.quick ? 'Quick match' : 'Your private table');
      const ctx = pp.ctx;
      text(ctx, `${filled} / 4 seated`, W - 74, 90, 27, { align: 'right', weight: 500, color: '#b2c9c1' });
      roundRect(ctx, 74, 190, 330, 364, 20);
      ctx.fillStyle = 'rgba(39,72,69,0.26)'; ctx.fill();
      ctx.strokeStyle = 'rgba(154,184,171,0.27)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (l.quick) {
        // a public table: who is here, and when the cards come out
        const secs = this.quickDeadline ? Math.max(0, Math.ceil(this.quickDeadline - this.time)) : 0;
        text(ctx, 'P U B L I C   T A B L E', 239, 232, 22, { align: 'center', weight: 550, color: '#b5b8b6' });
        text(ctx, secs > 0 ? `${secs}` : '…', 239, 310, 76, { align: 'center', weight: 750, color: '#edf2ff', glow: '#829bff' });
        text(ctx, secs > 0 ? 'seconds to the deal' : 'Dealing…', 239, 366, 24, { align: 'center', weight: 450, color: '#bbc8e8' });
        text(ctx, 'Players online join you', 239, 430, 24, { align: 'center', weight: 450, color: '#bbc8e8' });
        text(ctx, 'here; computers take', 239, 464, 24, { align: 'center', weight: 450, color: '#bbc8e8' });
        text(ctx, 'any empty seats.', 239, 498, 24, { align: 'center', weight: 450, color: '#bbc8e8' });
        l.seats.forEach((s, i) => {
          const y = 248 + i * 88;
          roundRect(ctx, 430, y - 38, W - 504, 76, 16);
          ctx.fillStyle = i === me ? 'rgba(126,116,211,0.18)' : 'rgba(91,115,172,0.08)'; ctx.fill();
          ctx.strokeStyle = i === me ? 'rgba(167,153,255,0.36)' : 'rgba(151,171,219,0.12)'; ctx.lineWidth = 1; ctx.stroke();
          if (!s) {
            text(ctx, 'Waiting for a player…', 458, y, 28, { weight: 450, color: '#8294bb' });
            return;
          }
          ctx.fillStyle = '#5b5093';
          ctx.beginPath(); ctx.arc(472, y, 26, 0, Math.PI * 2); ctx.fill();
          text(ctx, s.name[0].toUpperCase(), 472, y + 1, 23, { align: 'center', weight: 650, color: '#e4eeff' });
          text(ctx, `${s.name}${i === me ? ' · you' : ''}`, 518, y - 12, 30, { weight: 600, max: 358 });
          text(ctx, !s.connected ? 'Reconnecting' : s.ready ? 'Ready' : 'Here', 518, y + 21, 20, { weight: 450, color: '#9badcf', max: 358 });
          if (s.ready) text(ctx, '✓', W - 109, y, 32, { align: 'center', color: '#8fe3c7' });
        });
        text(ctx, 'Pick Ready to deal now. Stack +2/+4 is on at public tables.', 74, 586, 24, { weight: 450, color: '#a0b7af', max: W - 148 });
        return;
      }
      text(ctx, 'R O O M   C O D E', 239, 232, 22, { align: 'center', weight: 550, color: '#b5b8b6' });
      text(ctx, l.code, 239, 304, 64, { align: 'center', weight: 750, color: '#edf2ff', glow: '#829bff', max: 282 });
      ctx.strokeStyle = 'rgba(142,166,226,0.2)'; ctx.beginPath(); ctx.moveTo(104, 356); ctx.lineTo(374, 356); ctx.stroke();
      text(ctx, 'Send the code to friends.', 239, 404, 25, { align: 'center', weight: 450, color: '#bbc8e8' });
      text(ctx, 'They can join from', 239, 441, 25, { align: 'center', weight: 450, color: '#bbc8e8' });
      text(ctx, 'Join a table.', 239, 478, 27, { align: 'center', weight: 600, color: '#d7c59f' });
      const via = this.conn instanceof OnlineTable ? this.conn.via : 'server';
      const tag = via === 'direct-host' ? 'Hosted on this device' : via === 'direct' ? 'Direct to your host' : 'Private room';
      ctx.fillStyle = '#79d9c5'; ctx.beginPath(); ctx.arc(239 - (tag.length * 5.2) - 12, 523, 4, 0, Math.PI * 2); ctx.fill();
      text(ctx, tag, 239, 523, 20, { weight: 450, align: 'center', color: '#a8c7da' });
      l.seats.forEach((s, i) => {
        const y = 248 + i * 88;
        roundRect(ctx, 430, y - 38, W - 504, 76, 16);
        ctx.fillStyle = i === me ? 'rgba(126,116,211,0.18)' : 'rgba(91,115,172,0.08)'; ctx.fill();
        ctx.strokeStyle = i === me ? 'rgba(167,153,255,0.36)' : 'rgba(151,171,219,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        if (!s) {
          text(ctx, 'Open seat', 458, y, 30, { weight: 450, color: '#8294bb' });
          return;
        }
        ctx.fillStyle = s.ai ? '#426a91' : '#5b5093';
        ctx.beginPath(); ctx.arc(472, y, 26, 0, Math.PI * 2); ctx.fill();
        text(ctx, s.ai ? 'AI' : s.name[0].toUpperCase(), 472, y + 1, 23, { align: 'center', weight: 650, color: '#e4eeff' });
        text(ctx, `${this.seatTitle(i)}${i === me ? ' · you' : ''}`, 518, y - 12, 30, { weight: 600, max: 358 });
        text(ctx, !s.connected ? 'Reconnecting' : s.ai ? 'House player' : s.id === l.hostId ? 'Room host' : 'Friend', 518, y + 21, 20, { weight: 450, color: '#9badcf', max: 358 });
        if (!s.ai) text(ctx, s.ready || s.id === l.hostId ? '✓' : '…', W - 109, y, 32, { align: 'center', color: s.ready || s.id === l.hostId ? '#8fe3c7' : '#8b9fc6' });
      });
      const hosting = this.conn instanceof OnlineTable && this.conn.via === 'direct-host';
      const note = hosting ? 'This device runs the table: keep it open. Start when everyone is ready.' : host ? 'Make yourself comfortable. Start when everyone is ready.' : 'Ready up when you are comfortable. Your host will deal.';
      text(ctx, note, 74, 586, 24, { weight: 450, color: hosting ? '#d9c7a2' : '#a0b7af', max: W - 148 });
    }, (id) => this.press(id));
  }

  /**
   * Choose who you are. The menu becomes a narrow card standing to your left, so the hero it
   * describes stays in full view across the table (it never covers them, on a monitor or in VR).
   */
  private renderAvatar(): void {
    const p = this.panel;
    const W = p.W;
    const H = p.H;
    const L = this.settings.look;
    const arrows = (id: string, y: number, h = 84): Button[] => [
      { id: `${id}-`, label: '‹', x: 56, y, w: 92, h, kind: 'key' },
      { id: `${id}+`, label: '›', x: W - 148, y, w: 92, h, kind: 'key' },
    ];
    const done: Button = { id: 'done', label: 'Done', x: 56, y: H - 136, w: W - 112, h: 84, kind: 'primary' };
    if (peopleReady()) {
      // choose which character you appear as; they sit across the table to show you
      const want = (((L[0] ?? 0) % castSize()) + castSize()) % castSize();
      if (!(this.preview instanceof PersonAvatar) || this.preview.person !== want) {
        this.preview?.root.removeFromParent();
        const rig = createPersonRig(want);
        this.preview = rig ? new PersonAvatar(rig) : null;
        if (this.preview) {
          this.preview.root.rotation.y = Math.PI;
          this.root.add(this.preview.root);
        }
      }
      if (this.preview) this.preview.root.visible = true;
      p.set([this.nameField(56, 214, W - 112, 84), ...arrows('person', 398), done], (pp) => {
        this.frame(pp, 'Your hero');
        const ctx = pp.ctx;
        text(ctx, 'N A M E', 58, 190, 22, { weight: 600, color: '#bcb095' });
        text(ctx, 'A P P E A R   A S', 58, 374, 22, { weight: 600, color: '#bcb095' });
        text(ctx, useHeroes() ? heroTitle(want) : PEOPLE[want], W / 2, 440, 44, { weight: 700, align: 'center', max: W - 340 });
        // which one of the cast this is
        const n = castSize();
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.arc(W / 2 + (i - (n - 1) / 2) * 28, 516, i === want ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = i === want ? '#e8d3a6' : 'rgba(190,196,192,0.35)';
          ctx.fill();
        }
        text(ctx, useHeroes() ? HERO_LINES[want % HERO_LINES.length] : 'Photo-scanned people, wearing a headset like you.', W / 2, 578, 28, { weight: 450, align: 'center', color: '#d2d6d2', max: W - 112 });
        text(ctx, 'That\u2019s you, across the table  \u2192', W / 2, 648, 26, { weight: 450, align: 'center', color: '#a9bcc0', max: W - 112 });
      }, (id) => this.press(id));
      return;
    }
    if (!(this.preview instanceof HumanAvatar)) {
      this.preview?.root.removeFromParent();
      this.preview = new HumanAvatar();
      this.preview.root.rotation.y = Math.PI;
      this.preview.root.position.set(0, 0, 0);
      this.root.add(this.preview.root);
    }
    this.preview.setLook(this.settings.look);
    this.preview.root.visible = true;
    const rows: [string, string, string, number | null][] = [
      ['name', 'Name', this.profile().name, null],
      ['skin', 'Skin', `${(L[0] ?? 0) + 1} / ${SKIN.length}`, SKIN[L[0] ?? 0]],
      ['style', 'Hairstyle', ['Short', 'Curls', 'Long', 'Buzz'][(L[3] ?? 0) % HAIR_STYLES], null],
      ['hair', 'Hair colour', `${(L[1] ?? 0) + 1} / ${HAIR.length}`, HAIR[L[1] ?? 0]],
      ['fit', 'Hoodie', `${(L[2] ?? 0) + 1} / ${OUTFIT.length}`, OUTFIT[L[2] ?? 0]],
    ];
    const b: Button[] = [done];
    rows.forEach(([id], i) => {
      if (id === 'name') b.push({ id: 'editname', label: 'Change', x: W - 250, y: 168, w: 194, h: 68, kind: 'key' });
      else b.push({ id: `${id}-`, label: '‹', x: W - 250, y: 168 + i * 100, w: 84, h: 68, kind: 'key' }, { id: `${id}+`, label: '›', x: W - 140, y: 168 + i * 100, w: 84, h: 68, kind: 'key' });
    });
    p.set(b, (pp) => {
      this.frame(pp, 'Your avatar');
      const ctx = pp.ctx;
      rows.forEach(([, k, v, swatch], i) => {
        const y = 168 + i * 100;
        text(ctx, k, 58, y + 14, 22, { color: '#b5b8b6' });
        text(ctx, v, 58, y + 50, 30, { weight: 700, max: W - 380 });
        if (swatch !== null) {
          ctx.fillStyle = `#${swatch.toString(16).padStart(6, '0')}`;
          ctx.beginPath();
          ctx.arc(W - 290, y + 34, 20, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      text(ctx, 'Your avatar is shown across the table.', W / 2, H - 172, 22, { weight: 450, align: 'center', color: '#9fb3b8', max: W - 112 });
    }, (id) => this.press(id));
  }

  private renderSettings(): void {
    const p = this.panel;
    const W = p.W;
    const s = this.settings;
    const b: Button[] = [];
    (['master', 'fx', 'music', 'voice'] as const).forEach((k, i) => {
      const y = 240 + i * 84;
      b.push({ id: `${k}-`, label: '−', x: 316, y, w: 60, h: 60 }, { id: `${k}+`, label: '+', x: 464, y, w: 60, h: 60 });
    });
    b.push(
      { id: 'rfx', label: `Reduced effects: ${s.reducedEffects ? 'On' : 'Off'}`, x: 626, y: 240, w: W - 700, h: 60, kind: 'toggle', on: s.reducedEffects },
      { id: 'rflash', label: `Reduced flashing: ${s.reducedFlashing ? 'On' : 'Off'}`, x: 626, y: 324, w: W - 700, h: 60, kind: 'toggle', on: s.reducedFlashing },
      { id: 'pranks', label: `Toys thrown at me: ${s.pranks ? 'Allowed' : 'Off'}`, x: 626, y: 408, w: W - 700, h: 60, kind: 'toggle', on: s.pranks },
      { id: 'tut', label: `Tutorial hints: ${s.tutorial ? 'On' : 'Off'}`, x: 626, y: 492, w: W - 700, h: 60, kind: 'toggle', on: s.tutorial },
      { id: 'world', label: `Arena: ${worldInfo(s.world).title}  ›`, x: 626, y: 576, w: W - 700, h: 60, kind: 'toggle', on: true },
      { id: 'h-', label: 'Lower', x: 316, y: 626, w: 82, h: 52 },
      { id: 'h+', label: 'Raise', x: 418, y: 626, w: 82, h: 52 },
      { id: 'back', label: 'Done', x: W - 290, y: 710, w: 236, h: 76, kind: 'primary' },
    );
    p.set(b, (pp) => {
      this.frame(pp, 'Audio & comfort');
      const ctx = pp.ctx;
      text(ctx, 'S O U N D', 74, 194, 20, { weight: 500, color: '#bcb095' });
      text(ctx, 'Y O U R   S P A C E', 626, 194, 20, { weight: 500, color: '#bcb095' });
      const names = ['Master', 'Effects', 'Music', 'Voice chat'];
      (['master', 'fx', 'music', 'voice'] as const).forEach((k, i) => {
        const y = 270 + i * 84;
        text(ctx, names[i], 74, y, 30, { weight: 450, color: '#d1cbd0' });
        text(ctx, `${Math.round(s[k] * 100)}%`, 420, y, 28, { weight: 550, align: 'center', color: '#e8e0d0' });
      });
      ctx.strokeStyle = 'rgba(188,179,157,0.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(574, 184); ctx.lineTo(574, 686); ctx.stroke();
      text(ctx, 'Cards height', 74, 652, 30, { weight: 450, color: '#d1cbd0' });
      text(ctx, 'Seated, stationary play.', 74, 733, 24, { weight: 450, color: '#b4acb3' });
      text(ctx, 'Settle in at your own pace.', 74, 767, 21, { weight: 400, color: '#8d8c9e' });
      text(ctx, `Music: “${worldInfo(this.settings.world).track}” by Kevin MacLeod (incompetech.com), CC BY 4.0`, 626, 667, 17, { weight: 400, color: '#8d8c9e', max: W - 700 });
    }, (id) => this.press(id));
  }

  /**
   * Switch the world round the table. Hero worlds swap in place (no reload, so a VR session
   * carries on); the penthouse seats a different cast, so going to or from it reloads.
   */
  private switchWorld(name: WorldName): void {
    const s = this.settings;
    if (name === s.world) return;
    if ((name === 'lounge') !== (s.world === 'lounge')) {
      if (this.immersive) {
        this.arenaNote = 'Leave VR first: the Penthouse loads its own cast.';
        return;
      }
      s.world = name;
      this.saveSettings();
      location.reload();
      return;
    }
    s.world = name;
    this.saveSettings();
    setSavedWorld(name);
    // the music starts crossfading at once; the picture follows behind a short fade
    this.sound.playTrack(worldInfo(name).music);
    this.arenaNote = '';
    if (this.swap) {
      this.swapNext = name;
      return;
    }
    this.swap = { name, phase: 'cover', t: 0, frames: 0, ready: false, held: [] };
  }

  /** Replace the world round the table (under the veil). */
  private buildWorld(name: WorldName): void {
    const s = this.settings;
    const old = this.lounge as { dispose?: () => void; root: Object3D };
    if (old.dispose) old.dispose();
    else old.root.removeFromParent();
    const next = makeWorld(name);
    this.lounge = next;
    this.builtWorld = name;
    this.root.add(next.root);
    void next.load();
    next.setReducedMotion(s.reducedEffects || s.reducedFlashing);
    (next as { setLean?: (on: boolean) => void }).setLean?.(this.quality >= 2);
    next.setMixedReality(this.mixedReality);
    next.setGlow(this.view ? COLOR_HEX[this.view.color] : 0x719e94, 1);
    // one still update now: the world attaches its fog to the scene before the shaders are
    // compiled, or they would be built without fog and built again on the first real frame
    next.update(0, this.time);
    shareDepthMaterials(next.root);
    singlePassTransparent(next.root);
    this.panel.setBackdropImage(worldInfo(name).art);
    this.onWorldChanged?.(name);
  }

  /**
   * A world change, step by step: fade to dark (0.22 s); build the new world but keep it hidden
   * (its lights stay on, so nothing already on screen needs new shaders) while its shaders
   * compile in the background; upload its textures and draw it a few frames under the cover;
   * then fade it in. No frame stalls, and nothing half-built is ever seen.
   */
  private updateSwap(dt: number): void {
    const s = this.swap;
    if (!s) return;
    this.veil.position.copy(this.viewer);
    s.t += dt;
    if (s.phase === 'cover') {
      const k = Math.min(1, s.t / 0.22);
      this.veil.visible = true;
      this.veilMat.opacity = k * k * (3 - 2 * k);
      if (k < 1) return;
      this.buildWorld(s.name);
      for (const c of this.lounge.root.children) {
        if (!(c as { isLight?: boolean }).isLight && c.visible) {
          c.visible = false;
          s.held.push(c);
        }
      }
      s.phase = 'warm';
      s.t = 0;
      if (this.warmup) void this.warmup.compile(2500).then(() => (s.ready = true));
      else s.ready = true;
    } else if (s.phase === 'warm') {
      if (!s.ready && s.t < 2.6) return;
      for (const c of s.held) c.visible = true;
      s.held = [];
      this.warmup?.textures(this.lounge.root);
      s.phase = 'show';
      s.frames = 0;
      s.t = 0;
    } else if (s.phase === 'show') {
      // Draw the new world under the cover until the GPU has caught up (its textures and
      // geometry uploaded, its shaders finished): two steady frames in a row, or 1.6 s at most.
      // Only then fade in, so the reveal itself never stutters.
      this.warmup?.step(4);
      s.frames = dt < 0.03 && !this.warmup?.pending ? s.frames + 1 : 0;
      if (s.frames < 2 && s.t < 1.6) return;
      s.phase = 'reveal';
      s.t = 0;
    } else {
      const k = Math.min(1, s.t / 0.5);
      this.veilMat.opacity = 1 - k * k * (3 - 2 * k);
      if (k < 1) return;
      this.veil.visible = false;
      this.swap = null;
      const next = this.swapNext;
      this.swapNext = null;
      if (next && next !== this.builtWorld) this.swap = { name: next, phase: 'cover', t: 0, frames: 0, ready: false, held: [] };
    }
  }

  /**
   * Once the world has loaded: build the toys, effect textures and every shader now, in the
   * background, so nothing compiles or uploads the first time it is seen mid-game.
   */
  prewarm(): void {
    if (!this.warmup) return;
    this.pranks.prewarm();
    this.magic.prewarm();
    // the veil is drawn (invisibly) for a moment too, so the first world change finds it ready
    this.veil.visible = true;
    this.veilMat.opacity = 0;
    this.veilWarm = 30;
    shareDepthMaterials(this.root);
    singlePassTransparent(this.root);
    this.warmShaders(8000);
    this.warmup.textures(this.root);
  }
  private veilWarm = 0;
  /** Lets the card deck and effects restyle when the world changes. */
  onWorldChanged: ((w: WorldName) => void) | null = null;
  private arenaNote = '';

  /** Choose an arena: big illustrated cards, the current one marked. */
  private renderArena(): void {
    const p = this.panel;
    const W = p.W;
    const current = this.settings.world;
    const arenas = WORLDS.filter((w) => w.family === 'arena');
    const classic = WORLDS.filter((w) => w.family === 'classic');
    const b: Button[] = [];
    const gap = 22;
    const cw = (W - 148 - gap * 2) / 3;
    arenas.forEach((w, i) => b.push(this.arenaCard(w.id, 74 + i * (cw + gap), 214, cw, 318, current === w.id, true)));
    const cw2 = (W - 148 - gap) / 2;
    classic.forEach((w, i) => b.push(this.arenaCard(w.id, 74 + i * (cw2 + gap), 590, cw2, 104, current === w.id, false)));
    b.push({ id: 'back', label: 'Done', x: W - 290, y: 722, w: 236, h: 70, kind: 'primary' });
    p.set(b, (pp) => {
      this.frame(pp, 'Choose your arena');
      const ctx = pp.ctx;
      text(ctx, 'T H E   A R E N A S', 74, 192, 20, { weight: 600, color: '#d7b8ff' });
      if (classic.length) text(ctx, 'C L A S S I C', 74, 570, 20, { weight: 600, color: '#bcb095' });
      const note = this.arenaNote || (this.immersive ? 'Arenas change instantly. Stay seated.' : PENTHOUSE ? 'Arenas change instantly. The Penthouse reloads with its own cast.' : 'Arenas change instantly.');
      text(ctx, note, 74, 757, 22, { weight: 450, color: this.arenaNote ? '#ffb4a8' : '#a9b2c0', max: W - 420 });
    }, (id) => this.press(id));
  }

  private arenaCard(id: WorldName, x: number, y: number, w: number, h: number, selected: boolean, tall: boolean): Button {
    const info = worldInfo(id);
    return {
      id: `w:${id}`, x, y, w, h,
      paint: (ctx, btn, hover) => {
        ctx.save();
        roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 18);
        ctx.clip();
        const img = arenaArt(info.art, () => {
          if (this.screen === 'arena') this.panel.redraw();
        });
        const zoom = hover ? 1.06 : 1;
        const iw = tall ? btn.w : btn.w * 0.42;
        if (img) {
          const sc = Math.max(iw / img.naturalWidth, btn.h / img.naturalHeight) * zoom;
          const dw = img.naturalWidth * sc;
          const dh = img.naturalHeight * sc;
          ctx.save();
          ctx.beginPath();
          ctx.rect(btn.x, btn.y, iw, btn.h);
          ctx.clip();
          ctx.drawImage(img, btn.x + (iw - dw) / 2, btn.y + (btn.h - dh) / 2, dw, dh);
          ctx.restore();
        } else {
          const g = ctx.createLinearGradient(btn.x, btn.y, btn.x + btn.w, btn.y + btn.h);
          g.addColorStop(0, info.family === 'arena' ? '#2a1c5c' : '#16313a');
          g.addColorStop(1, info.family === 'arena' ? '#0c0a24' : '#08161c');
          ctx.fillStyle = g;
          ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
        }
        if (tall) {
          const shade = ctx.createLinearGradient(0, btn.y + btn.h * 0.45, 0, btn.y + btn.h);
          shade.addColorStop(0, 'rgba(6,5,18,0)');
          shade.addColorStop(1, 'rgba(6,5,18,0.94)');
          ctx.fillStyle = shade;
          ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
          text(ctx, info.title, btn.x + 22, btn.y + btn.h - 66, 32, { weight: 700, color: '#fff6e6', max: btn.w - 40 });
          text(ctx, info.tag, btn.x + 22, btn.y + btn.h - 28, 18, { weight: 450, color: '#cbc3e6', max: btn.w - 40 });
        } else {
          ctx.fillStyle = 'rgba(8,12,20,0.92)';
          ctx.fillRect(btn.x + iw, btn.y, btn.w - iw, btn.h);
          text(ctx, info.title, btn.x + iw + 22, btn.y + 40, 28, { weight: 650, color: '#fff3df', max: btn.w - iw - 40 });
          text(ctx, info.tag, btn.x + iw + 22, btn.y + 76, 17, { weight: 450, color: '#a9b7bb', max: btn.w - iw - 36 });
        }
        ctx.restore();
        roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 18);
        ctx.lineWidth = selected ? 4 : hover ? 2.5 : 1.2;
        ctx.strokeStyle = selected ? '#f2cf7c' : hover ? 'rgba(214,190,255,0.9)' : 'rgba(190,180,220,0.3)';
        if (selected || hover) {
          ctx.shadowColor = selected ? 'rgba(242,207,124,0.55)' : 'rgba(170,130,255,0.5)';
          ctx.shadowBlur = 18;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (selected) {
          roundRect(ctx, btn.x + 14, btn.y + 14, 124, 32, 16);
          ctx.fillStyle = 'rgba(242,207,124,0.95)';
          ctx.fill();
          text(ctx, '✓  IN PLAY', btn.x + 76, btn.y + 31, 16, { weight: 700, align: 'center', color: '#2a1d08' });
        }
      },
    };
  }

  private renderPause(): void {
    const p = this.panel;
    const W = p.W;
    const b: Button[] = [
      { id: 'resume', label: 'Resume', x: W / 2 - 220, y: 260, w: 440, h: 96, kind: 'primary' },
      { id: 'settings', label: 'Audio & Comfort', x: W / 2 - 220, y: 380, w: 440, h: 80 },
      { id: 'avatar', label: 'Avatar', x: W / 2 - 220, y: 484, w: 210, h: 80 },
      { id: 'recenter', label: 'Re-seat me', x: W / 2 + 10, y: 484, w: 210, h: 80 },
      { id: 'leave', label: 'Leave table', x: W / 2 - 220, y: 612, w: 440, h: 80, kind: 'danger' },
    ];
    p.set(b, (pp) => {
      this.frame(pp);
      text(pp.ctx, 'Paused', W / 2, 150, 72, { weight: 800, align: 'center' });
      if (this.conn?.online) text(pp.ctx, 'The game continues for others.', W / 2, 205, 28, { align: 'center', color: '#b5b8b6' });
    }, (id) => this.press(id));
  }

  private renderResults(): void {
    const l = this.lobby;
    const v = this.view;
    if (!l || !v) return;
    const p = this.panel;
    const W = p.W;
    const me = this.mySeat();
    const winner = l.seats[v.winner];
    const humans = l.seats.filter((s) => s && !s.ai && s.connected).length;
    const b: Button[] = [
      { id: 'lobby', label: this.conn?.online ? 'Back to lobby' : 'Main menu', x: 70, y: 720, w: 300, h: 80 },
      { id: 'rematch', label: this.conn?.online ? `Rematch (${l.rematch.length}/${humans})` : 'Rematch', x: W - 420, y: 720, w: 350, h: 80, kind: 'primary' },
    ];
    if (v.winner !== me) {
      const toys = TOYS.filter(([k]) => k === 'dart' || k === 'chicken' || k === 'confetti' || k === 'hammer');
      toys.forEach(([k, , name], i) => b.push({ id: `prank:${k}`, x: W / 2 + (i - toys.length / 2) * 190, y: 600, w: 190, h: 106, paint: iconTile(TOY_ICONS[k], name) }));
    }
    p.set(b, (pp) => {
      this.frame(pp);
      const ctx = pp.ctx;
      const mine = v.winner === me;
      // the same names the table uses (computer players are the heroes in hero worlds)
      text(ctx, mine ? 'You win!' : `${winner ? this.seatTitle(v.winner) : 'Someone'} wins`, W / 2 - 60, 144, 76, { weight: 900, align: 'center', color: mine ? '#e6cea1' : '#e8c6b9', glow: mine ? '#c3a776' : '#b47b65', max: W - 380 });
      // standings by cards left
      const order = [0, 1, 2, 3].filter((s) => l.seats[s]).sort((a, b2) => v.counts[a] - v.counts[b2]);
      order.forEach((s, i) => {
        const y = 270 + i * 80;
        const info = l.seats[s]!;
        text(ctx, `${i + 1}`, 110, y, 36, { weight: 800, color: i === 0 ? '#e6cea1' : '#bac6e5' });
        text(ctx, `${this.seatTitle(s)}${s === me ? ' (you)' : ''}`, 170, y, 34, { weight: 700, max: W - 640 });
        // two right-aligned columns that cannot run into each other
        text(ctx, i === 0 ? '👑' : `${v.counts[s]} card${v.counts[s] === 1 ? '' : 's'} left`, W - 260, y, 30, { color: '#b5b8b6', align: 'right', max: 230 });
        text(ctx, `${info.wins} win${info.wins === 1 ? '' : 's'}`, W - 110, y, 26, { color: '#8b9fc6', align: 'right', max: 120 });
      });
      if (!mine) text(ctx, 'Feeling salty? Face someone and pick a toy:', 74, 580, 27, { color: '#d2a38e' });
      // the winning card
      drawCardTo(ctx, v.top, W - 174, 44, 104);
    }, (id) => this.press(id));
  }

  private renderDock(): void {
    const v = this.view;
    const d = this.dock;
    const tray = this.tray;
    // An open tray is a taller panel of picture tiles that grows upward from the bar. Beside
    // you on the right (a metre away) it is also wider, keeping its right edge and growing
    // toward the table. In the narrow layout it lies centred under your cards, close enough
    // that the bar's own width already fills a narrow view from side to side.
    d.resize(tray && !this.narrow ? 0.52 : 0.44, tray ? 0.14 : 0.1, this.narrow ? 0 : 1);
    const W = d.W;
    const H = d.H;
    const myTurn = !!v && v.phase === 'play' && v.current === v.seat;
    const b: Button[] = [];
    let title = '';
    const tiles = (heading: string, items: [string, Icon, string][]) => {
      title = heading;
      const top = 46;
      const pitch = (W - 28) / (items.length + 1);
      b.push({ id: 'close', x: 14, y: top, w: pitch, h: H - top - 14, paint: iconTile(GLYPHS.back, 'Back', true) });
      items.forEach(([id, icon, caption], i) => b.push({ id, x: 14 + (i + 1) * pitch, y: top, w: pitch, h: H - top - 14, paint: iconTile(icon, caption) }));
    };
    const revenge = this.revengeSeat >= 0 && this.toyTargets().includes(this.revengeSeat);
    if (tray === 'emote') tiles('R E A C T', EMOTES.map(([k, caption]) => [`e:${k}`, EMOTE_ICONS[k], caption]));
    else if (tray === 'toy') tiles(revenge ? `G E T   E V E N   W I T H   ${this.seatTitle(this.revengeSeat).toUpperCase().split('').join(' ')}` : 'T H R O W   A   T O Y', TOYS.map(([k, caption]) => [`t:${k}`, TOY_ICONS[k], caption]));
    else if (tray === 'target') {
      const targets = this.toyTargets();
      tiles(targets.length ? 'T H R O W   A T' : 'N O B O D Y   T O   T H R O W   A T', targets.map((seat) => {
        const name = this.seatTitle(seat);
        return [`at:${seat}`, initialIcon(name[0] ?? '?', TARGET_COLORS[seat % TARGET_COLORS.length]), name];
      }));
    } else {
      const y = 28;
      const h = H - 56;
      // (drawn, not typed: a pause or play character comes out as a coloured sticker on some devices)
      const plain = (c: CanvasRenderingContext2D, bb: Button, hover: boolean) => drawButton(c, { ...bb, paint: undefined, label: '' }, hover);
      const paused = this.screen === 'pause';
      b.push({ id: paused ? 'resume' : 'pause', x: 14, y, w: 70, h, paint: (c, bb, hover) => {
        plain(c, bb, hover);
        drawIcon(c, paused ? GLYPHS.play : GLYPHS.pause, bb.x + bb.w / 2, bb.y + bb.h / 2, 24);
      } });
      const pictured = (id: string, label: string, icon: Icon, x: number, w: number) => b.push({ id, x, y, w, h, paint: (c, bb, hover) => {
        plain(c, bb, hover);
        drawIcon(c, icon, bb.x + 30, bb.y + bb.h / 2, 21);
        text(c, label, bb.x + 56, bb.y + bb.h / 2 + 1, 27, { weight: 600, color: '#ede7da', max: bb.w - 62 });
      } });
      pictured('emotes', 'React', EMOTE_ICONS.laugh, 92, 116);
      if (revenge) b.push({ id: 'toys', label: 'Get even!', x: 216, y, w: 108, h, kind: 'primary' });
      else pictured('toys', 'Toys', TOY_ICONS.chicken, 216, 100);
      const left = this.timeLeft();
      const clock = left >= 0 ? ` · ${left}s` : '';
      const x = 332;
      const w = W - x - 14;
      const owed = myTurn ? v!.pending ?? 0 : 0;
      if (owed > 0) b.push({ id: 'draw', label: `Take +${owed}${clock}`, x, y, w, h, kind: 'danger' });
      else if (myTurn && v!.hasDrawn) b.push({ id: 'keep', label: `Keep & pass${clock}`, x, y, w, h, kind: 'primary' });
      else if (myTurn && !v!.hasDrawn) b.push({ id: 'draw', label: `Draw a card${clock}`, x, y, w, h });
      else b.push({ id: 'x', label: v && v.current >= 0 ? `${this.seatTitle(v.current)}’s turn${clock}` : '', x, y, w, h, disabled: true });
    }
    d.set(b, (pp) => {
      if (!tray) return glass(pp.ctx, 4, 18, pp.W - 8, pp.H - 36, 24);
      glass(pp.ctx, 4, 6, pp.W - 8, pp.H - 12, 26);
      text(pp.ctx, title, 30, 28, 16, { weight: 650, color: '#bcb095', max: pp.W - 60 });
    }, (id) => this.pressDock(id));
  }

  // ------------------------------------------------------------ frame

  update(dt: number, inp: FrameInput): void {
    // a long hitch slows the animation down instead of skipping it
    dt = Math.min(dt, 0.1) * this.timeScale;
    this.time += dt;
    const t = this.time;
    if (this.immersive !== inp.immersive) {
      this.immersive = inp.immersive;
      this.panel.ambientMotion = false;
      if (this.screen === 'title') this.renderTitle();
    }
    this.viewer.copy(inp.head);
    this.updateSwap(dt);
    if (this.veilWarm > 0 && --this.veilWarm === 0 && !this.swap) this.veil.visible = false;
    // textures queued by the warm-up go up a couple a frame
    this.warmup?.step(2);
    this.placeFan(dt);
    if (this.revengeSeat >= 0 && this.time > this.revengeUntil) {
      this.revengeSeat = -1;
      this.renderDock();
    }
    this.viewerFwd.set(0, 0, -1).applyQuaternion(inp.headQ);
    this.sound.listener(this.viewer, this.viewerFwd);

    // effect timers, then the event timeline
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= t) this.timers.splice(i, 1)[0].fn();
    }
    // Pace the host's events one after another. While idle the timer must not run on into the
    // negative, or the next burst of events (a play, a Draw Four, the draws, a skip) would all
    // fire in the same frame instead of in sequence.
    this.wait = this.queue.length ? this.wait - dt : Math.max(0, this.wait - dt);
    while (this.wait <= 0 && this.queue.length) {
      this.wait += this.run(this.queue.shift()!);
    }
    if (this.wait <= 0 && this.queue.length === 0 && this.pendingView) this.applyView();
    if (this.resultsAt && t >= this.resultsAt && this.lobby?.phase === 'results') {
      this.resultsAt = 0;
      this.show('results');
    }

    // hands, in table space
    const hands: Record<'left' | 'right', HandInput> = { left: { pos: null, pinching: false, started: false, ended: false }, right: { pos: null, pinching: false, started: false, ended: false } };
    let touchColor = -1;
    for (const side of ['left', 'right'] as const) {
      const h = inp.hands[side];
      if (!h.pos) continue;
      hands[side] = { pos: h.pos, pinching: h.pinching, started: h.started, ended: h.ended };
      // a fingertip at a colour petal swells it; a direct pinch there picks it
      if (this.picker.open) {
        const c = this.picker.near(h.pos);
        if (c >= 0) {
          touchColor = c;
          if (h.started) this.pickColor(c as Color);
        }
      }
    }
    if (this.screen === 'game' || this.screen === 'results') this.table.update(dt, hands);
    else this.table.update(dt, { left: { ...hands.left, started: false }, right: { ...hands.right, started: false } });

    // seated people: plates and their voices
    const states = new Map<number, { info: SeatInfo; count: number; turn: boolean; crown: boolean }>();
    if (this.lobby) {
      this.lobby.seats.forEach((s, seat) => {
        if (!s) return;
        states.set(seat, {
          info: s,
          count: this.view ? this.view.counts[seat] : -1,
          turn: !!this.view && this.view.phase === 'play' && this.view.current === seat,
          crown: !!this.view && this.view.phase === 'over' && this.view.winner === seat,
        });
        const av = this.cast.get(seat);
        if (av && this.voice && !s.ai) {
          this.seatHead(seat, _v);
          av.voice = this.voice.place(s.id, _v.x, _v.y, _v.z);
        }
      });
    }
    this.cast.plates(states);
    // everyone watches whoever is playing (or the pile)
    const look = this.view && this.view.phase === 'play' ? (this.view.current === this.mySeat() ? this.viewer : this.seatHead(this.view.current, _v2)) : PILE;
    // a card on its way to the pile or out of the deck takes its owner's free hand with it
    const playing = !!this.view && this.view.phase === 'play';
    for (const [seat, av] of this.cast.all()) {
      if (!(av instanceof PersonAvatar)) continue;
      const w = this.table.handReach(av.slot, _v);
      av.setReach(w > 0 ? this.table.group.localToWorld(_v) : null, w);
      av.myTurn = playing && this.view!.current === seat;
    }
    this.cast.update(dt, t, this.viewer, look);
    // each opponent's fan is fixed to their card hand
    this.table.group.getWorldQuaternion(_q).invert();
    for (const [, av] of this.cast.all()) {
      if (av instanceof PersonAvatar) this.table.setFanAnchor(av.slot, this.table.group.worldToLocal(_v.copy(av.rig.fanPos)), _q2.copy(_q).multiply(av.rig.fanQuat));
      else this.table.clearFanAnchor(av.slot);
    }
    this.updateSelf(dt, t);
    this.mascot.lookAt.copy(look);
    this.mascot.update(dt, t, this.viewer);
    if (this.preview?.root.visible) this.preview.update(dt, t, this.viewer);

    this.lounge.viewer.copy(this.viewer);
    this.table.viewer.copy(this.viewer);
    this.lounge.update(dt, t);
    this.fx.update(dt, this.viewer);
    this.magic.update(dt, this.viewer);
    this.picker.update(dt, this.viewer, this.pointColor >= 0 ? this.pointColor : touchColor);
    this.pranks.update(dt);
    this.panel.update(dt);
    this.dock.update(dt);
    this.hint.update(dt);
    if (this.hint.visible && t > this.hintUntil) this.hint.visible = false;
    // a public lobby counts down to the deal
    if (this.screen === 'lobby' && this.quickDeadline) {
      const secs = Math.max(0, Math.ceil(this.quickDeadline - this.time));
      if (secs !== this.quickShown) {
        this.quickShown = secs;
        this.renderLobby();
      }
    }
    const left = this.timeLeft();
    if (left !== this.timerShown && this.screen === 'game') {
      this.timerShown = left;
      this.renderDock();
      if (left > 0 && left <= 5 && this.view?.current === this.view?.seat) this.sound.tick(left <= 2);
    }
    // Menus face you. In a headset they turn toward your head; on a monitor they stay square
    // to the screen, because a wide-angle desktop view would otherwise skew any panel that
    // sits off to one side (the avatar card).
    if (this.immersive) faceTablePoint(this.panel.group, this.viewer);
    else this.panel.group.quaternion.copy(inp.headQ);

    // Send my pose (seat space) 12 times a second, and only when something moved: a player
    // sitting still sends a keep-alive once a second. Others' rigs ease toward each pose, so this
    // looks as smooth as 20 Hz while using a fraction of the bandwidth (and of a free server's quota).
    this.poseClock -= dt;
    this.poseIdle += dt;
    if (this.conn?.online && inp.immersive && this.poseClock <= 0) {
      this.poseClock = 1 / 12;
      const q = inp.headQ;
      const msg: PoseMsg = {
        seat: this.mySeat(),
        h: [this.viewer.x, this.viewer.y, this.viewer.z, q.x, q.y, q.z, q.w],
        l: inp.hands.left.joints ?? [],
        r: inp.hands.right.joints ?? [],
        v: this.voice?.myLevel() ?? 0,
      };
      if (this.poseIdle >= 1 || poseMoved(this.lastPose, msg)) {
        this.conn.pose(msg);
        this.lastPose = msg;
        this.poseIdle = 0;
      }
    }
  }

  /** Every mesh that takes clicks: cards in your hand. */
  cardTargets(): { id: number; obj: Mesh }[] {
    return this.table.handTargets() as { id: number; obj: Mesh }[];
  }

  /** The wall poster art (also used by tools to export it for Blender). */
  posterArt(width = 1024): HTMLCanvasElement {
    return makePosterCanvas(width);
  }

  /** Name of each colour, for accessibility captions. */
  static colorName(c: Color): string {
    return COLOR_LABEL[c];
  }
}

export type { HouseRules };
