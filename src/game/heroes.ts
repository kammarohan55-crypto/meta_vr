/**
 * Stylized heroes for the Frostpeak table (KayKit Adventurers, CC0).
 *
 * public/models/heroes.glb holds the characters (scripts/build-heroes.mjs);
 * public/models/hero-anims.glb holds one shared set of clips. Each seat gets
 * a private copy with its own skeleton and mixer:
 * - the body plays the seated idle clip;
 * - the card hand is placed by two-bone IK and the fan hangs from its prop
 *   slot, so the cards always move with the hand;
 * - the free hand reaches for a card being played;
 * - the head looks at the action (or follows a remote player's tracked head);
 * - reactions blend upper-body Cheer / Hit clips over the seated legs.
 *
 * HeroRig has the same public surface as PersonRig, so avatars and the table
 * treat both alike.
 */
import {
  AnimationClip,
  AnimationMixer,
  AssetManager,
  Box3,
  Group,
  LoopOnce,
  Matrix4,
  SkinnedMesh,
  Skeleton,
  BufferGeometry,
  BufferAttribute,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import type { AnimationAction, Bone, KeyframeTrack, Material, Mesh, Object3D } from '@iwsdk/core';
import { TABLE_Y } from './env.js';
import { shareDepthMaterials } from './draw-tuning.js';
import type { RigFrame } from './people.js';

/** In the order seats and avatar choices use them. */
export const HEROES = ['Knight', 'Mage', 'Rogue_Hooded', 'Barbarian', 'Rogue'] as const;
/** What the table calls each hero (computer players take these names in Frostpeak). */
export const HERO_TITLES = ['Sir Bram', 'Mira the Mage', 'Wren', 'Thorga', 'Finn'] as const;
export const heroTitle = (index: number): string => HERO_TITLES[((index % HERO_TITLES.length) + HERO_TITLES.length) % HERO_TITLES.length];

/** Seat-space targets (the seat faces -Z; the chair cushion is ~0.53 m high, centred ~1.1 m out). */
const HIP = new Vector3(0, 0.55, 1.16);
const NECK_Y = 0.9;
const FAN_N = new Vector3(0, 0.38, 0.92).normalize();
const FAN_U = new Vector3(-0.06, 0.92, -0.38);
FAN_U.addScaledVector(FAN_N, -FAN_U.dot(FAN_N)).normalize();
/** Where the card hand holds the fan when nothing else is happening (seat space). */
const HOLD = new Vector3(0.07, TABLE_Y + 0.18, 0.86);
const UPPER = ['spine', 'chest', 'head', 'upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'handslot.l', 'upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r', 'handslot.r'];

const base = (p: string) => `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'}${p}`;
/** three.js strips '.' from node names when loading; KayKit bones use it (upperarm.l). */
const clean = (name: string) => name.replace(/[[\]:./]/g, '');

interface Library {
  scene: Object3D;
  idle: AnimationClip;
  cheer: AnimationClip;
  hit: AnimationClip;
  point: AnimationClip;
  magic: AnimationClip;
  hit2: AnimationClip;
  /** Measured once from the seated pose: model scale and the offset that seats the hips on HIP. */
  scale: number;
  hipLocal: Vector3;
  headTop: number;
  neck: number;
  facing: number;
}

let library: Library | null = null;
let loading: Promise<boolean> | null = null;

/** An upper-body version of `clip` whose hips and legs come from the seated idle. */
function overUpperBody(clip: AnimationClip, idle: AnimationClip, name: string): AnimationClip {
  const upper = new Set(UPPER.map(clean));
  const bone = (t: KeyframeTrack) => t.name.split('.')[0];
  const tracks = [
    ...clip.tracks.filter((t) => upper.has(bone(t))),
    ...idle.tracks.filter((t) => !upper.has(bone(t))),
  ];
  return new AnimationClip(name, clip.duration, tracks);
}

function findBone(root: Object3D, name: string): Bone | null {
  return (root.getObjectByName(clean(name)) ?? root.getObjectByName(name)) as Bone | null;
}

/** A private copy with its own skeleton (like SkeletonUtils.clone). */
function cloneHero(src: Object3D): Object3D {
  const clone = src.clone(true);
  const toClone = new Map<Object3D, Object3D>();
  const fromClone = new Map<Object3D, Object3D>();
  const walk = (a: Object3D, b: Object3D) => {
    toClone.set(a, b);
    fromClone.set(b, a);
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
  // every hero shares one rig, so the loader suffixed the later copies (head_1, chest_2...);
  // restore the plain names so the shared clips and bone lookups find them
  clone.traverse((o) => {
    if ((o as Bone).isBone) o.name = o.name.replace(/_\d+$/, '');
  });
  return clone;
}

/** Load the heroes and clips once, and measure the seated pose. */
export function loadHeroes(): Promise<boolean> {
  if (!loading) {
    loading = Promise.all([
      AssetManager.loadGLTF(base('models/heroes.glb'), 'heroes'),
      AssetManager.loadGLTF(base('models/hero-anims.glb'), 'hero-anims'),
    ])
      .then(([heroes, anims]) => {
        const clip = (n: string) => {
          const c = anims.animations.find((a) => a.name === n);
          if (!c) throw new Error(`hero clip ${n} missing`);
          return c;
        };
        const idle = clip('Sit_Chair_Idle');
        const scene = heroes.scene;
        scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.frustumCulled = false; // skinned bounds are stale once posed
          m.raycast = () => {};
        });
        // measure one hero in the seated pose
        const probe = cloneHero(scene.getObjectByName('Hero_Knight') as Object3D);
        probe.position.set(0, 0, 0);
        const mixer = new AnimationMixer(probe);
        mixer.clipAction(idle).play();
        mixer.update(0.4);
        probe.updateMatrixWorld(true);
        const hips = (findBone(probe, 'hips') as Bone).getWorldPosition(new Vector3());
        const neck = (findBone(probe, 'head') as Bone).getWorldPosition(new Vector3());
        const knee = (findBone(probe, 'lowerleg.l') as Bone).getWorldPosition(new Vector3());
        const box = new Box3().setFromObject(probe, true);
        const scale = (NECK_Y - HIP.y) / Math.max(0.2, neck.y - hips.y);
        library = {
          scene,
          idle,
          cheer: overUpperBody(clip('Cheer'), idle, 'Seat_Cheer'),
          hit: overUpperBody(clip('Hit_A'), idle, 'Seat_Hit'),
          point: overUpperBody(clip('Interact'), idle, 'Seat_Point'),
          magic: overUpperBody(clip('Spellcast_Raise'), idle, 'Seat_Magic'),
          hit2: overUpperBody(clip('Hit_B'), idle, 'Seat_Hit2'),
          scale,
          hipLocal: hips,
          headTop: box.max.y,
          neck: neck.y,
          facing: knee.z >= hips.z ? 1 : -1,
        };
        return true;
      })
      .catch((err) => {
        console.warn('[afterhours] heroes unavailable', err);
        return false;
      });
  }
  return loading;
}

export function heroesReady(): boolean {
  return library !== null;
}

export function createHeroRig(index: number): HeroRig | null {
  if (!library) return null;
  const name = HEROES[((index % HEROES.length) + HEROES.length) % HEROES.length];
  const src = library.scene.getObjectByName(`Hero_${name}`);
  if (!src) return null;
  const model = cloneHero(src);
  mergeHeroParts(model);
  splitSkinnedMaterials(model);
  // legs sit under the table, inside its shadow: drawing them into the shadow map is wasted work
  model.traverse((o) => {
    if ((o as Mesh).isMesh && /leg/i.test(o.name)) o.castShadow = false;
    // the mixer writes bone rotations as quaternions; keeping each bone's Euler copy in sync
    // (which nothing here reads) cost a matrix and a decomposition per bone per frame
    if ((o as Bone).isBone) o.quaternion._onChange(() => {});
  });
  shareDepthMaterials(model);
  return new HeroRig(index, model, library);
}

/** Merged body geometry per hero model (clones of one hero share it: same bone order). */
const mergedBodies = new Map<string, BufferGeometry>();

/**
 * One skinned mesh and one skeleton per hero instead of six. A KayKit hero is six skinned pieces
 * (body, two arms, two legs, head), each with its own copy of the skeleton: six draw calls, and
 * six bone textures recomputed and uploaded every frame. Body, arms and legs become one mesh;
 * the head stays its own mesh (the first-person view hides it) but binds to the same skeleton.
 */
function mergeHeroParts(model: Object3D): void {
  const parts: SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh);
  });
  if (parts.length < 2) return;
  const parent = parts[0].parent;
  const material = parts[0].material;
  if (!parent || parts.some((p) => p.parent !== parent || p.material !== material)) return;
  // every bone any piece uses, once, in one skeleton
  const bones: Bone[] = [];
  const inverses: Matrix4[] = [];
  const slot = new Map<Bone, number>();
  for (const p of parts) {
    p.skeleton.bones.forEach((b, i) => {
      if (slot.has(b)) return;
      slot.set(b, bones.length);
      bones.push(b);
      inverses.push(p.skeleton.boneInverses[i].clone());
    });
  }
  const skeleton = new Skeleton(bones, inverses);
  // a piece's skin indices point into its own skeleton; re-point them into the shared one
  const remap = (p: SkinnedMesh): BufferGeometry => {
    const g = p.geometry.clone();
    const si = g.getAttribute('skinIndex') as BufferAttribute;
    for (let v = 0; v < si.count; v++) {
      for (let k = 0; k < si.itemSize; k++) si.setComponent(v, k, slot.get(p.skeleton.bones[si.getComponent(v, k)]) ?? 0);
    }
    return g;
  };
  const isHead = (p: SkinnedMesh) => /head/i.test(p.name);
  const body = parts.filter((p) => !isHead(p));
  let geometry = mergedBodies.get(parent.name);
  if (!geometry) {
    geometry = concatGeometries(body.map(remap));
    mergedBodies.set(parent.name, geometry);
  }
  const merged = new SkinnedMesh(geometry, material);
  merged.name = `${parent.name}_Merged`;
  merged.castShadow = true;
  merged.receiveShadow = parts[0].receiveShadow;
  merged.frustumCulled = parts[0].frustumCulled;
  parent.add(merged);
  merged.bind(skeleton, parts[0].bindMatrix.clone());
  for (const p of body) p.removeFromParent();
  for (const p of parts.filter(isHead)) {
    p.geometry = remap(p);
    p.bind(skeleton, p.bindMatrix.clone());
  }
}

