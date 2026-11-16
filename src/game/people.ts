/**
 * Real people at the table: photo-scanned, rigged characters (Renderpeople
 * scans, CC-BY, via Sketchfab) posed seated in Blender, exported as
 * public/models/people.glb. Exported headset accessories are hidden so the
 * people at the table have visible faces.
 *
 * Each PersonAvatar drives the skeleton procedurally:
 * - posture: leaning in to the table, breathing, shifting weight;
 * - eyes: following whoever is playing, glancing down at their own cards;
 * - the card hand: fingers and thumb grip the fan, and the fan is fixed to the hand;
 * - the free hand: rests on the table, drums its fingers, sorts the cards,
 *   reaches for the deck and tosses cards to the pile;
 * - reactions: laugh, cheer, point, facepalm, frustration, anger;
 * - talking: the jaw follows the voice.
 * Remote players also get their tracked head direction and hands (two-bone IK).
 * The same rig, with its head hidden, is your own body on the flat screen.
 */
import { AssetManager, Group, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import type { Bone, Object3D, SkinnedMesh } from '@iwsdk/core';
import { createHeroRig, heroesReady, loadHeroes, type HeroRig } from './heroes.js';
import { useHeroes } from './world-choice.js';
import type { PoseMsg } from '../../shared/protocol.ts';
import { TABLE_Y } from './env.js';

/** The scanned people, in the order computer players use them. */
export const PEOPLE = ['Nathan', 'Sophia', 'Carla'] as const;

/** Where the hips sit, in seat space: pulled in to the table, like the chairs. */
export const HIP_Z = 1.06;

/** How the card hand holds a fan: the fan's pivot, the way the faces point, and its up (seat space). */
export interface FanPose {
  pos: Vector3;
  normal: Vector3;
  up: Vector3;
}
/** An opponent's fan: in front of the chest over the table edge, faces tipped up to their eyes. */
const FAN_N = new Vector3(0, 0.36, 0.93).normalize();
const FAN_U = new Vector3(-0.08, 0.93, -0.36);
FAN_U.addScaledVector(FAN_N, -FAN_U.dot(FAN_N)).normalize();
const FAN_P = new Vector3(-0.05, TABLE_Y + 0.185, 0.7);
/** The fingers lie along the bottom of the fan, angled up by this much. */
const BETA = 0.45;
/** Where the fan's pivot sits in the palm: along the fingers, out of the palm, towards the thumb. */
const GRIP_F = 0.07;
const GRIP_N = 0.022;
const GRIP_A = -0.018;

let library: Object3D | null = null;
let loading: Promise<boolean> | null = null;

const base = (p: string) => `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'}${p}`;

/** Load the people once. Resolves false if the file is missing (robots are used instead). */
/** A seated character: a photo-scanned person (lounge) or a stylized hero (Frostpeak). */
export type SeatedRig = PersonRig | HeroRig;

/** How many characters a player can choose from: five heroes in Frostpeak, three people in the lounge. */
export function castSize(): number {
  return useHeroes() ? 5 : PEOPLE.length;
}

export function loadPeople(): Promise<boolean> {
  if (useHeroes()) return loadHeroes();
  if (!loading) {
    loading = AssetManager.loadGLTF(base('models/people.glb'), 'people')
      .then((gltf) => {
        library = gltf.scene;
        library.traverse((o) => {
          // Hide the whole named accessory as well as individual glTF
          // primitive meshes. Keep the scanned head and its skeleton intact.
          if (/^Headset(?:_|$)/i.test(o.name)) {
            o.visible = false;
            o.raycast = () => {};
          }
          const m = o as SkinnedMesh;
          if (!m.isMesh) return;
          const materials = Array.isArray(m.material) ? m.material : [m.material];
          if (materials.length && materials.every((material) => material.name.startsWith('HS_'))) {
            m.visible = false;
            m.raycast = () => {};
            return;
          }
          m.frustumCulled = false; // skinned bounds are stale once we pose the bones
          m.castShadow = true;
          m.receiveShadow = true;
          for (const source of materials) {
            const mat = source as MeshStandardMaterial;
            if (!mat?.isMeshStandardMaterial) continue;
            // scanned skin and cloth read best fairly matte
            if (!/HS_/.test(mat.name)) mat.roughness = Math.max(mat.roughness, 0.72);
            mat.envMapIntensity = 1.0;
          }
        });
        return true;
      })
      .catch((err) => {
        console.warn('[chaos] people.glb unavailable', err);
        return false;
      });
  }
  return loading;
}

export function peopleReady(): boolean {
  if (useHeroes()) return heroesReady();
  return !!library;
}

/** A seated, posable person (null until people.glb has loaded). */
export function createPersonRig(index: number): SeatedRig | null {
  if (useHeroes()) return createHeroRig(index);
  const model = makePerson(index);
  return model ? new PersonRig(index, model) : null;
}

/** A private copy of one person, with its own skeleton (like SkeletonUtils.clone). */
function makePerson(index: number): Object3D | null {
  const src = library?.getObjectByName('Person_' + PEOPLE[((index % PEOPLE.length) + PEOPLE.length) % PEOPLE.length]);
  if (!src) return null;
  const clone = src.clone(true);
  const fromClone = new Map<Object3D, Object3D>();
  const toClone = new Map<Object3D, Object3D>();
  const walk = (a: Object3D, b: Object3D) => {
    fromClone.set(b, a);
    toClone.set(a, b);
    for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
  };
  walk(src, clone);
  clone.traverse((node) => {
    const sm = node as SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const orig = fromClone.get(sm) as SkinnedMesh;
    const skeleton = orig.skeleton.clone();
    skeleton.bones = orig.skeleton.bones.map((b) => toClone.get(b) as Bone);
    sm.bind(skeleton, orig.bindMatrix);
  });
  return clone;
}

const _pq = new Quaternion();
const _dq = new Quaternion();
const _lq = new Quaternion();
const _rq = new Quaternion();
const _rqi = new Quaternion();
const _hq = new Quaternion();
const _oq1 = new Quaternion();
const _oq2 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _ax = new Vector3();
const _ay = new Vector3();
const _pitch = new Vector3();
const _m = new Matrix4();
const _S = new Vector3();
const _T = new Vector3();
const _dir = new Vector3();
const _pole = new Vector3();
const _el = new Vector3();
const _tmp = new Vector3();
const _o1 = new Vector3();
const _o2 = new Vector3();
const _o3 = new Vector3();
const _o4 = new Vector3();
const _f1 = new Vector3();
const _f2 = new Vector3();
const _f3 = new Vector3();
const _g1 = new Vector3();
const _g2 = new Vector3();
const _g3 = new Vector3();
const _w1 = new Vector3();
const _w2 = new Vector3();
const _w3 = new Vector3();
const _k1 = new Vector3();
const _k2 = new Vector3();
const _k3 = new Vector3();
const _lookP = new Vector3();
const IDENTITY = new Quaternion();
const DOWN = new Vector3(0, -1, 0);

/** Rotate a bone by `angle` about a world-space axis through its own pivot. */
function turn(bone: Object3D, axisWorld: Vector3, angle: number): void {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_pq);
  _dq.setFromAxisAngle(axisWorld, angle);
  _lq.copy(_pq).invert().multiply(_dq).multiply(_pq);
  bone.quaternion.premultiply(_lq);
}

