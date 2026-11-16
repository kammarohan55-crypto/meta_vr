/**
 * Messages between the table host (server, or the in-browser host for solo
 * play) and each client. Hands are only ever sent to their owner.
 */
import type { Action, Card, Color, GameEvent, HouseRules, SeatView } from './rules.ts';
import type { Difficulty } from './ai.ts';

export interface Profile {
  name: string;
  /** Index into the client's avatar presets (skin, hair, outfit). */
  look: number[];
}

export interface SeatInfo {
  /** Session id, or 'ai:N' for a computer player. */
  id: string;
  name: string;
  look: number[];
  ai: boolean;
  difficulty: Difficulty;
  ready: boolean;
  connected: boolean;
  /** Took over by the computer after a long disconnect. */
  autopilot: boolean;
  /** Does this player accept prank projectiles? */
  pranks: boolean;
  wins: number;
}

export type TablePhase = 'lobby' | 'game' | 'results';

export interface LobbyMsg {
  code: string;
  hostId: string;
  phase: TablePhase;
  /** Index = seat. null = empty seat. */
  seats: (SeatInfo | null)[];
  rules: HouseRules;
  /** Votes for a rematch on the results screen. */
  rematch: string[];
  round: number;
  /** A public (Quick match) table: strangers are seated here and it starts on its own. */
  quick?: boolean;
  /** Seconds until a public table starts by itself (computer players fill empty seats). */
  startsIn?: number;
}

export interface ViewMsg extends SeatView {
  round: number;
  /** Seconds left on the turn timer, or 0 if there is none. */
  timer: number;
}

export interface EventsMsg {
  round: number;
  events: GameEvent[];
}

/** A tracked pose, relative to the sender's seat (so it is the same for everyone). */
export interface PoseMsg {
  seat: number;
  /** head position xyz + quaternion xyzw */
  h: number[];
  /** left/right hand: wrist xyz + quat xyzw + thumb/index/middle/ring/pinky tip xyz (22 numbers), or [] when untracked */
  l: number[];
  r: number[];
  /** 0..1 voice level for mouth movement */
  v: number;
}

export type EmoteKind = 'laugh' | 'clap' | 'point' | 'facepalm' | 'cheer' | 'angry' | 'cool' | 'cry';
export const EMOTE_KINDS: readonly EmoteKind[] = ['laugh', 'clap', 'point', 'facepalm', 'cheer', 'angry', 'cool', 'cry'];
export type PrankKind = 'dart' | 'confetti' | 'chicken' | 'hammer' | 'snowball' | 'pie';
export const PRANK_KINDS: readonly PrankKind[] = ['dart', 'confetti', 'chicken', 'hammer', 'snowball', 'pie'];

export interface EmoteMsg {
  seat: number;
  kind: EmoteKind;
}

export interface PrankMsg {
  seat: number;
  kind: PrankKind;
  target: number;
  /** launch position and velocity, in table space */
  p: number[];
  vel: number[];
}

export interface RtcMsg {
  from: string;
  to: string;
  data: unknown;
}

/** Client -> host */
export type ClientMsg =
  | { t: 'profile'; profile: Profile; pranks: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'seatAi'; seat: number; on: boolean; difficulty: Difficulty }
  | { t: 'rules'; rules: HouseRules }
  | { t: 'start' }
  | { t: 'act'; action: { type: 'play'; cardId: number; color?: Color } | { type: 'draw' } | { type: 'pass' } }
  | { t: 'rematch' }
  | { t: 'menu' };

export type { Action, Card };

// ------------------------------------------------------------------ wire format
// Every WebSocket frame is one JSON object of these shapes.

/** Client -> server */
export type WireIn =
  | { t: 'create'; profile: Profile; pranks: boolean }
  | { t: 'join'; code: string; profile: Profile; pranks: boolean }
  /** Quick match: any public table with room, or a new one. */
  | { t: 'quick'; profile: Profile; pranks: boolean }
  | { t: 'resume'; code: string; token: string }
  | { t: 'msg'; m: ClientMsg }
  | { t: 'sync' }
  | { t: 'pose'; p: PoseMsg }
  | { t: 'emote'; e: EmoteMsg }
  | { t: 'prank'; p: PrankMsg }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'leave' };

/** Server -> client */
export type WireOut =
  | { t: 'welcome'; code: string; id: string; token: string; resumed: boolean }
  | { t: 'error'; error: string; reason: 'not-found' | 'full' | 'bad-request' | 'server-full' | 'expired' }
  | { t: 'lobby'; m: LobbyMsg }
  | { t: 'view'; m: ViewMsg }
  | { t: 'events'; m: EventsMsg }
  | { t: 'reject'; m: { error: string; view: ViewMsg | null } }
  | { t: 'pose'; m: PoseMsg }
  | { t: 'emote'; m: EmoteMsg }
  | { t: 'prank'; m: PrankMsg }
  | { t: 'rtc'; m: RtcMsg };

/** Seconds a dropped player has to come back before they lose their seat. */
export const RECONNECT_SECONDS = 90;