/** Join indexed or plain geometries with the same attributes into one indexed geometry. */
function concatGeometries(geos: BufferGeometry[]): BufferGeometry {
  const out = new BufferGeometry();
  const counts = geos.map((g) => g.getAttribute('position').count);
  const vertices = counts.reduce((a, b) => a + b, 0);
  for (const name of Object.keys(geos[0].attributes)) {
    const first = geos[0].getAttribute(name) as BufferAttribute;
    const size = first.itemSize;
    // keep the stored type when every piece agrees (skin weights may be normalised integers)
    type Typed = Float32Array | Uint16Array | Uint8Array | Int16Array | Int8Array | Uint32Array;
    const ctor = (first.array as Typed).constructor as new (n: number) => Typed;
    const same = geos.every((g) => (g.getAttribute(name).array as Typed).constructor === ctor);
    const data = same ? new ctor(vertices * size) : new Float32Array(vertices * size);
    let base = 0;
    geos.forEach((g, gi) => {
      const a = g.getAttribute(name);
      for (let v = 0; v < counts[gi]; v++) for (let c = 0; c < size; c++) data[(base + v) * size + c] = a.getComponent(v, c);
      base += counts[gi];
    });
    out.setAttribute(name, new BufferAttribute(data, size, same && first.normalized));
  }
  const total = geos.reduce((n, g, gi) => n + (g.index ? g.index.count : counts[gi]), 0);
  const index = vertices > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let at = 0;
  let base = 0;
  geos.forEach((g, gi) => {
    if (g.index) for (let i = 0; i < g.index.count; i++) index[at++] = g.index.getX(i) + base;
    else for (let i = 0; i < counts[gi]; i++) index[at++] = base + i;
    base += counts[gi];
  });
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** One copy of a skinned material for the plain (non-skinned) meshes that share it. */
const plainCopies = new Map<Material, Material>();

/**
 * A KayKit hero's skinned body and its plain props (hat, hood, gear) share one material. A
 * skinned and a plain mesh need different shader programs, so three switched programs on nearly
 * every hero draw and re-derived the program parameters each time. Plain meshes get their own
 * copy (shared by every hero that uses the same texture), so each material keeps one program.
 */
function splitSkinnedMaterials(model: Object3D): void {
  const skinned = new Set<Material>();
  model.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) for (const m of ([] as Material[]).concat((o as Mesh).material)) skinned.add(m);
  });
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (o as SkinnedMesh).isSkinnedMesh) return;
    const swap = (m: Material): Material => {
      if (!skinned.has(m)) return m;
      let copy = plainCopies.get(m);
      if (!copy) {
        copy = m.clone();
        plainCopies.set(m, copy);
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

// ---------------------------------------------------------------- IK helpers
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _t = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _pole = new Vector3();
const _p0 = new Vector3();
const _q = new Quaternion();
const _pq = new Quaternion();
const _lq = new Quaternion();
const _fq = new Quaternion();
const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const IDENTITY = new Quaternion();
const UP = new Vector3(0, 1, 0);
const _dp = new Vector3();
const _ds = new Vector3();
const _frameInv = new Matrix4();

/*
 * World-space reads for the rig. three's getWorldPosition / getWorldQuaternion / localToWorld /
 * worldToLocal each re-walk every parent up to the scene root (about 14 levels for a hand bone)
 * on every call, and the rig made ~30 such calls per hero per frame: the largest single cost on
 * the CPU. The rig refreshes its whole subtree once per frame, and each bone it turns refreshes
 * its own subtree, so the matrices are already current and can be read directly.
 */
const worldPos = (o: Object3D, out: Vector3): Vector3 => out.setFromMatrixPosition(o.matrixWorld);
const worldQuat = (o: Object3D, out: Quaternion): Quaternion => {
  o.matrixWorld.decompose(_dp, out, _ds);
  return out;
};

/** Swing `bone` so the world point `from` (on its chain) moves towards `to`, by `w`. */
function swing(bone: Object3D, from: Vector3, to: Vector3, w: number): void {
  if (!bone.parent || w <= 0) return;
  worldPos(bone, _p0);
  _d.subVectors(from, _p0);
  _e.subVectors(to, _p0);
  if (_d.lengthSq() < 1e-8 || _e.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(_d.normalize(), _e.normalize());
  if (w < 1) _q.slerpQuaternions(IDENTITY, _q, w);
  worldQuat(bone.parent, _pq);
  _lq.copy(_pq).invert().multiply(_q).multiply(_pq);
  bone.quaternion.premultiply(_lq);
  bone.updateMatrixWorld(true);
}

interface Arm {
  upper: Bone;
  lower: Bone;
  hand: Bone;
  slot: Bone;
}

/** Two-bone IK: put the hand at `target` with the elbow bending towards `pole`, by weight `w`. */
function reach(arm: Arm, target: Vector3, pole: Vector3, w: number): void {
  if (w <= 0.001) return;
  worldPos(arm.upper, _a);
  worldPos(arm.lower, _b);
  worldPos(arm.hand, _c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _t.subVectors(target, _a);
  const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, _t.length()));
  _t.normalize();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.copy(pole).addScaledVector(_t, -pole.dot(_t)).normalize();
  const elbow = _e.copy(_a).addScaledVector(_t, l1 * cosA).addScaledVector(_pole, l1 * sinA);
  swing(arm.upper, _b, elbow.clone(), w);
  worldPos(arm.hand, _c);
  const goal = _d.copy(_a).addScaledVector(_t, d);
  swing(arm.lower, _c, goal.clone(), w);
}

// ---------------------------------------------------------------- the rig
export class HeroRig {
  readonly holder = new Group();
  readonly model: Object3D;
  readonly index: number;
  /** Top of the head, in the avatar's frame (the nameplate floats just above). */
  readonly headPos = new Vector3();
  readonly eyeY: number;
  /** The fan of cards in the card hand, world space. */
  readonly fanPos = new Vector3();
  readonly fanQuat = new Quaternion();

  private mixer: AnimationMixer;
  private moods: Record<MoodClip, AnimationAction>;
  private current: AnimationAction | null = null;
  private idle: AnimationAction;
  private right: Arm;
  private left: Arm;
  private head: Bone;
  private chest: Bone;
  private yaw = 0;
  private pitch = 0;
  private lib: Library;
  private self = false;
  /** False while seated without cards (the menu): the card hand rests instead of holding a fan. */
  holding = true;
  /** A remote player's tracked hands, eased toward each received pose. */
  private trackR = new Vector3();
  private trackL = new Vector3();
  private handsLive = false;
  private hold = 1;

  constructor(index: number, model: Object3D, lib: Library) {
    this.index = index;
    this.model = model;
    this.lib = lib;
    model.scale.setScalar(lib.scale);
    if (lib.facing > 0) model.rotation.y = Math.PI; // the pack faces +Z; seats face -Z
    // put the measured seated hips onto the cushion
    const hip = lib.hipLocal.clone().multiplyScalar(lib.scale).applyAxisAngle(UP, model.rotation.y);
    model.position.set(HIP.x - hip.x, HIP.y - hip.y, HIP.z - hip.z);
    this.holder.add(model);
    this.eyeY = HIP.y + (lib.neck - lib.hipLocal.y) * lib.scale + 0.18;

    const arm = (s: 'l' | 'r'): Arm => ({
      upper: findBone(model, `upperarm.${s}`) as Bone,
      lower: findBone(model, `lowerarm.${s}`) as Bone,
      hand: findBone(model, `hand.${s}`) as Bone,
      slot: findBone(model, `handslot.${s}`) as Bone,
    });
    this.right = arm('r');
    this.left = arm('l');
    this.head = findBone(model, 'head') as Bone;
    this.chest = findBone(model, 'chest') as Bone;

    this.mixer = new AnimationMixer(model);
    const idle = this.mixer.clipAction(lib.idle);
    idle.time = Math.random() * lib.idle.duration; // nobody breathes in sync
    idle.play();
    this.idle = idle;
    const once = (clip: AnimationClip) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    };
    this.moods = { cheer: once(lib.cheer), hit: once(lib.hit), point: once(lib.point), magic: once(lib.magic), hit2: once(lib.hit2) };
  }

  /** You, seen from inside your own head: hide the head and hat. */
  firstPerson(): void {
    this.self = true;
    this.model.traverse((o) => {
      if (/head|hat|helmet|hood/i.test(o.name) && (o as Mesh).isMesh) o.visible = false;
    });
  }

  debugPalms(): number[][] {
    return [];
  }

  update(frame: Object3D, f: RigFrame): void {
    const motion = f.motionScale;
    // ---- reactions: one upper-body clip at a time, over the seated idle
    const which = moodClip(f.mood);
    const action = which ? this.moods[which] : null;
    if (action !== this.current) {
      this.current?.fadeOut(0.35);
      if (action) action.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      if (action) action.timeScale = f.mood === 'laugh' ? 1.3 : 1;
      this.current = action;
    }
    // the reaction clip carries the seated legs, so the idle steps aside while it plays
    let overlay = 0;
    for (const a of Object.values(this.moods)) overlay = Math.max(overlay, a.isRunning() ? a.getEffectiveWeight() : 0);
    this.idle.setEffectiveWeight(1 - overlay);
    this.mixer.update(f.dt * (motion > 0 ? 1 : 0.35));
    // one refresh of the whole avatar (the model is inside the frame); reads below use it
    frame.updateMatrixWorld(true);
    const toFrame = _frameInv.copy(frame.matrixWorld).invert();
    const toWorld = frame.matrixWorld;

    const frameQ = worldQuat(frame, _fq);
    const react = action ? Math.min(1, f.moodT * 2) : 0;

    // ---- head: tracked, else the action, else their cards
    const tr = f.tracked;
    let wantYaw = 0;
    let wantPitch = 0;
    if (tr && tr.h.length === 7) {
      _q.set(tr.h[3], tr.h[4], tr.h[5], tr.h[6]);
      const fw = _x.set(0, 0, -1).applyQuaternion(_q);
      wantYaw = Math.atan2(-fw.x, -fw.z);
      wantPitch = Math.atan2(fw.y, Math.hypot(fw.x, fw.z));
    } else if (!this.self) {
      const look = _y.copy(f.reachW > 0.25 ? f.reach : f.myTurn ? this.fanPos : f.look).applyMatrix4(toFrame);
      worldPos(this.head, _z).applyMatrix4(toFrame);
      look.sub(_z);
      wantYaw = Math.atan2(-look.x, -look.z);
      wantPitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
    }
    const k = 1 - Math.exp(-f.dt * 6);
    this.yaw += (Math.max(-0.75, Math.min(0.75, wantYaw)) - this.yaw) * k;
    this.pitch += (Math.max(-0.5, Math.min(0.35, wantPitch)) - this.pitch) * k;
    const w = 1 - react;
    if (w > 0) {
      const up = _x.copy(UP).applyQuaternion(frameQ);
      const right = _z.set(1, 0, 0).applyQuaternion(frameQ);
      turnWorld(this.head, up, this.yaw * w);
      turnWorld(this.head, right, this.pitch * w * 0.8);
      // lean in a little on your turn, sit back otherwise
      if (f.myTurn && !this.self) turnWorld(this.chest, right, -0.12 * w * (motion > 0 ? 1 : 0.5));
    }

    // ---- the card hand holds the fan in front of the chest
    const pole = _pole.set(0.6, -1, 0.5).applyQuaternion(frameQ);
    if (!tr || tr.r.length < 7) this.handsLive = false;
    if (f.ownFan) {
      const across = _y.crossVectors(f.ownFan.up, f.ownFan.normal).normalize();
      const r = _t.copy(f.ownFan.pos).addScaledVector(across, 0.11).addScaledVector(f.ownFan.up, -0.03);
      reach(this.right, r.clone().applyMatrix4(toWorld), pole, 1);
      const l = _t.copy(f.ownFan.pos).addScaledVector(across, -0.11).addScaledVector(f.ownFan.up, -0.03);
      reach(this.left, l.clone().applyMatrix4(toWorld), _pole.set(-0.6, -1, 0.5).applyQuaternion(frameQ), 1);
    } else if (tr && tr.r.length >= 7) {
      // a remote player's tracked hands: ease toward each received pose (they arrive at 12 Hz)
      const ease = 1 - Math.exp(-f.dt * 16);
      if (!this.handsLive) {
        this.trackR.set(tr.r[0], tr.r[1], tr.r[2]);
        if (tr.l.length >= 7) this.trackL.set(tr.l[0], tr.l[1], tr.l[2]);
      }
      this.handsLive = true;
      this.trackR.lerp(_t.set(tr.r[0], tr.r[1], tr.r[2]), ease);
      reach(this.right, _t.copy(this.trackR).applyMatrix4(toWorld), pole, 1);
      if (tr.l.length >= 7) {
        this.trackL.lerp(_t.set(tr.l[0], tr.l[1], tr.l[2]), ease);
        reach(this.left, _t.copy(this.trackL).applyMatrix4(toWorld), _pole.set(-0.6, -1, 0.5).applyQuaternion(frameQ), 1);
      }
    } else {
      // procedural emotes: clap, point and facepalm move the hands themselves
      const gesture = moodClip(f.mood) ? 0 : Math.min(1, f.moodT * 2.5);
      const kind = gesture > 0 ? f.mood : '';
      this.hold += ((this.holding ? 1 : 0) - this.hold) * (1 - Math.exp(-f.dt * 3));
      const hold = _t.copy(HOLD).applyMatrix4(toWorld);
      const rightBusy = kind === 'clap' || kind === 'point' ? gesture : 0;
      reach(this.right, hold, pole, (1 - react * 0.85) * this.hold * (1 - rightBusy));
      if (f.reachW > 0.01) reach(this.left, f.reach, _pole.set(-0.6, -1, 0.3).applyQuaternion(frameQ), Math.min(1, f.reachW));
      if (kind === 'clap') {
        const open = 0.025 + 0.075 * (0.5 + 0.5 * Math.sin(f.t * 14));
        const c = _GESTURE.set(0, NECK_Y - 0.16, HIP.z - 0.3);
        reach(this.right, _t.copy(c).setX(open).applyMatrix4(toWorld), pole, gesture);
        reach(this.left, _t.copy(c).setX(-open).applyMatrix4(toWorld), _pole.set(-0.6, -1, 0.5).applyQuaternion(frameQ), gesture);
      } else if (kind === 'point') {
        // reach out towards whoever they are looking at
        worldPos(this.right.upper, _a);
        const dir = _b.subVectors(f.look, _a).normalize();
        reach(this.right, _c.copy(_a).addScaledVector(dir, 0.6 * this.lib.scale * 2), _pole.set(0.4, -1, 0.2).applyQuaternion(frameQ), gesture);
      } else if (kind === 'facepalm') {
        worldPos(this.head, _a).applyMatrix4(toFrame);
        _a.y += 0.12 * this.lib.scale * 2;
        _a.z -= 0.16 * this.lib.scale * 2;
        reach(this.left, _a.applyMatrix4(toWorld), _pole.set(-0.6, -1, 0.6).applyQuaternion(frameQ), gesture);
        turnWorld(this.head, _z.set(1, 0, 0).applyQuaternion(frameQ), 0.25 * gesture);
      }
    }

    // ---- the fan hangs from the hand's prop slot; it faces the holder
    worldPos(this.right.slot, this.fanPos);
    const N = _a.copy(FAN_N).applyQuaternion(frameQ);
    const U = _b.copy(FAN_U).applyQuaternion(frameQ);
    const Zc = _c.copy(N).negate();
    const Xc = _y.crossVectors(U, Zc).normalize();
    const Yc = _x.crossVectors(Zc, Xc);
    this.fanQuat.setFromRotationMatrix(_m.makeBasis(Xc, Yc, Zc));

    // ---- head position for the nameplate (just under the top of the head)
    worldPos(this.head, _a).applyMatrix4(toFrame);
    this.headPos.set(_a.x, HIP.y + (this.lib.headTop - this.lib.hipLocal.y) * this.lib.scale - 0.12, _a.z);
  }
}

/** Rotate a bone about a world axis through its own pivot. */
function turnWorld(bone: Object3D, axisWorld: Vector3, angle: number): void {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  worldQuat(bone.parent, _pq);
  _q.setFromAxisAngle(axisWorld, angle);
  _lq.copy(_pq).invert().multiply(_q).multiply(_pq);
  bone.quaternion.premultiply(_lq);
  bone.updateMatrixWorld(true);
}

type MoodClip = 'cheer' | 'hit' | 'point' | 'magic' | 'hit2';
const _GESTURE = new Vector3();

/** Which upper-body clip a mood plays; clap, point and facepalm are procedural (null). */
function moodClip(mood: RigFrame['mood']): MoodClip | null {
  switch (mood) {
    case 'cheer':
    case 'win':
    case 'laugh':
      return 'cheer';
    case 'cool':
    case 'throw':
      return 'magic';
    case 'cry':
      return 'hit2';
    case 'hit':
    case 'skipped':
    case 'frustrated':
    case 'angry':
      return 'hit';
    default:
      return null;
  }
}