/** Swing a bone so that `child` moves towards `target` (world), by `weight` of the way. */
function aim(bone: Object3D, child: Object3D, target: Vector3, weight = 1): void {
  if (!bone.parent || weight <= 0) return;
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const cur = _b.sub(_a);
  const want = _c.copy(target).sub(_a);
  if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
  _dq.setFromUnitVectors(cur.normalize(), want.normalize());
  if (weight < 1) _dq.slerp(IDENTITY, 1 - weight);
  bone.parent.getWorldQuaternion(_pq);
  _lq.copy(_pq).invert().multiply(_dq).multiply(_pq);
  bone.quaternion.premultiply(_lq);
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

interface Arm {
  shoulder: Object3D;
  upper: Object3D;
  lower: Object3D;
  hand: Object3D;
  len1: number;
  len2: number;
}

/** One hand: its bones, its palm frame, where it is going and where it is now. */
interface HandRig {
  left: boolean;
  arm: Arm;
  bone: Object3D;
  twist: Object3D | null;
  /** index, middle, ring, pinky: three joints each */
  fingers: Object3D[][];
  thumb: Object3D[];
  /** Palm frame in the hand bone's own space: along the fingers, and out of the palm. */
  f: Vector3;
  n: Vector3;
  /** Goal for this frame (seat space): wrist, finger direction, palm normal, finger curls, thumb. */
  gPos: Vector3;
  gFwd: Vector3;
  gPalm: Vector3;
  gCurl: number[];
  gThumb: number;
  /** How quickly the hand moves to its goal (1/s). */
  gRate: number;
  /** Smoothed state (seat space). */
  pos: Vector3;
  fwd: Vector3;
  palm: Vector3;
  curl: number[];
  thumbIn: number;
  started: boolean;
}

export type Mood = 'laugh' | 'clap' | 'point' | 'facepalm' | 'cheer' | 'angry' | 'cool' | 'cry' | 'frustrated' | 'win' | 'skipped' | 'hit' | 'throw' | '';

/** Everything a person needs to know about this frame. */
export interface RigFrame {
  t: number;
  dt: number;
  phase: number;
  mood: Mood;
  /** Seconds of the reaction left (it fades in and out). */
  moodT: number;
  voice: number;
  /** World-space point to look at. */
  look: Vector3;
  tracked: PoseMsg | null;
  /** A card the free hand is playing or drawing (world space), and how much the hand is on it. */
  reach: Vector3;
  reachW: number;
  myTurn: boolean;
  /** Decorative motion only; tracked hands and card reaches remain responsive. */
  motionScale: number;
  /** First person only: where your own fan floats (seat space). */
  ownFan: FanPose | null;
}

export function newRigFrame(): RigFrame {
  return { t: 0, dt: 0, phase: 0, mood: '', moodT: 0, voice: 0, look: new Vector3(), tracked: null, reach: new Vector3(), reachW: 0, myTurn: false, motionScale: 1, ownFan: null };
}

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const RELAXED = [0.2, 0.24, 0.28, 0.32];
const OPEN = [0.06, 0.08, 0.1, 0.12];
const FIST = [1, 1, 1, 1];
const POINTING = [0.02, 1, 1, 1];
/** Fingers behind a fan of cards: nearly straight, cradling it. */
const CRADLE = [0.1, 0.12, 0.14, 0.2];

/** One seated person. `root` is in seat space (the Cast rotates it to its seat). */
export class PersonRig {
  readonly holder = new Group();
  readonly model: Object3D;
  readonly index: number;
  private bones = new Map<string, Object3D>();
  private rest: [Object3D, Quaternion][] = [];
  private hands: [HandRig, HandRig];
  private yaw = 0;
  private pitch = 0;
  private jaw = 0;
  private lean = 0;
  private self = false;
  private seed: number;
  private glanceNext = 2;
  private glanceUntil = 0;
  private glanceCards = true;
  private glanceYaw = 0;
  private sortNext = 5;
  private sortStart = -10;
  private drumNext = 3;
  private drumStart = -10;
  private blinkNext = -1;
  private blinkStart = -10;
  private wasTurn = false;
  private turnStart = -10;
  private faceEyes: Object3D[] = [];
  private faceLids: Object3D[] = [];
  private faceBrows: Object3D[] = [];
  /** Seat-space head position (for the nameplate, sounds and effects). */
  readonly headPos = new Vector3();
  /** Seat-space eye height of this person at rest. */
  readonly eyeY: number;
  /** The fan of cards in the card hand, world space: its pivot and its frame (x across, y up the fan, z out of the backs). */
  readonly fanPos = new Vector3();
  readonly fanQuat = new Quaternion();
  /** False while the card hand is doing something else (a tracked hand that has let go). */
  fanHeld = true;

  constructor(index: number, model: Object3D) {
    this.index = index;
    this.model = model;
    this.seed = 1 + index * 7919;
    // Separate the first idle gestures, too; three opponents must not start
    // tapping their fingers or studying their hand on the same beat.
    this.glanceNext = 2.4 + this.rnd() * 4.6;
    this.sortNext = 7 + this.rnd() * 9;
    this.drumNext = 5 + this.rnd() * 8;
    this.holder.position.set(0, 0, HIP_Z);
    this.holder.add(model);
    const wanted = new Set(['spine_01', 'spine_02', 'spine_03', 'neck', 'head', 'jaw', 'eye_l', 'eye_r', 'eyelid_l', 'eyelid_r', 'eyebrow_l', 'eyebrow_r']);
    for (const s of ['l', 'r']) {
      for (const n of ['shoulder', 'upperarm', 'lowerarm', 'hand', 'lowerarm_twist']) wanted.add(`${n}_${s}`);
      for (const f of [...FINGERS, 'thumb']) for (let i = 1; i <= 3; i++) wanted.add(`${f}_0${i}_${s}`);
    }
    // GLTFLoader makes repeated names unique ("head", "head_1", "head_2"): map them back
    model.traverse((o) => {
      if (!(o as Bone).isBone) return;
      const key = wanted.has(o.name) ? o.name : o.name.replace(/_\d+$/, '');
      if (wanted.has(key) && !this.bones.has(key)) this.bones.set(key, o);
    });
    for (const b of this.bones.values()) this.rest.push([b, b.quaternion.clone()]);
    for (const side of ['l', 'r']) {
      const eye = this.bones.get(`eye_${side}`);
      const lid = this.bones.get(`eyelid_${side}`);
      const brow = this.bones.get(`eyebrow_${side}`);
      if (eye) this.faceEyes.push(eye);
      if (lid) this.faceLids.push(lid);
      if (brow) this.faceBrows.push(brow);
    }
    this.holder.updateMatrixWorld(true);
    this.hands = [this.makeHand('l'), this.makeHand('r')];
    const eyeL = this.bones.get('eye_l');
    const eyeR = this.bones.get('eye_r');
    if (eyeL && eyeR) {
      eyeL.getWorldPosition(_a);
      eyeR.getWorldPosition(_b);
      this.eyeY = this.holder.worldToLocal(_a.add(_b).multiplyScalar(0.5)).y;
    } else this.eyeY = 1.2;
    this.bones.get('head')?.getWorldPosition(this.headPos);
  }

  private bone(name: string): Object3D {
    const b = this.bones.get(name);
    if (!b) throw new Error('missing bone ' + name);
    return b;
  }

  private makeHand(s: 'l' | 'r'): HandRig {
    const upper = this.bone('upperarm_' + s);
    const lower = this.bone('lowerarm_' + s);
    const bone = this.bone('hand_' + s);
    const up = upper.getWorldPosition(new Vector3());
    const lo = lower.getWorldPosition(new Vector3());
    const hp = bone.getWorldPosition(new Vector3());
    const arm: Arm = { shoulder: this.bone('shoulder_' + s), upper, lower, hand: bone, len1: up.distanceTo(lo), len2: lo.distanceTo(hp) };
    const chain = (f: string) => [1, 2, 3].map((i) => this.bones.get(`${f}_0${i}_${s}`)).filter((b): b is Object3D => !!b);
    const fingers = FINGERS.map(chain);
    const thumb = chain('thumb');
    const left = s === 'l';
    // the palm frame, measured from the knuckles in the rest pose
    const F = new Vector3(0, 0, -1);
    const N = new Vector3(0, -1, 0);
    if (fingers[1][0] && fingers[0][0] && fingers[3][0]) {
      F.copy(fingers[1][0].getWorldPosition(new Vector3())).sub(hp).normalize();
      const A = fingers[0][0].getWorldPosition(new Vector3()).sub(fingers[3][0].getWorldPosition(new Vector3()));
      A.addScaledVector(F, -A.dot(F)).normalize();
      if (left) N.crossVectors(F, A);
      else N.crossVectors(A, F);
      N.normalize();
    } else F.copy(hp).sub(lo).normalize();
    const inv = bone.getWorldQuaternion(new Quaternion()).invert();
    return {
      left,
      arm,
      bone,
      twist: this.bones.get('lowerarm_twist_' + s) ?? null,
      fingers,
      thumb,
      f: F.clone().applyQuaternion(inv),
      n: N.clone().applyQuaternion(inv),
      gPos: new Vector3(),
      gFwd: new Vector3(0, 0, -1),
      gPalm: new Vector3(0, -1, 0),
      gCurl: [0, 0, 0, 0],
      gThumb: 0,
      gRate: 9,
      pos: new Vector3(),
      fwd: new Vector3(0, 0, -1),
      palm: new Vector3(0, -1, 0),
      curl: [0.2, 0.2, 0.2, 0.2],
      thumbIn: 0.2,
      started: false,
    };
  }

  /** Use this person as your own body: no head (the camera is inside it). */
  firstPerson(): void {
    this.self = true;
    // fold the head and neck away into the collar, and sit just behind the camera
    this.bones.get('neck')?.scale.setScalar(0.0001);
    this.holder.position.z = HIP_Z + 0.06;
    this.model.traverse((o) => {
      o.raycast = () => {};
    });
  }

  /** Rest-pose palm normals in seat space (down for both hands when the frame is right). */
  debugPalms(): number[][] {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    return this.hands.map((h) => {
      const q = h.bone.getWorldQuaternion(new Quaternion());
      const n = h.n.clone().applyQuaternion(q);
      const f = h.f.clone().applyQuaternion(q);
      return [n.x, n.y, n.z, f.x, f.y, f.z].map((v) => +v.toFixed(2));
    });
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * Pose the person for this frame. `frame` is the seat root (its world
   * rotation is the person's frame: facing -Z, the table centre at its origin).
   */
  update(frame: Object3D, f: RigFrame): void {
    const { t, dt } = f;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    frame.updateWorldMatrix(true, false);
    frame.getWorldQuaternion(_rq);
    _rqi.copy(_rq).invert();
    const X = _ax.set(1, 0, 0).applyQuaternion(_rq);
    const Y = _ay.set(0, 1, 0).applyQuaternion(_rq);
    const motion = clamp(f.motionScale, 0, 1);
    const env = clamp(f.moodT * 2, 0, 1) * motion;
    const mood: Mood = env > 0 ? f.mood : '';
    const reachW = f.reachW;
    const B = (n: string) => this.bones.get(n);
    const spine1 = B('spine_01');
    const spine2 = B('spine_02');
    const spine3 = B('spine_03');
    const neck = B('neck');
    const head = B('head');
    const jaw = B('jaw');
    const tracked = f.tracked;
    if (f.myTurn && !this.wasTurn) this.turnStart = t;
    this.wasTurn = f.myTurn;

    // ---- posture (negative leans in to the table, positive leans back)
    let lean = this.self ? 0.04 : -0.075;
    if (f.myTurn) lean -= 0.04;
    lean -= 0.17 * reachW;
    if (mood === 'laugh') lean += 0.13 * env;
    if (mood === 'frustrated' || mood === 'facepalm') lean -= 0.12 * env;
    if (mood === 'win' || mood === 'cheer') lean += 0.14 * env;
    if (mood === 'hit') lean += 0.22 * env;
    if (mood === 'skipped') lean += 0.08 * env;
    this.lean += (lean - this.lean) * (1 - Math.exp(-dt * 6));
    const breathe = 0.012 * Math.sin(t * 1.15 + f.phase) * motion;
    if (spine1) {
      turn(spine1, X, this.lean * 0.55);
      turn(spine1, Y, 0.014 * Math.sin(t * 0.31 + f.phase) * motion);
      // shifting weight from side to side
      turn(spine1, _k1.set(0, 0, 1).applyQuaternion(_rq), 0.012 * Math.sin(t * 0.19 + f.phase * 2) * motion);
    }
    if (spine2) {
      turn(spine2, X, this.lean * 0.45 + breathe);
      if (mood === 'angry') turn(spine2, Y, 0.025 * Math.sin(t * 8) * env);
    }
    if (spine3) {
      // laughter and cheering shake the shoulders
      if (mood === 'laugh') turn(spine3, X, 0.022 * Math.sin(t * 8.5) * env);
      if (mood === 'win' || mood === 'cheer') turn(spine3, X, 0.018 * Math.sin(t * 5.5) * env);
    }
    // Small clavicle movement gives breaths and reactions a shoulder follow-through.
    // The arm solver below still anchors both wrists to their exact card goals.
    const shrug = mood === 'skipped' || mood === 'hit' ? 0.07 * env : 0;
    const shoulderL = B('shoulder_l');
    const shoulderR = B('shoulder_r');
    const shoulderAxis = _k1.set(0, 0, 1).applyQuaternion(_rq);
    if (shoulderL) turn(shoulderL, shoulderAxis, -shrug - breathe * 0.35);
    if (shoulderR) turn(shoulderR, shoulderAxis, shrug + breathe * 0.35);

    // ---- head: tracked, else the action, else their own cards
    const quiet = !mood && !tracked && !this.self && motion > 0;
    if (quiet && t > this.glanceNext) {
      this.glanceUntil = t + 0.9 + this.rnd() * 0.9;
      this.glanceNext = this.glanceUntil + 3 + this.rnd() * 6;
      this.glanceCards = this.rnd() < 0.65;
      this.glanceYaw = (this.rnd() - 0.5) * 1.1;
    }
    const glancing = quiet && t < this.glanceUntil;
    let wantYaw = 0;
    let wantPitch = 0;
    if (tracked && tracked.h.length === 7) {
      _dq.set(tracked.h[3], tracked.h[4], tracked.h[5], tracked.h[6]);
      const fw = _d.set(0, 0, -1).applyQuaternion(_dq);
      wantYaw = Math.atan2(-fw.x, -fw.z);
      wantPitch = Math.atan2(fw.y, Math.hypot(fw.x, fw.z));
    } else if (head && !this.self) {
      // the card in hand while playing it, their own fan while thinking, otherwise the action
      const p = _lookP.copy(f.look);
      if (reachW > 0.25) p.copy(f.reach);
      else if ((f.myTurn && !mood) || (glancing && this.glanceCards)) p.copy(this.fanPos);
      head.getWorldPosition(_a);
      const d = _d.copy(p).sub(_a).applyQuaternion(_rqi);
      wantYaw = Math.atan2(-d.x, -d.z);
      wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      if (glancing && !this.glanceCards) {
        wantYaw = this.glanceYaw;
        wantPitch = -0.05;
      }
    }
    // the rest pose looks about 15 degrees down, and leaning in tips the head further
    wantPitch += 0.26 - this.lean;
    if (mood === 'laugh') wantPitch += 0.3 * env;
    if (mood === 'frustrated') wantPitch -= 0.3 * env;
    if (mood === 'facepalm') wantPitch -= 0.45 * env;
    if (mood === 'win' || mood === 'cheer') wantPitch += 0.25 * env;
    if (mood === 'skipped' || mood === 'angry') wantYaw += 0.12 * Math.sin(t * 5) * env;
    if (mood === 'hit') wantPitch += 0.45 * env;
    const turnAge = t - this.turnStart;
    if (!tracked && turnAge >= 0 && turnAge < 0.75) wantPitch -= 0.055 * Math.sin(turnAge / 0.75 * Math.PI) * motion;
    // nobody holds their head perfectly still
    if (!tracked) {
      wantYaw += 0.012 * Math.sin(t * 0.47 + f.phase * 3) * motion;
      wantPitch += 0.008 * Math.sin(t * 0.69 + f.phase) * motion;
    }
    wantYaw = clamp(wantYaw, -1.25, 1.25);
    wantPitch = clamp(wantPitch, -0.42, 0.75);
    const k = 1 - Math.exp(-dt * (tracked ? 14 : 6));
    this.yaw += (wantYaw - this.yaw) * k;
    this.pitch += (wantPitch - this.pitch) * k;
    // yaw first, then pitch about the turned head's own left-right axis
    const pitchAxis = _pitch.set(1, 0, 0).applyAxisAngle(_b.set(0, 1, 0), this.yaw).applyQuaternion(_rq);
    if (!this.self) {
      if (neck) {
        turn(neck, Y, this.yaw * 0.4);
        turn(neck, pitchAxis, this.pitch * 0.35);
      }
      if (head) {
        turn(head, Y, this.yaw * 0.6);
        turn(head, pitchAxis, this.pitch * 0.65);
        // a laugh throws the head about a little
        if (mood === 'laugh') turn(head, _k1.set(0, 0, 1).applyQuaternion(_rq), 0.025 * Math.sin(t * 4.5) * env);
      }
      this.face(t, motion, mood, env, Y, pitchAxis, wantYaw, wantPitch);
    }

    // ---- mouth: talking follows the voice; laughing and cheering open wide
    let open = f.voice > 0.03 ? clamp(f.voice * 0.6, 0, 0.22) * (0.6 + 0.4 * Math.abs(Math.sin(t * 18))) : 0;
    if (mood === 'laugh') open = Math.max(open, (0.17 + 0.07 * Math.sin(t * 15)) * env);
    if (mood === 'win' || mood === 'cheer') open = Math.max(open, 0.16 * env);
    if (mood === 'hit') open = Math.max(open, 0.2 * env);
    if (mood === 'frustrated') open = Math.max(open, 0.07 * env);
    this.jaw += (open - this.jaw) * (1 - Math.exp(-dt * 20));
    if (jaw && !this.self) turn(jaw, pitchAxis, -this.jaw);

    // ---- hands
    this.goals(f, mood, env);
    for (const h of this.hands) this.moveHand(h, frame, dt);

    // ---- the fan of cards rides in the card hand
    this.placeFan(frame);

    if (head) {
      head.getWorldPosition(_a);
      this.headPos.copy(frame.worldToLocal(_a));
    }
    void _m;
  }

  /** Eyes lead the head, and the scan's weighted eyelids blink independently of the other players. */
  private face(t: number, motion: number, mood: Mood, env: number, up: Vector3, pitchAxis: Vector3, wantYaw: number, wantPitch: number): void {
    if (this.blinkNext < 0) this.blinkNext = t + 0.8 + this.rnd() * 3.1;
    if (t >= this.blinkNext) {
      this.blinkStart = t;
      this.blinkNext = t + (this.rnd() < 0.16 ? 0.32 : 2.8 + this.rnd() * 4.2);
    }
    const age = t - this.blinkStart;
    // A quick close and a slower release reads as a blink rather than a wink.
    const blink = age < 0 || age > 0.24 ? 0 : age < 0.075 ? Math.sin(age / 0.075 * Math.PI / 2) : Math.cos((age - 0.075) / 0.165 * Math.PI / 2);
    for (const lid of this.faceLids) turn(lid, pitchAxis, -0.34 * blink * motion);
    const eyeYaw = clamp(wantYaw - this.yaw, -0.16, 0.16) * 0.45 * motion;
    const eyePitch = clamp(wantPitch - this.pitch, -0.1, 0.1) * 0.45 * motion;
    for (const eye of this.faceEyes) {
      turn(eye, up, eyeYaw);
      turn(eye, pitchAxis, eyePitch);
    }
    const brow = mood === 'hit' || mood === 'skipped' ? 0.045 : mood === 'win' || mood === 'cheer' ? 0.025 : mood === 'frustrated' || mood === 'angry' ? -0.025 : 0;
    for (const bone of this.faceBrows) turn(bone, pitchAxis, brow * env);
  }

  /** Decide where each hand wants to be this frame (seat space). */
  private goals(f: RigFrame, mood: Mood, env: number): void {
    const { t } = f;
    const [L, R] = this.hands;
    const hz = this.headPos.z || HIP_Z - 0.06;
    const ey = this.eyeY;
    const big = mood === 'win' || mood === 'cheer';

    // --- the card hand
    L.gRate = 9;
    L.gThumb = 0.75;
    for (let i = 0; i < 4; i++) L.gCurl[i] = CRADLE[i];
    const P = _g1.copy(FAN_P);
    const N = _g2.copy(FAN_N);
    const U = _g3.copy(FAN_U);
    P.y += 0.004 * Math.sin(t * 1.3 + f.phase) * f.motionScale;
    if (f.ownFan) {
      P.copy(f.ownFan.pos);
      N.copy(f.ownFan.normal);
      U.copy(f.ownFan.up);
      // your own cards are right in front of you: fingers flat behind them, thumb across the front
      for (let i = 0; i < 4; i++) L.gCurl[i] = 0.02 + i * 0.012;
      L.gThumb = 0.45;
    } else if (big) {
      // cards held high
      P.set(-0.3, ey + 0.32 + 0.02 * Math.sin(t * 5), HIP_Z - 0.12);
      N.set(0, 0.1, 1).normalize();
      U.set(-0.15, 1, -0.1);
    } else if (mood === 'frustrated') {
      // cards drop to the table
      P.set(-0.12, TABLE_Y + 0.075, 0.66);
      N.set(0, 0.86, 0.5).normalize();
      U.set(0, 0.5, -0.86);
    } else if (mood === 'laugh' || mood === 'hit') {
      P.y -= 0.04;
      P.x -= 0.03;
    } else if (f.myTurn) {
      // studying them
      P.y += 0.025;
      P.z += 0.02;
    }
    if (mood && mood !== 'laugh' && mood !== 'hit' && !f.ownFan) L.gRate = 7;
    U.addScaledVector(N, -U.dot(N)).normalize();
    this.grip(L, P, N, U);
    if (f.ownFan) {
      // The first-person fan is larger than the opponents' grip. Keep the
      // thumb pad on its lower border, rather than through the printed face.
      L.gPos.addScaledVector(U, -0.02).addScaledVector(N, -0.008);
    }
    // a tracked left hand only leaves the cards when it goes somewhere else
    this.fanHeld = true;
    const tl = f.tracked?.l;
    if (tl && tl.length >= 22) {
      const d = Math.hypot(tl[0] - L.gPos.x, tl[1] - L.gPos.y, tl[2] - L.gPos.z);
      if (d > 0.24) {
        this.trackedGoal(L, tl);
        this.fanHeld = false;
      }
    }

    // --- the free hand
    R.gRate = 9;
    const tr = f.tracked?.r;
    if (tr && tr.length >= 22) {
      this.trackedGoal(R, tr);
      return;
    }
    const curl = (c: number[]) => {
      for (let i = 0; i < 4; i++) R.gCurl[i] = c[i];
    };
    if (f.ownFan) {
      // both hands on your own fan: the right one steadies its lower right edge
      const p = _k1.copy(f.ownFan.pos).addScaledVector(_k2.crossVectors(f.ownFan.up, f.ownFan.normal), 0.2).addScaledVector(f.ownFan.up, 0.004);
      this.grip(R, p, f.ownFan.normal, f.ownFan.up);
      R.gPos.addScaledVector(f.ownFan.up, -0.02).addScaledVector(f.ownFan.normal, -0.008);
      for (let i = 0; i < 4; i++) R.gCurl[i] = 0.02 + i * 0.012;
      R.gThumb = 0.45;
    } else {
      // resting on the table by the cards
      R.gPos.set(0.17 + 0.02 * (this.index % 3), TABLE_Y + 0.032, 0.655);
      R.gFwd.set(-0.3, 0.02, -0.95).normalize();
      R.gPalm.set(0.08, -1, 0).normalize();
      curl(RELAXED);
      R.gThumb = 0.2;
      // now and then: drum the fingers, or tidy the fan
      if (!mood && !f.myTurn && f.motionScale > 0) {
        if (t > this.drumNext) {
          this.drumStart = t;
          this.drumNext = t + 7 + this.rnd() * 12;
        }
        if (t > this.sortNext) {
          this.sortStart = t;
          this.sortNext = t + 9 + this.rnd() * 11;
          this.glanceUntil = t + 1.3;
          this.glanceCards = true;
        }
      }
      const drum = t - this.drumStart;
      if (drum >= 0 && drum < 1.6 && f.motionScale > 0) for (let i = 0; i < 4; i++) R.gCurl[i] += 0.3 * Math.max(0, Math.sin(drum * 11 - (3 - i) * 0.9)) * f.motionScale;
      const sort = t - this.sortStart;
      if (sort >= 0 && sort < 1.5 && !mood && f.motionScale > 0) {
        // fingertips to the top edge of the fan, sliding a card along
        const along = -0.05 + 0.09 * clamp((sort - 0.35) / 0.8, 0, 1);
        const p = _k1.copy(L.gPos).addScaledVector(L.gFwd, GRIP_F).addScaledVector(FAN_U, 0.085);
        p.addScaledVector(_k2.crossVectors(FAN_U, FAN_N), along);
        R.gFwd.set(-0.72, 0.42, -0.2).normalize();
        R.gPalm.copy(FAN_N);
        R.gPos.copy(p).addScaledVector(R.gFwd, -0.15).addScaledVector(FAN_N, 0.012);
        curl([0.35, 0.42, 0.55, 0.65]);
        R.gThumb = 0.85;
        R.gRate = 8;
      }
    }

    // reactions take the free hand (and, when it is a big one, both)
    if (mood === 'win' || mood === 'cheer') {
      R.gPos.set(0.3, ey + 0.34 + 0.02 * Math.sin(t * 5 + 1.5), HIP_Z - 0.12);
      R.gFwd.set(0.12, 1, -0.05).normalize();
      R.gPalm.set(0, 0.05, -1).normalize();
      curl(FIST);
      R.gThumb = 1;
      R.gRate = 12;
    } else if (mood === 'clap') {
      // applause on the table top
      R.gPos.y += 0.015 + 0.035 * Math.abs(Math.sin(t * 6));
      curl(OPEN);
      R.gRate = 26;
    } else if (mood === 'angry') {
      R.gPos.set(0.2, TABLE_Y + 0.05 + 0.08 * Math.abs(Math.sin(t * 7)), 0.63);
      R.gFwd.set(-0.2, 0, -0.98).normalize();
      R.gPalm.set(-1, -0.2, 0).normalize();
      curl(FIST);
      R.gThumb = 1;
      R.gRate = 26;
    } else if (mood === 'frustrated') {
      // hand to the forehead
      R.gPos.set(0.1, ey + 0.02, hz - 0.14);
      R.gFwd.set(-0.5, 0.82, 0.25).normalize();
      R.gPalm.set(-0.15, -0.25, 1).normalize();
      curl(RELAXED);
      R.gThumb = 0.3;
    } else if (mood === 'facepalm') {
      R.gPos.set(0.07, ey - 0.13, hz - 0.15);
      R.gFwd.set(-0.3, 0.95, 0.12).normalize();
      R.gPalm.set(0, 0.05, 1).normalize();
      curl(OPEN);
      R.gThumb = 0.1;
    } else if (mood === 'laugh' && this.index % 2 === 1) {
      // laughing behind a hand
      R.gPos.set(0.09, ey - 0.2, hz - 0.15);
      R.gFwd.set(-0.62, 0.76, 0.1).normalize();
      R.gPalm.set(0, 0.1, 1).normalize();
      curl(RELAXED);
      R.gThumb = 0.3;
    } else if (mood === 'point' || mood === 'laugh') {
      // pointing at whoever it is about
      const sh = _k1.set(0.17, ey - 0.22, HIP_Z - 0.1);
      const to = _k2.copy(f.look).applyMatrix4(_m.copy(this.holder.parent!.matrixWorld).invert());
      to.y = Math.max(to.y, TABLE_Y + 0.28);
      const dir = to.sub(sh).normalize();
      R.gPos.copy(sh).addScaledVector(dir, 0.4 + 0.015 * Math.sin(t * 14));
      R.gFwd.copy(dir);
      R.gPalm.set(-0.5, -0.85, 0).normalize();
      curl(POINTING);
      R.gThumb = 0.9;
      R.gRate = 12;
    } else if (mood === 'skipped') {
      // "what can you do": an open palm
      R.gPos.set(0.3, TABLE_Y + 0.17, 0.72);
      R.gFwd.set(0.35, 0.1, -0.93).normalize();
      R.gPalm.set(-0.1, 1, 0.1).normalize();
      curl(OPEN);
      R.gThumb = 0;
    } else if (mood === 'hit') {
      R.gPos.set(0.24, TABLE_Y + 0.3, 0.82);
      R.gFwd.set(0, 0.8, -0.6).normalize();
      R.gPalm.set(0, -0.6, -0.8).normalize();
      curl(OPEN);
    }

    // playing or drawing a card: the hand goes with the card
    if (f.reachW > 0.001) {
      const w = f.reachW;
      const c = _k1.copy(f.reach).applyMatrix4(_m.copy(this.holder.parent!.matrixWorld).invert());
      const sh = _k2.set(0.17, ey - 0.22, HIP_Z - 0.08);
      const dir = _k3.copy(c).sub(sh);
      dir.y *= 0.4;
      dir.normalize();
      // fingers on the card's near edge
      R.gPos.lerp(c.addScaledVector(dir, -0.12).add(_tmp.set(0, 0.025, 0)), w);
      R.gFwd.lerp(dir, w).normalize();
      R.gPalm.lerp(_tmp.set(-0.25, -0.95, 0).normalize(), w).normalize();
      for (let i = 0; i < 4; i++) R.gCurl[i] += (0.3 - R.gCurl[i]) * w;
      R.gThumb += (0.6 - R.gThumb) * w;
      R.gRate = 9 + 21 * w;
    }
  }

  /** Put a hand's goal where it grips a fan: pivot `P`, faces along `N`, fan up `U` (seat space). */
  private grip(h: HandRig, P: Vector3, N: Vector3, U: Vector3): void {
    // along the bottom edge towards the other hand, angled up
    const across = _f1.crossVectors(U, N).multiplyScalar(h.left ? 1 : -1);
    h.gFwd.copy(across).multiplyScalar(Math.cos(BETA)).addScaledVector(U, Math.sin(BETA)).normalize();
    h.gPalm.copy(N);
    const A = h.left ? _f2.crossVectors(N, h.gFwd) : _f2.crossVectors(h.gFwd, N);
    // (your own hands sit a little further behind the cards, so no fingertip shows through)
    h.gPos.copy(P).addScaledVector(h.gFwd, -GRIP_F).addScaledVector(N, -GRIP_N - (this.self ? 0.012 : 0)).addScaledVector(A, -GRIP_A);
  }

  /** A tracked hand: wrist xyz, wrist quaternion, then the five fingertips (seat space). */
  private trackedGoal(h: HandRig, j: number[]): void {
    h.gPos.set(j[0], j[1], j[2]);
    _dq.set(j[3], j[4], j[5], j[6]);
    // WebXR wrist: -Z runs to the fingers, +Y comes out of the back of the hand
    h.gFwd.set(0, 0, -1).applyQuaternion(_dq);
    h.gPalm.set(0, -1, 0).applyQuaternion(_dq);
    for (let i = 0; i < 4; i++) {
      const o = 10 + i * 3;
      const d = Math.hypot(j[o] - j[0], j[o + 1] - j[1], j[o + 2] - j[2]);
      h.gCurl[i] = clamp((0.175 - d) / 0.09, 0, 1);
    }
    h.gThumb = clamp((0.125 - Math.hypot(j[7] - j[0], j[8] - j[1], j[9] - j[2])) / 0.05, 0, 1);
    h.gRate = 30;
  }

  /** Ease a hand towards its goal, then solve the arm, the wrist and the fingers. */
  private moveHand(h: HandRig, frame: Object3D, dt: number): void {
    if (!h.started) {
      h.started = true;
      h.pos.copy(h.gPos);
      h.fwd.copy(h.gFwd);
      h.palm.copy(h.gPalm);
    }
    const k = 1 - Math.exp(-dt * h.gRate);
    h.pos.lerp(h.gPos, k);
    h.fwd.lerp(h.gFwd, k).normalize();
    h.palm.lerp(h.gPalm, k).normalize();
    for (let i = 0; i < 4; i++) h.curl[i] += (h.gCurl[i] - h.curl[i]) * k;
    h.thumbIn += (h.gThumb - h.thumbIn) * k;

    const side = h.left ? -1 : 1;
    this.reach(h.arm, _w1.copy(h.pos).applyMatrix4(frame.matrixWorld), side, frame);
    const Fw = _w2.copy(h.fwd).applyQuaternion(_rq);
    const Nw = _w3.copy(h.palm).applyQuaternion(_rq);
    this.orient(h, Fw, Nw);
    this.fingers(h);
  }

  /** Two-bone IK: elbow bends down and out, hand reaches the target. */
  private reach(arm: Arm, target: Vector3, side: number, frame: Object3D): void {
    const S = arm.upper.getWorldPosition(_S);
    const toT = _T.copy(target).sub(S);
    const dist = clamp(toT.length(), 0.05, arm.len1 + arm.len2 - 0.005);
    toT.setLength(dist);
    const T = toT.add(S); // the reachable target (own vector: aim() reuses the shared scratch vectors)
    // elbow on the circle where both bones meet, pushed towards the pole (down, out, back)
    const a = (arm.len1 * arm.len1 - arm.len2 * arm.len2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, arm.len1 * arm.len1 - a * a));
    const dir = _dir.copy(T).sub(S).normalize();
    const pole = _pole.set(side * 0.5, -1, 0.45).applyQuaternion(frame.getWorldQuaternion(_pq));
    const perp = pole.sub(_tmp.copy(dir).multiplyScalar(pole.dot(dir))).normalize();
    const elbow = _el.copy(S).addScaledVector(dir, a).addScaledVector(perp, h);
    aim(arm.upper, arm.lower, elbow);
    aim(arm.lower, arm.hand, T);
  }

  /** Turn the wrist so the fingers run along `Fw` and the palm faces `Nw` (world). */
  private orient(h: HandRig, Fw: Vector3, Nw: Vector3): void {
    const bone = h.bone;
    if (!bone.parent) return;
    bone.getWorldQuaternion(_hq);
    const curF = _o1.copy(h.f).applyQuaternion(_hq);
    const curN = _o2.copy(h.n).applyQuaternion(_hq);
    _oq1.setFromUnitVectors(curF, Fw);
    const n1 = curN.applyQuaternion(_oq1);
    const nt = _o3.copy(Nw).addScaledVector(Fw, -Nw.dot(Fw));
    if (nt.lengthSq() > 1e-6) {
      nt.normalize();
      const ang = Math.atan2(_o4.crossVectors(n1, nt).dot(Fw), n1.dot(nt));
      _oq2.setFromAxisAngle(Fw, ang).multiply(_oq1);
    } else _oq2.copy(_oq1);
    // the forearm takes its share of the roll, so the wrist doesn't wring
    if (h.twist) {
      const D = _o4.copy(h.arm.hand.getWorldPosition(_o1)).sub(h.arm.lower.getWorldPosition(_o3)).normalize();
      let roll = 2 * Math.atan2(_oq2.x * D.x + _oq2.y * D.y + _oq2.z * D.z, _oq2.w);
      if (roll > Math.PI) roll -= 2 * Math.PI;
      if (roll < -Math.PI) roll += 2 * Math.PI;
      const keep = _oq1.copy(_oq2);
      turn(h.twist, D, roll * 0.55);
      _oq2.copy(keep);
    }
    bone.parent.getWorldQuaternion(_pq);
    _lq.copy(_pq).invert().multiply(_oq2).multiply(_pq);
    bone.quaternion.premultiply(_lq);
  }

  /** Curl the fingers towards the palm and bring the thumb across it. */
  private fingers(h: HandRig): void {
    h.bone.getWorldQuaternion(_hq);
    const F = _f1.copy(h.f).applyQuaternion(_hq);
    const N = _f2.copy(h.n).applyQuaternion(_hq);
    const hinge = _f3.crossVectors(F, N).normalize();
    for (let i = 0; i < 4; i++) {
      const c = clamp(h.curl[i], 0, 1.15);
      const chain = h.fingers[i];
      if (chain[0]) turn(chain[0], hinge, c * 1.15);
      if (chain[1]) turn(chain[1], hinge, c * 1.5);
      if (chain[2]) turn(chain[2], hinge, c * 1.0);
    }
    const th = h.thumb;
    if (th[0] && th[1] && h.thumbIn > 0.01) {
      // swing the thumb round in front of the palm, then bend it
      const T = _o1.copy(th[1].getWorldPosition(_o2)).sub(th[0].getWorldPosition(_o3)).normalize();
      const axis = _o4.crossVectors(T, N);
      if (axis.lengthSq() > 1e-6) {
        axis.normalize();
        const c = clamp(h.thumbIn, 0, 1);
        turn(th[0], axis, c * 0.7);
        turn(th[1], axis, c * 0.3);
        if (th[2]) turn(th[2], axis, c * 0.45);
      }
    }
  }

  /** Work out where the fan sits from the card hand's bones, so it never leaves the hand. */
  private placeFan(frame: Object3D): void {
    const h = this.hands[0];
    if (!this.fanHeld) {
      // the hand has let go: the cards wait where they are normally held
      const N = _g2.copy(FAN_N).applyQuaternion(_rq);
      const U = _g3.copy(FAN_U).applyQuaternion(_rq);
      this.fanPos.copy(FAN_P).applyMatrix4(frame.matrixWorld);
      this.setFanFrame(U, N);
      return;
    }
    h.bone.getWorldQuaternion(_hq);
    const F = _f1.copy(h.f).applyQuaternion(_hq);
    const N = _f2.copy(h.n).applyQuaternion(_hq);
    const A = _f3.crossVectors(N, F);
    h.bone.getWorldPosition(this.fanPos).addScaledVector(F, GRIP_F).addScaledVector(N, GRIP_N).addScaledVector(A, GRIP_A);
    const U = _g3.copy(A).multiplyScalar(Math.cos(BETA)).addScaledVector(F, Math.sin(BETA)).normalize();
    this.setFanFrame(U, N);
  }

  private setFanFrame(U: Vector3, N: Vector3): void {
    // x across the fan, y up it, z out of the card backs (away from the holder)
    const Zc = _k1.copy(N).negate();
    const Xc = _k2.crossVectors(U, Zc).normalize();
    const Yc = _k3.crossVectors(Zc, Xc);
    this.fanQuat.setFromRotationMatrix(_m.makeBasis(Xc, Yc, Zc));
  }
}

void DOWN;
