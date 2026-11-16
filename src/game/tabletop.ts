/**
 * Cards on the table: the draw pile, the discard pile, every player's fan,
 * and your own hand with its hands-first interaction.
 *
 * Your hand: pinch a card to lift it out of the fan, carry or flick it toward
 * the centre and let go. Near the pile it snaps in. Pinch the draw pile and
 * pull toward you to draw. Every card is also clickable (point and pinch, or
 * a mouse) for anyone who prefers not to reach.
 *
 * Everything here works in table space: origin at the table centre on the
 * floor, your seat toward +Z.
 */
import {
  BoxGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import type { Material } from '@iwsdk/core';
import { BACK_SLOT, CARD_H, CARD_T, CARD_W, cardAtlas, cardGeometry, cardMaterial, isWild, makeCardMesh, setCardFace } from './cards.js';
import type { Card } from './cards.js';
import { TABLE_Y, seatAngle } from './env.js';
import { clamp, damp, easeOutBack, lerp } from './util.js';
import type { ViewMsg } from '../../shared/protocol.ts';

export const PILE = new Vector3(0.07, TABLE_Y + 0.001, 0.02);
export const DRAW = new Vector3(-0.13, TABLE_Y, -0.04);
/** Where each relative seat holds its fan (table space). */
const FAN_R = 0.84;
/** Distance from the pivot in the palm to a held card's centre. */
const FAN_RHO = CARD_H * 0.5 - 0.018;
/** Your own fan pivots about a point this far below its centre. */
const OWN_FAN_R = 0.2;

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _m4 = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _q2 = new Quaternion();
const _e = new Euler();

interface Flight {
  mesh: Object3D;
  from: Vector3;
  fromQ: Quaternion;
  to: Vector3;
  toQ: Quaternion;
  t: number;
  dur: number;
  arc: number;
  delay: number;
  /** The delay it started with (the hand travels to the card in this time). */
  lead: number;
  spin: number;
  done?: () => void;
  /** Whose card this is (relative seat), and whether it is being played or drawn: their hand goes with it. */
  slot: number;
  kind: '' | 'play' | 'draw';
  /** Optional uniform scale at the start and end of the flight (the play reveal enlarges a card). */
  fromS?: number;
  toS?: number;
  /** Hidden until it sets off (cards waiting in the deck to be dealt). */
  show?: boolean;
}

interface CardDrag {
  hc: HandCard | null;
  side: 'left' | 'right';
  drawing: boolean;
  start: Vector3;
  vel: Vector3;
  last: Vector3;
  ghost: Mesh | null;
  /** Pinch contact in the card's own frame; it stays under the fingers. */
  grip: Vector3;
  gripQ: Quaternion;
  age: number;
  travel: number;
  /** Where the card (or deck ghost) was when it was picked up. */
  from: Vector3;
  /** Letting go right now would play the card (for the tick as that becomes true). */
  ready: boolean;
}

/**
 * Push a card this far out of your fan toward the pile and letting go plays it. The pile is a
 * metre from a seated player; this keeps the whole move inside half an arm's length (the
 * competition's "airplane seat" test: every interaction within two feet).
 */
const PUSH_TO_PLAY = 0.11;

export interface HandInput {
  /** fingertip pinch point in table space, or null when the hand is not tracked */
  pos: Vector3 | null;
  pinching: boolean;
  started: boolean;
  ended: boolean;
}

export interface TabletopEvents {
  /** The player released a card in the play zone. */
  play(card: Card): void;
  /** The player pulled a card off the draw pile. */
  draw(): void;
  /** The player tried something that isn't allowed right now. */
  nope(reason: string): void;
  sound(kind: 'pick' | 'slide' | 'place' | 'flick' | 'nope' | 'hover'): void;
}

class HandCard {
  readonly card: Card;
  readonly root = new Group();
  readonly mesh: Mesh;
  readonly hit: Mesh;
  /** resting place in the fan (table space) */
  readonly home = new Vector3();
  readonly homeQ = new Quaternion();
  lift = 0;
  glow = 0;
  playable = false;
  dragging = false;
  pending = false;
  constructor(card: Card, hitMat: MeshBasicMaterial) {
    this.card = card;
    this.mesh = makeCardMesh(card);
    // generous invisible target for rays and clicks
    this.hit = new Mesh(new PlaneGeometry(CARD_W * 1.05, CARD_H * 1.05), hitMat);
    this.hit.position.z = 0.002;
    this.root.add(this.mesh, this.hit);
    this.root.name = `card-${card.id}`;
  }
}

/** Most cards one opponent's fan draws (a hand that large is rare; extra cards simply are not drawn). */
const FAN_MAX = 40;
const _one = new Vector3(1, 1, 1);
const _fm = new Matrix4();
const _fp = new Vector3();
const _fq = new Quaternion();
const _fe = new Euler();

/**
 * One opponent's held cards, drawn as a single instanced mesh. The cards are laid out once,
 * in the fan's own frame, whenever the count changes; the hand holding them (or the seat, for
 * an avatar without hands) then moves the whole fan. Before this each card was its own mesh and
 * draw call and was re-placed every frame.
 */
class HeldFan {
  readonly mesh: InstancedMesh;
  count = 0;
  /** Held in a tracked or animated hand (true) or floating in front of the seat (false). */
  held = false;
  private laid = -1;
  private laidHeld = false;
  constructor(material: Material) {
    this.mesh = new InstancedMesh(cardGeometry(BACK_SLOT), material, FAN_MAX);
    this.mesh.name = 'held-fan';
    this.mesh.count = 0;
    // their faint shadow is not worth a shadow-pass draw, and the fan moves with a hand every frame
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }
  /** Where card `i` of `n` sits in the fan's own frame. */
  static local(i: number, n: number, held: boolean, pos: Vector3, quat: Quaternion): void {
    const spread = Math.min(0.2, 1.4 / Math.max(1, n));
    const a = (i - (n - 1) / 2) * spread;
    if (held) pos.set(Math.sin(a) * FAN_RHO, Math.cos(a) * FAN_RHO, i * 0.0011);
    else pos.set(Math.sin(a) * FAN_RHO, Math.cos(a) * FAN_RHO + 0.1, -i * 0.0012);
    quat.setFromEuler(_fe.set(0, 0, -a));
  }
  /** Lay the cards out again if the count or the way they are held changed. */
  layout(): void {
    const n = Math.min(this.count, FAN_MAX);
    if (n === this.laid && this.held === this.laidHeld) return;
    this.laid = n;
    this.laidHeld = this.held;
    for (let i = 0; i < n; i++) {
      HeldFan.local(i, n, this.held, _fp, _fq);
      this.mesh.setMatrixAt(i, _fm.compose(_fp, _fq, _one));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Tabletop {
  readonly group = new Group();
  private flights: Flight[] = [];
  private discard: Mesh[] = [];
  private drawStack: Mesh;
  private drawTop: Mesh;
  private fans: Map<number, HeldFan> = new Map();
  /** The fans' own copy of the card material: an instanced and a plain mesh sharing one material make three switch shader programs between them on every draw. */
  private fanMat: Material | null = null;
  /** Where each opponent's card hand holds their fan, in table space. */
  private fanAnchor: Map<number, { pos: Vector3; quat: Quaternion }> = new Map();
  readonly hand = new Map<number, HandCard>();
  /**
   * The cards in your hand, in their own group (same frame as the table group). It is a pointer
   * target of its own: the gaze cone decides what you are looking at from each target's
   * bounding box, and a single target the size of the whole table lost cards a hand's length
   * from your eyes part-way through a game (the box test went wrong as the table filled up).
   */
  readonly handGroup = new Group();
  private handOrder: number[] = [];
  /**
   * Invisible click targets (hand cards, the deck). `visible: false` on the material stops three
   * drawing them (they wrote nothing anyway: 8 wasted draw calls a frame); rays still hit them.
   */
  private hitMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0, visible: false });
  readonly drawHit: Mesh;
  /** Cards currently animating toward a fan, so reconciliation leaves them alone. */
  private inbound = new Map<number, number>();
  /** Cards on their way to each opponent's fan (by relative seat), not yet in it. */
  private inboundFan = new Map<number, number>();
  view: ViewMsg | null = null;
  /** How many seats are playing, and where they sit relative to you. */
  slotOfSeat: (seat: number) => number = (s) => s;
  private drag: CardDrag | null = null;
  private near = { left: -1, right: -1 };
  private dropGuide: Mesh;
  private dropMat: MeshBasicMaterial;
  private listener: TabletopEvents;
  /** The card waiting for a colour choice. */
  pendingWild: HandCard | null = null;
  /** Hand fan position, adjustable for comfort (table space). */
  /** Your fan is held up in front of you, like real cards. */
  readonly fanCenter = new Vector3(0, TABLE_Y + 0.265, 0.68);
  fanTilt = -0.42;
  private hoverId = -1;
  /** What a hand ray or a gaze is pointing at: one of your cards (its id), and the deck. */
  private pointId = -1;
  private pointDeck = false;
  private deckLift = 0;
  private drawTopY = TABLE_Y;
  private time = 0;
  private glowMat: MeshBasicMaterial;
  private glowGeo: PlaneGeometry;

  constructor(listener: TabletopEvents) {
    this.listener = listener;
    this.group.name = 'Tabletop';
    // One paper-coloured material: a box with a material per side is a draw call per side (six,
    // and six more in the shadow pass), and the top card covers the only face that differed.
    this.drawStack = new Mesh(new BoxGeometry(CARD_W * 0.995, 1, CARD_H * 0.995), new MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.8 }));
    this.drawStack.castShadow = true;
    this.drawStack.receiveShadow = true;
    this.drawStack.position.copy(DRAW);
    this.drawStack.raycast = () => {};
    this.drawTop = makeCardMesh(null);
    this.drawTop.rotation.set(Math.PI / 2, 0, 0.08);
    this.drawHit = new Mesh(new BoxGeometry(CARD_W * 1.6, 0.08, CARD_H * 1.5), this.hitMat);
    this.drawHit.name = 'draw-pile';
    this.drawHit.position.set(DRAW.x, TABLE_Y + 0.04, DRAW.z);
    this.handGroup.name = 'Hand';
    this.group.add(this.drawStack, this.drawTop, this.drawHit, this.handGroup);
    this.dropMat = new MeshBasicMaterial({ color: 0x7ee3c4, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.dropGuide = new Mesh(new TorusGeometry(0.15, 0.0015, 5, 64), this.dropMat);
    this.dropGuide.name = 'Discard placement guide';
    this.dropGuide.rotation.x = Math.PI / 2;
    this.dropGuide.position.set(PILE.x, TABLE_Y + 0.0035, PILE.z);
    this.dropGuide.raycast = () => {};
    this.group.add(this.dropGuide);
    // a soft halo behind playable cards
    this.glowMat = new MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false });
    this.glowGeo = new PlaneGeometry(CARD_W * 1.18, CARD_H * 1.14);
    cardAtlas();
    this.setDrawCount(80);
  }

  // ------------------------------------------------------------ piles

  setDrawCount(n: number): void {
    const h = Math.max(0.0004, Math.min(n, 108) * 0.00045);
    this.drawStack.scale.y = h;
    this.drawStack.position.y = TABLE_Y + h / 2;
    this.drawTopY = TABLE_Y + h + CARD_T / 2 + 0.0003;
    this.drawTop.position.set(DRAW.x, this.drawTopY + this.deckLift, DRAW.z);
    this.drawTop.visible = n > 0;
    this.drawStack.visible = n > 1;
  }

  private pileSpot(i: number, out: Vector3): Vector3 {
    return out.set(PILE.x, TABLE_Y + 0.0008 + Math.min(i, 30) * 0.0005, PILE.z);
  }

  private pileRot(card: Card, out: Quaternion): Quaternion {
    // each card lands a little skewed, like a real pile
    const r = Math.sin(card.id * 12.9898) * 0.18;
    return out.setFromEuler(_e.set(-Math.PI / 2, 0, r));
  }

  /** Show `top` as the top of the discard pile without animating (sync). */
  setTop(top: Card): void {
    const last = this.discard[this.discard.length - 1];
    if (last && (last.userData.cardId as number) === top.id) return;
    const m = makeCardMesh(top);
    m.userData.cardId = top.id;
    // a card lying flat on the pile throws no visible shadow; skip it in the shadow pass
    m.castShadow = false;
    this.pileSpot(this.discard.length, m.position);
    this.pileRot(top, m.quaternion);
    this.group.add(m);
    this.discard.push(m);
    this.trimPile();
  }

  private trimPile(): void {
    // only the top few cards show; the ones beneath are hidden but still cost a draw each
    while (this.discard.length > 8) {
      const old = this.discard.shift()!;
      old.removeFromParent();
    }
    this.discard.forEach((m, i) => this.pileSpot(i, _v).y < m.position.y + 1 && (m.position.y = this.pileSpot(i, _v).y));
  }

  /** Pull the face card mesh for an incoming play from wherever it is now. */
  private takeSource(seat: number, card: Card, fromMine: boolean): Mesh {
    if (fromMine) {
      const hc = this.hand.get(card.id);
      if (hc) {
        this.hand.delete(card.id);
        this.handOrder = this.handOrder.filter((id) => id !== card.id);
        if (this.pendingWild === hc) this.pendingWild = null;
        const m = hc.mesh;
        hc.root.updateMatrixWorld();
        m.getWorldPosition(_v);
        m.getWorldQuaternion(_q);
        this.group.worldToLocal(_v);
        this.group.add(m);
        m.position.copy(_v);
        const gq = this.group.getWorldQuaternion(new Quaternion()).invert();
        m.quaternion.copy(gq.multiply(_q));
        hc.root.removeFromParent();
        return m;
      }
    }
    // an opponent: take one card back from their fan, it turns over in flight
    const slot = this.slotOfSeat(seat);
    const fan = this.fans.get(slot);
    const m = makeCardMesh(card);
    if (fan && fan.count) {
      // the last card of the fan becomes this mesh, exactly where it was
      this.fanPoint(slot, fan.count - 1, fan.count, m.position, m.quaternion);
      fan.count--;
      fan.layout();
    } else {
      this.fanPoint(slot, 0, 1, m.position, m.quaternion);
    }
    this.group.add(m);
    return m;
  }

  /** Where the viewer's head is, in table space (set by the app each frame); opponents' plays turn to face it. */
  readonly viewer = new Vector3(0, 1.2, 0.98);
  /** Called when an opponent's card is held up for everyone to read. */
  onReveal: ((seat: number, card: Card, at: Vector3) => void) | null = null;
  /** Seconds an opponent's card is held up before it drops (longer for recordings and checks). */
  revealHold = 0.8;

  /**
   * Where a revealed card hovers: above the pile, a little towards the viewer, facing them.
   * Writes the position and orientation (table space).
   */
  private revealPose(pos: Vector3, quat: Quaternion): void {
    _v.copy(this.viewer).sub(PILE);
    _v.y = 0;
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
    _v.normalize();
    pos.copy(PILE).addScaledVector(_v, 0.16);
    pos.y = TABLE_Y + 0.27;
    // the card's face is its local +Z: point it at the viewer's eyes, upright
    _m4.lookAt(this.viewer, pos, _up);
    quat.setFromRotationMatrix(_m4);
  }

  /** A card was played: fly it to the pile. Returns the flight duration. */
  animatePlay(seat: number, card: Card, mine: boolean, lift = 0): number {
    const m = this.takeSource(seat, card, mine);
    setCardFace(m, card);
    m.userData.cardId = card.id;
    const to = this.pileSpot(this.discard.length, new Vector3());
    to.y += lift;
    const toQ = this.pileRot(card, new Quaternion());
    const dur = mine ? 0.36 : 0.6;
    // an opponent's free hand takes the card out of their fan before it leaves
    const lead = mine ? 0 : 0.26;
    const land = () => {
      // the newest card on the pile stays a little larger so it reads at a glance
      const prev = this.discard[this.discard.length - 1];
      if (prev) prev.scale.setScalar(1);
      m.castShadow = false;
      this.discard.push(m);
      this.trimPile();
      this.listener.sound('place');
    };
    if (!mine) {
      // an opponent's card is held up, face out to you, before it drops on the pile
      const show = new Vector3();
      const showQ = new Quaternion();
      this.revealPose(show, showQ);
      const rise = 0.42;
      const hold = this.revealHold;
      const drop = 0.32;
      this.fly(m, show, showQ, rise, 0.05, lead, 1, () => {
        this.onReveal?.(seat, card, show);
        this.fly(m, to, toQ, drop, 0.03, hold, 0, land, -1, '', 1.18);
      }, this.slotOfSeat(seat), 'play', 2.2);
      return lead + rise + hold + drop;
    }
    this.fly(
      m,
      to,
      toQ,
      dur,
      mine ? 0.035 : 0.075,
      lead,
      mine ? 0 : 1,
      land,
      this.slotOfSeat(seat),
      'play',
      1.18,
    );
    return dur + lead;
  }

  /**
   * Cards dealt to a seat from the draw pile. `cards` holds faces only for your own draws.
   * `delay0` holds the first card back (the deal); `quiet` skips the sound (the caller schedules it).
   */
  animateDraw(seat: number, count: number, cards: Card[], mine: boolean, stagger = 0.12, from?: Vector3, delay0 = 0, quiet = false): void {
    const slot = this.slotOfSeat(seat);
    for (let i = 0; i < count; i++) {
      const card = cards[i] ?? null;
      const m = makeCardMesh(null);
      m.position.copy(from ?? this.drawTop.position);
      m.quaternion.setFromEuler(_e.set(-Math.PI / 2, 0, 0.08));
      // a card waiting its turn in the deal stays out of sight inside the deck
      if (delay0 > 0) m.visible = false;
      this.group.add(m);
      const delay = delay0 + i * stagger;
      const to = new Vector3();
      const toQ = new Quaternion();
      if (mine && card) {
        // into the hand: it shows its face as it arrives
        this.inbound.set(card.id, (this.inbound.get(card.id) ?? 0) + 1);
        this.fanPoint(0, this.handOrder.length + i, this.handOrder.length + count, to, toQ);
        this.fly(
          m,
          to,
          toQ,
          0.58,
          0.085,
          delay,
          0,
          () => {
            setCardFace(m, card);
            m.removeFromParent();
            this.inbound.delete(card.id);
            this.syncHand();
          },
          0,
          'draw',
        );
        setTimeout(() => setCardFace(m, card), (delay + 0.25) * 1000);
      } else {
        const held = this.fans.get(slot)?.count ?? 0;
        const coming = this.inboundFan.get(slot) ?? 0;
        this.fanPoint(slot, held + coming + i, held + coming + count, to, toQ);
        this.fly(
          m,
          to,
          toQ,
          0.64,
          0.09,
          delay,
          0,
          () => {
            m.removeFromParent();
            this.inboundFan.set(slot, Math.max(0, (this.inboundFan.get(slot) ?? 1) - 1));
            this.syncFans();
          },
          slot,
          'draw',
        );
      }
      if (delay0 > 0) this.flights[this.flights.length - 1].show = true;
    }
    if (!mine) this.inboundFan.set(slot, (this.inboundFan.get(slot) ?? 0) + count);
    if (!quiet) this.listener.sound('slide');
  }

  /**
   * A new round: every hand is dealt from the deck one card at a time round the table, the way
   * a dealer would, ending with you. Returns how long the whole deal takes, in seconds.
   */
  deal(v: ViewMsg, gap: number, delay: number): number {
    const seats: number[] = [];
    for (let k = 1; k <= 4; k++) {
      const seat = (v.seat + k) % 4;
      if ((v.counts[seat] ?? 0) > 0) seats.push(seat);
    }
    let last = 0;
    seats.forEach((seat, si) => {
      const mine = seat === v.seat;
      const n = v.counts[seat];
      const cards = mine ? [...v.hand].sort((a, b) => (a.color - b.color) * 100 + (kindRank(a) - kindRank(b))) : [];
      this.animateDraw(seat, n, cards, mine, gap * seats.length, this.drawTop.position, delay + si * gap, true);
      last = Math.max(last, delay + si * gap + (n - 1) * gap * seats.length + (mine ? 0.58 : 0.64));
    });
    return last;
  }

  private fly(mesh: Object3D, to: Vector3, toQ: Quaternion, dur: number, arc: number, delay: number, spin: number, done?: () => void, slot = -1, kind: Flight['kind'] = '', toS?: number): void {
    // replace an existing flight for this mesh
    this.flights = this.flights.filter((f) => f.mesh !== mesh);
    this.flights.push({
      mesh,
      from: mesh.position.clone(),
      fromQ: mesh.quaternion.clone(),
      to: to.clone(),
      toQ: toQ.clone(),
      t: 0,
      dur,
      arc,
      delay,
      lead: delay,
      spin,
      done,
      slot,
      kind,
      fromS: toS === undefined ? undefined : mesh.scale.x,
      toS,
    });
  }

  /**
   * The card a seat's free hand should be on right now: writes its position
   * (table space) to `out` and returns how firmly the hand is on it (0 = not at all).
   */
  handReach(slot: number, out: Vector3): number {
    let best = 0;
    for (const f of this.flights) {
      if (f.slot !== slot || !f.kind) continue;
      let w: number;
      if (f.kind === 'play') {
        // the hand goes to the card, carries it out over the table, and lets go
        if (f.delay > 0) w = f.lead > 0 ? 1 - f.delay / f.lead : 1;
        else w = f.t < 0.3 ? 1 : Math.max(0, 1 - (f.t - 0.3) / 0.3);
      } else {
        // a card coming from the deck: reach out for it, then guide it into the fan
        if (f.delay > 0) w = f.lead > 0 ? Math.max(0, 1 - f.delay / 0.18) * 0.6 : 0;
        else w = f.t < 0.9 ? Math.min(1, 0.6 + f.t * 2) : Math.max(0, (1 - f.t) / 0.1);
      }
      if (w > best) {
        best = w;
        out.copy(f.mesh.position);
      }
    }
    return best;
  }

  // ------------------------------------------------------------ fans

  /**
   * Position of card `i` of `n` in the fan held at relative seat `slot`. Your
   * own fan (slot 0) faces your eyes; the others face their owners.
   */
  fanPoint(slot: number, i: number, n: number, pos: Vector3, quat: Quaternion): void {
    if (slot === 0) {
      // a real hand of cards: they pivot about a point below, and splay wide
      const spread = Math.min(0.19, 1.25 / Math.max(1, n));
      const a = (i - (n - 1) / 2) * spread;
      const R = OWN_FAN_R;
      _v2.set(Math.sin(a) * R, Math.cos(a) * R - R, i * 0.0016);
      _q.setFromEuler(_e.set(this.fanTilt, 0, 0));
      _v2.applyQuaternion(_q);
      pos.copy(this.fanCenter).add(_v2);
      quat.setFromEuler(_e.set(this.fanTilt, 0, -a));
      return;
    }
    // the fan's own frame (the palm that holds it, or a spot in front of the seat), then the card within it
    const anc = this.fanAnchor.get(slot);
    this.fanFrame(slot, pos, quat);
    HeldFan.local(i, n, !!anc, _v2, _q2);
    pos.add(_v2.applyQuaternion(quat));
    quat.multiply(_q2);
  }

  /** Where an opponent's fan as a whole sits and faces (table space). */
  private fanFrame(slot: number, pos: Vector3, quat: Quaternion): void {
    const anc = this.fanAnchor.get(slot);
    if (anc) {
      // held in a hand: every card turns about the pivot in the palm
      pos.copy(anc.pos);
      quat.copy(anc.quat);
      return;
    }
    // nobody's hand to hold it (simple avatars): float it in front of the seat, leaning back
    const ang = seatAngle(slot);
    pos.set(Math.sin(ang) * FAN_R, TABLE_Y, Math.cos(ang) * FAN_R);
    quat.setFromAxisAngle(_v.set(0, 1, 0), ang + Math.PI).multiply(_q.setFromEuler(_e.set(-0.45, 0, 0)));
  }

  /** Move an opponent's whole fan to its frame and lay it out if its count changed. */
  private placeFanBatch(slot: number): void {
    const fan = this.fans.get(slot);
    if (!fan) return;
    fan.held = this.fanAnchor.has(slot);
    this.fanFrame(slot, fan.mesh.position, fan.mesh.quaternion);
    fan.layout();
  }

  /** An opponent's card hand, this frame (table space): their fan is fixed to it. */
  setFanAnchor(slot: number, pos: Vector3, quat: Quaternion): void {
    let a = this.fanAnchor.get(slot);
    if (!a) {
      a = { pos: new Vector3(), quat: new Quaternion() };
      this.fanAnchor.set(slot, a);
    }
    a.pos.copy(pos);
    a.quat.copy(quat);
    this.placeFanBatch(slot);
  }

  /** That seat no longer has a hand to hold its fan. */
  clearFanAnchor(slot: number): void {
    if (this.fanAnchor.delete(slot)) this.placeFanBatch(slot);
  }

  /**
   * Where your own hand grips your fan (table space): a point on the cards
   * near the bottom left, the way the faces point, and up the fan.
   */
  ownFanGrip(pos: Vector3, normal: Vector3, up: Vector3): void {
    _q.setFromEuler(_e.set(this.fanTilt, 0, 0));
    pos.set(-0.1, -0.082, -0.004).applyQuaternion(_q).add(this.fanCenter);
    normal.set(0, 0, 1).applyQuaternion(_q);
    up.set(0, 1, 0).applyQuaternion(_q);
  }

  /** Match the opponents' fans to the card counts in the latest view. */
  syncFans(): void {
    const v = this.view;
    if (!v) return;
    for (let seat = 0; seat < 4; seat++) {
      if (seat === v.seat) continue;
      const slot = this.slotOfSeat(seat);
      // cards still flying in are added when they land
      const want = Math.max(0, (v.counts[seat] ?? 0) - (this.inboundFan.get(slot) ?? 0));
      let fan = this.fans.get(slot);
      if (!fan) {
        if (!this.fanMat) this.fanMat = cardMaterial().clone();
        fan = new HeldFan(this.fanMat);
        this.fans.set(slot, fan);
        this.group.add(fan.mesh);
      }
      fan.count = want;
      this.placeFanBatch(slot);
    }
  }

  // ------------------------------------------------------------ your hand

  /** Reconcile your hand with the latest view: add new cards, drop played ones, re-fan. */
  syncHand(): void {
    const v = this.view;
    if (!v) return;
    const ids = new Set(v.hand.map((c) => c.id));
    for (const [id, hc] of this.hand) {
      if (!ids.has(id) && !hc.pending) {
        hc.root.removeFromParent();
        this.hand.delete(id);
      }
    }
    for (const c of v.hand) {
      if (this.hand.has(c.id) || this.inbound.has(c.id)) continue;
      const hc = new HandCard(c, this.hitMat);
      hc.mesh.castShadow = this.handShadows;
      this.hand.set(c.id, hc);
      this.handGroup.add(hc.root);
      // appear in place (a draw animation already brought it here)
      hc.root.position.copy(this.fanCenter);
    }
    // order: by colour then value, so hands are easy to read
    const sorted = v.hand
      .filter((c) => this.hand.has(c.id))
      .sort((a, b) => (a.color - b.color) * 100 + (kindRank(a) - kindRank(b)));
    this.handOrder = sorted.map((c) => c.id);
    const playable = new Set(v.current === v.seat ? v.playable : []);
    this.handOrder.forEach((id, i) => {
      const hc = this.hand.get(id)!;
      this.fanPoint(0, i, this.handOrder.length, hc.home, hc.homeQ);
      hc.playable = playable.has(id);
    });
  }

  /** Recompute where each of your cards rests after the fan itself has moved. */
  relayoutHand(): void {
    const n = this.handOrder.length;
    for (let i = 0; i < n; i++) {
      const hc = this.hand.get(this.handOrder[i]);
      if (hc) this.fanPoint(0, i, n, hc.home, hc.homeQ);
    }
  }

  /**
   * Whether the cards in your hand cast shadows. In a headset they do not: seven more draws in
   * the shadow pass for a shadow that falls mostly in your lap.
   */
  setHandShadows(on: boolean): void {
    this.handShadows = on;
    for (const hc of this.hand.values()) hc.mesh.castShadow = on;
  }
  private handShadows = true;

  /** Every hand card's click target, for the pointer system. */
  handTargets(): { id: number; obj: Object3D }[] {
    return [...this.hand.values()].map((h) => ({ id: h.card.id, obj: h.hit }));
  }

  /**
   * A hand ray, a gaze or the mouse is on (or has left) one of your cards. The card lifts out of
   * the fan, so what a pinch will play is shown on the card itself: Meta VR Glasses draw no cursor.
   */
  pointAtCard(id: number, on: boolean): void {
    if (on) {
      if (this.pointId !== id && this.hand.has(id)) this.listener.sound('hover');
      this.pointId = id;
    } else if (this.pointId === id) this.pointId = -1;
  }

  /** The same for the draw pile: its top card rises while you point at it on your turn. */
  pointAtDeck(on: boolean): void {
    this.pointDeck = on;
  }

  cardById(id: number): Card | null {
    return this.hand.get(id)?.card ?? null;
  }

  /** A card was clicked (ray, mouse) rather than pinched. */
  /** performance.now() of the last direct pinch on a card or the deck. A ray "click" right after it is the same gesture, not a second one. */
  lastDirect = -1e9;

  /** Whether a pointer click should count (it isn't the tail of a direct pinch). */
  clickAllowed(): boolean {
    return !this.drag && performance.now() - this.lastDirect > 600;
  }

  clickCard(id: number): void {
    const hc = this.hand.get(id);
    if (!hc || hc.pending || !this.clickAllowed()) return;
    this.tryPlay(hc);
  }

  private tryPlay(hc: HandCard): void {
    const v = this.view;
    if (!v || v.phase !== 'play') return this.bounce(hc, '');
    if (v.current !== v.seat) return this.bounce(hc, 'Wait for your turn.');
    // One move at a time. A card of yours still on its way to the pile (or waiting for its
    // colour) means the table has not caught up with the host yet: what glows is still judged
    // by the turn before, and a second card sent now would only come back refused.
    for (const other of this.hand.values()) if (other.pending && other !== hc) return this.bounce(hc, '');
    if (!v.playable.includes(hc.card.id)) {
      const owed = v.pending ?? 0;
      const msg = owed > 0
        ? `+${owed} is on you: stack a Draw card on it, or take +${owed}.`
        : v.hasDrawn
        ? 'After drawing you can only play the card you drew.'
        : hc.card.kind === 'wild4'
          ? 'Wild Draw Four only when you have no card of the current colour.'
          : 'That card does not match the colour or symbol.';
      return this.bounce(hc, msg);
    }
    hc.pending = true;
    if (isWild(hc.card)) {
      // hover over the pile until a colour is chosen
      this.pendingWild = hc;
      this.fly(hc.root, new Vector3(PILE.x, TABLE_Y + 0.16, PILE.z), new Quaternion().setFromEuler(_e.set(-0.5, 0, 0)), 0.3, 0.02, 0, 0);
      this.listener.play(hc.card);
      return;
    }
    this.listener.play(hc.card);
  }

  /** The host refused a play (or the colour choice was cancelled): back into the fan. */
  returnCard(id: number, reason = ''): void {
    const hc = this.hand.get(id);
    if (!hc) return;
    hc.pending = false;
    if (this.pendingWild === hc) this.pendingWild = null;
    this.bounce(hc, reason);
  }

  private bounce(hc: HandCard, reason: string): void {
    hc.dragging = false;
    this.fly(hc.root, hc.home, hc.homeQ, 0.35, 0.03, 0, 0);
    hc.root.userData.shake = 0.18;
    if (reason) this.listener.nope(reason);
    this.listener.sound('nope');
  }

  // ------------------------------------------------------------ frame

  /**
   * @param hands  both hands' pinch state, in table space
   */
  update(dt: number, hands: Record<'left' | 'right', HandInput>): void {
    this.time += dt;
    // flights
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      if (f.show) {
        f.show = false;
        f.mesh.visible = true;
      }
      f.t += dt / f.dur;
      // Minimum-jerk easing makes releases and catches feel deliberate: zero
      // velocity and acceleration at both ends, independent of frame rate.
      const u = clamp(f.t);
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      f.mesh.position.lerpVectors(f.from, f.to, k);
      f.mesh.position.y += Math.sin(k * Math.PI) * f.arc;
      f.mesh.quaternion.slerpQuaternions(f.fromQ, f.toQ, k);
      if (f.toS !== undefined && f.fromS !== undefined) f.mesh.scale.setScalar(f.fromS + (f.toS - f.fromS) * k);
      if (f.spin) {
        _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(k * Math.PI) * 0.18 * f.spin);
        f.mesh.quaternion.multiply(_q);
      }
      if (f.t >= 1) {
        this.flights.splice(i, 1);
        f.done?.();
      }
    }

    this.updateHand(dt, hands);
  }

  private updateHand(dt: number, hands: Record<'left' | 'right', HandInput>): void {
    const v = this.view;
    const myTurn = !!v && v.phase === 'play' && v.current === v.seat;
    // Resolve each hand independently in the card's oriented rectangle. This
    // includes exposed corners and prefers the surface nearest the fingertip.
    this.near.left = this.near.right = -1;
    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      if (!h.pos || (this.drag && this.drag.side === side)) continue;
      this.near[side] = this.nearestCard(h.pos);
    }
    const near = this.near.right >= 0 ? this.near.right : this.near.left;
    if (near !== this.hoverId) {
      this.hoverId = near;
      if (near >= 0) this.listener.sound('hover');
    }

    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      if (!h.pos || !h.started || !h.pinching || this.drag) continue;
      const hc = this.hand.get(this.near[side]);
      if (hc) {
        hc.dragging = true;
        this.flights = this.flights.filter((f) => f.mesh !== hc.root);
        this.drag = this.beginDrag(hc, side, h.pos, null);
        this.lastDirect = performance.now();
        this.listener.sound('pick');
      } else if (this.drawTop.visible && this.nearDeck(h.pos)) {
        if (!myTurn || v!.hasDrawn) {
          this.lastDirect = performance.now();
          this.listener.nope(myTurn ? 'You have already drawn this turn.' : 'Wait for your turn.');
          continue;
        }
        const ghost = makeCardMesh(null);
        ghost.position.copy(this.drawTop.position);
        ghost.quaternion.copy(this.drawTop.quaternion);
        this.group.add(ghost);
        this.drag = this.beginDrag(null, side, h.pos, ghost);
        this.lastDirect = performance.now();
        this.listener.sound('pick');
      }
    }

    let guide = 0;
    if (this.drag) {
      const d = this.drag;
      const h = hands[d.side];
      if (!h.pos) {
        // Losing tracking is a cancellation, never a release-to-play gesture.
        this.cancelDrag(d);
      } else if (h.ended || !h.pinching) {
        this.release(d, h.pos);
      } else {
        d.age += dt;
        const step = _v.copy(h.pos).sub(d.last);
        if (step.length() > 0.18) {
          // Reacquisition jumps cannot fling a card or pull from the deck.
          this.cancelDrag(d);
        } else {
          d.travel = Math.max(d.travel, h.pos.distanceTo(d.start));
          step.divideScalar(Math.max(dt, 1 / 120)).clampLength(0, 2.5);
          d.vel.lerp(step, 1 - Math.exp(-dt * 14));
          d.last.copy(h.pos);
          const obj = d.hc ? d.hc.root : d.ghost!;
          const toPile = this.inPlayZone(obj.position);
          const pushed = !toPile && !!d.hc && this.pushedToPlay(d, obj.position);
          if (toPile) _q.setFromEuler(_e.set(-Math.PI / 2 + 0.1, 0, 0));
          // pushed far enough: the card tips forward, ready to drop, so you can see that letting go plays it
          else if (pushed) _q.copy(d.gripQ).multiply(_q2.setFromEuler(_e.set(-0.55, 0, 0)));
          else _q.copy(d.gripQ);
          if ((toPile || pushed) && !d.ready && d.hc) this.listener.sound('hover');
          d.ready = toPile || pushed;
          _q2.setFromAxisAngle(_v.set(0, 0, 1), clamp(-d.vel.x * 0.08, -0.16, 0.16));
          _q.multiply(_q2);
          obj.quaternion.slerp(_q, 1 - Math.exp(-dt * 12));
          // Preserve the actual pinch contact as the card changes orientation.
          _v.copy(d.grip).applyQuaternion(obj.quaternion);
          _v2.copy(h.pos).sub(_v);
          obj.position.lerp(_v2, 1 - Math.exp(-dt * 36));
          if (d.hc && myTurn) {
            const ready = d.hc.playable && d.ready;
            guide = ready ? 0.72 : 0.16;
            this.dropMat.color.setHex(d.hc.playable ? 0x7ee3c4 : 0xd6a778);
          }
        }
      }
    }
    this.dropMat.opacity = damp(this.dropMat.opacity, guide, 12, dt);
    // (a hidden guide costs no draw; the geometry checks run a table without one)
    if (this.dropGuide) this.dropGuide.visible = this.dropMat.opacity > 0.01;

    // the deck's top card rises to meet a pointing hand or a gaze when you may draw
    const canDraw = myTurn && !v!.hasDrawn && !this.drag;
    this.deckLift = damp(this.deckLift || 0, this.pointDeck && canDraw ? 0.014 : 0, 14, dt);
    // (the geometry checks run a table with a stand-in deck)
    if (this.drawTop?.position) this.drawTop.position.y = this.drawTopY + this.deckLift;

    // fan resting poses, hover lift and playable glow
    for (const hc of this.hand.values()) {
      if (hc.dragging || hc.pending) continue;
      if (this.flights.some((f) => f.mesh === hc.root)) continue;
      const lifted = hc.card.id === this.hoverId || hc.card.id === this.pointId ? 1 : 0;
      hc.lift = damp(hc.lift, lifted + (hc.playable ? 0.25 : 0), 14, dt);
      _v.set(0, 0.012 * hc.lift, 0.004 * hc.lift).applyQuaternion(hc.homeQ);
      _v.add(hc.home);
      const shake = (hc.root.userData.shake as number) ?? 0;
      if (shake > 0) {
        hc.root.userData.shake = Math.max(0, shake - dt);
        _v.x += Math.sin(this.time * 60) * 0.006 * shake;
      }
      hc.root.position.lerp(_v, 1 - Math.exp(-dt * 16));
      hc.root.quaternion.slerp(hc.homeQ, 1 - Math.exp(-dt * 16));
      // playable cards are slightly brighter: no colour-only cue, they also sit higher
      const mat = hc.mesh.material as MeshStandardMaterial;
      void mat;
    }
  }

  private nearestCard(point: Vector3): number {
    let best = -1;
    let score = Infinity;
    for (const hc of this.hand.values()) {
      if (hc.pending || hc.dragging || this.flights.some((f) => f.mesh === hc.root)) continue;
      _q.copy(hc.root.quaternion).invert();
      _v.copy(point).sub(hc.root.position).applyQuaternion(_q);
      const x = Math.abs(_v.x), y = Math.abs(_v.y), z = Math.abs(_v.z);
      if (x > CARD_W / 2 + 0.006 || y > CARD_H / 2 + 0.006 || z > 0.026) continue;
      const outside = Math.hypot(Math.max(0, x - CARD_W / 2), Math.max(0, y - CARD_H / 2));
      const d = z + outside * 1.5;
      if (d < score) {
        score = d;
        best = hc.card.id;
      }
    }
    return best;
  }

  private nearDeck(point: Vector3): boolean {
    return Math.abs(point.x - this.drawTop.position.x) < CARD_W * 0.65
      && Math.abs(point.z - this.drawTop.position.z) < CARD_H * 0.65
      && Math.abs(point.y - this.drawTop.position.y) < 0.035;
  }

  private beginDrag(hc: HandCard | null, side: CardDrag['side'], point: Vector3, ghost: Mesh | null): CardDrag {
    const obj = hc ? hc.root : ghost!;
    const grip = point.clone().sub(obj.position).applyQuaternion(_q.copy(obj.quaternion).invert());
    return { hc, side, drawing: !hc, start: point.clone(), vel: new Vector3(), last: point.clone(), ghost, grip, gripQ: obj.quaternion.clone(), age: 0, travel: 0, from: obj.position.clone(), ready: false };
  }

  /** Has this card been carried far enough out of the fan, toward the pile, to play on release? */
  private pushedToPlay(d: CardDrag, cardAt: Vector3): boolean {
    const dx = PILE.x - d.from.x;
    const dz = PILE.z - d.from.z;
    const span = Math.hypot(dx, dz);
    // picked up right beside the pile: the play zone decides
    if (span < PUSH_TO_PLAY * 2) return false;
    // distance travelled along the line from the fan to the pile, over the table (not up or sideways)
    const along = ((cardAt.x - d.from.x) * dx + (cardAt.z - d.from.z) * dz) / span;
    return along > PUSH_TO_PLAY && cardAt.y > TABLE_Y + 0.02;
  }

  private cancelDrag(d: CardDrag): void {
    this.drag = null;
    this.lastDirect = performance.now();
    d.ghost?.removeFromParent();
    if (d.hc) {
      d.hc.dragging = false;
      this.fly(d.hc.root, d.hc.home, d.hc.homeQ, 0.32, 0.015, 0, 0);
    }
  }

  private inPlayZone(p: Vector3): boolean {
    const dx = p.x - PILE.x;
    const dz = p.z - PILE.z;
    return Math.hypot(dx, dz) < 0.22 && p.y >= TABLE_Y - 0.015 && p.y < TABLE_Y + 0.23;
  }

  private release(d: NonNullable<Tabletop['drag']>, at: Vector3): void {
    this.drag = null;
    this.lastDirect = performance.now();
    if (d.drawing) {
      const pulled = d.age >= 0.12 && d.travel >= 0.09
        && (at.z - d.start.z > 0.075 || at.y - d.start.y > 0.07);
      d.ghost?.removeFromParent();
      if (pulled) this.listener.draw();
      return;
    }
    const hc = d.hc!;
    hc.dragging = false;
    // Test the card centre, not the finger; an edge grip can be 5 cm away.
    const cardAt = hc.root.position;
    _v.set(PILE.x - cardAt.x, 0, PILE.z - cardAt.z);
    const dist = _v.length();
    _v.normalize();
    const toward = d.vel.x * _v.x + d.vel.z * _v.z;
    const speed = Math.hypot(d.vel.x, d.vel.z);
    const flicked = d.age > 0.18 && d.travel > 0.1 && toward > 0.9
      && toward / Math.max(speed, 0.001) > 0.9 && dist < 0.42
      && cardAt.y >= TABLE_Y && cardAt.y < TABLE_Y + 0.32;
    if (this.inPlayZone(cardAt) || flicked || this.pushedToPlay(d, cardAt)) {
      if (flicked) this.listener.sound('flick');
      this.tryPlay(hc);
    } else {
      this.fly(hc.root, hc.home, hc.homeQ, 0.3, 0.02, 0, 0);
      this.listener.sound('slide');
    }
  }

  /** Called every frame by the app with whose turn it is, for the draw pile's invitation pulse. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  clear(): void {
    for (const hc of this.hand.values()) hc.root.removeFromParent();
    this.hand.clear();
    this.handOrder = [];
    for (const fan of this.fans.values()) {
      fan.mesh.removeFromParent();
      fan.mesh.dispose();
    }
    this.fans.clear();
    for (const m of this.discard) m.removeFromParent();
    this.discard = [];
    for (const f of this.flights) if (f.mesh !== this.drawTop) f.mesh.removeFromParent();
    this.flights = [];
    this.inbound.clear();
    this.inboundFan.clear();
    this.pendingWild = null;
    this.drag = null;
    this.view = null;
    this.dropMat.opacity = 0;
    this.hoverId = -1;
  }

  /** Place for effects: above the pile. */
  pileTop(out: Vector3): Vector3 {
    return this.pileSpot(this.discard.length, out);
  }

  /** Where a seat's fan is (for effects aimed at a player). */
  seatFan(seat: number, out: Vector3): Vector3 {
    const slot = this.slotOfSeat(seat);
    if (slot === 0) return out.copy(this.fanCenter);
    const a = seatAngle(slot);
    return out.set(Math.sin(a) * FAN_R, TABLE_Y + 0.16, Math.cos(a) * FAN_R);
  }
}

function kindRank(c: Card): number {
  switch (c.kind) {
    case 'num':
      return c.value;
    case 'skip':
      return 10;
    case 'reverse':
      return 11;
    case 'draw2':
      return 12;
    case 'wild':
      return 13;
    default:
      return 14;
  }
}

export { lerp, easeOutBack };
