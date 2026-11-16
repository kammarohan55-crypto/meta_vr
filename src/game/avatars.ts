/**
 * The people (and robots) round the table.
 *
 * A person is drawn from what Quest actually tracks: head pose and hand
 * joints, sent ~20 times a second. Arms are solved with two-bone IK from the
 * shoulder to the tracked wrist; the mouth follows their voice level. When
 * tracking data is missing (or for emotes) the avatar falls back to authored
 * procedural poses. Faces remain visible; head direction and wrist movement
 * still follow tracking without drawing a headset over the person's face.
 *
 * Computer players are small white robots with expressive screen faces.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  Sprite,
  SpriteMaterial,
} from '@iwsdk/core';
import type { EmoteKind, PoseMsg, SeatInfo } from '../../shared/protocol.ts';
import { PEOPLE, castSize, createPersonRig, newRigFrame, peopleReady } from './people.js';
import { heroTitle } from './heroes.js';
import { useHeroes } from './world-choice.js';
import type { FanPose, Mood, RigFrame, SeatedRig } from './people.js';
import { TABLE_Y, seatAngle } from './env.js';
import { FONT_UI, roundRect } from './ui.js';
import { clamp, damp, lerp, tableToWorld } from './util.js';
import { mergeStatic } from './draw-tuning.js';

export const SKIN = [0xf1d0b5, 0xe0b48f, 0xc68e64, 0x9c6644, 0x6e4430, 0x4a2c20];
export const HAIR = [0x1c1410, 0x3b2416, 0x6b3e1f, 0xb07b3c, 0xd9c08a, 0x2a2440, 0x8a2a4a];
export const OUTFIT = [0x1d1d26, 0x2b3f8c, 0x7a2a8c, 0x1f6e5a, 0xb4442f, 0xe8e2d4, 0x3a3a44];
/** Hoodie trim colours, one per outfit. */
const STRIPE = [0xff8a3d, 0xf5f5f5, 0x7dd3fc, 0xfbbf24, 0xf5f5f5, 0x8b5cf6, 0x4ade80];
export const HAIR_STYLES = 4;
export const ROBOT_TINT = [0x58c4ff, 0xff7ad9, 0x7dff9a, 0xffc857];

/** Default head position in seat space (seated, leaning slightly in). */
const HEAD_REST = new Vector3(0, 1.14, 0.98);
const SHOULDER_DROP = 0.24;
const SHOULDER_HALF = 0.19;
const UPPER = 0.29;
const FORE = 0.27;

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _eul = new Euler();
const UP = new Vector3(0, 1, 0);

/** A capsule stretched between two points. */
function limb(mesh: Mesh, a: Vector3, b: Vector3, radius: number): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  // the unit capsule (radius 1, middle 1) is 3 units tall end to end
  mesh.scale.set(radius, Math.max(0.001, len / 3), radius);
  _v.copy(b).sub(a).normalize();
  mesh.quaternion.setFromUnitVectors(UP, _v);
}

/** Two-bone IK: elbow position for a shoulder→wrist reach, bending outward and down. */
function solveElbow(shoulder: Vector3, wrist: Vector3, side: number, out: Vector3): Vector3 {
  const d = Math.min(shoulder.distanceTo(wrist), UPPER + FORE - 0.001);
  const a = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  _v.copy(wrist).sub(shoulder).normalize();
  const mid = _v2.copy(shoulder).addScaledVector(_v, a);
  // bend direction: outward and down
  const pole = new Vector3(side * 0.7, -1, 0.15).normalize();
  pole.addScaledVector(_v, -pole.dot(_v)).normalize();
  return out.copy(mid).addScaledVector(pole, h);
}

class Nameplate {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private key = '';
  constructor() {
    this.canvas.width = 768;
    this.canvas.height = 192;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(0.39, 0.0975),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.mesh.name = 'Player namechip';
    this.mesh.renderOrder = 25;
    this.mesh.raycast = () => {};
  }
  draw(name: string, count: number, turn: boolean, voice: number, ai: boolean, connected: boolean, crown: boolean): void {
    const v = Math.round(voice * 4);
    const key = `${name}|${count}|${turn}|${v}|${ai}|${connected}|${crown}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 768, 192);
    const x = 12, y = 18, w = 744, h = 156;
    const ink = c.createLinearGradient(0, y, 0, y + h);
    ink.addColorStop(0, turn ? 'rgba(19,38,51,0.97)' : 'rgba(17,26,38,0.96)');
    ink.addColorStop(1, 'rgba(7,13,23,0.97)');
    roundRect(c, x, y, w, h, 30);
    c.fillStyle = ink;
    c.fill();
    const edge = c.createLinearGradient(x, y, x + w, y + h);
    edge.addColorStop(0, turn ? '#79e3e3' : 'rgba(121,227,227,0.48)');
    edge.addColorStop(0.45, 'rgba(125,179,209,0.24)');
    edge.addColorStop(1, turn ? '#a7a1f2' : 'rgba(167,161,242,0.36)');
    c.lineWidth = turn ? 3 : 2;
    c.strokeStyle = edge;
    c.stroke();
    // The medallion stays recognizable while the player name is truncated.
    const medallion = c.createLinearGradient(40, 45, 130, 145);
    medallion.addColorStop(0, '#28545d');
    medallion.addColorStop(1, '#152d40');
    c.fillStyle = medallion;
    c.beginPath();
    c.arc(94, 96, 51, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(166,224,227,0.6)';
    c.lineWidth = 1.5;
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#dbf5f3';
    c.font = `600 46px ${FONT_UI}`;
    c.fillText((name.trim()[0] ?? '?').toUpperCase(), 94, 98);
    c.textAlign = 'left';
    c.fillStyle = connected ? '#f1f4f7' : '#98a3b2';
    c.font = `600 44px ${FONT_UI}`;
    c.fillText(name, 171, 77, 390);
    // Explicit status and a small light communicate a turn without purple fill.
    c.fillStyle = !connected ? '#a1a9b4' : turn ? '#82e8d8' : v > 0 ? '#9ce8bd' : '#a3b2c3';
    c.beginPath();
    c.arc(178, 126, 5, 0, Math.PI * 2);
    c.fill();
    c.font = `500 23px ${FONT_UI}`;
    const status = !connected ? 'RECONNECTING' : crown ? 'ROUND WINNER' : turn ? 'PLAYING' : v > 0 ? 'SPEAKING' : ai ? 'COMPUTER PLAYER' : 'AT THE TABLE';
    c.fillText(status, 195, 127, 350);
    // Voice activity is shown beside the status, away from the name.
    if (!ai && v > 0) {
      c.fillStyle = '#83dbc1';
      for (let i = 0; i < 4; i++) {
        const bar = i < v ? 9 + i * 5 : 5;
        c.fillRect(566 + i * 8, 100 - bar / 2, 4, bar);
      }
    }
    const urgent = count === 1;
    roundRect(c, 624, 47, 100, 98, 20);
    c.fillStyle = urgent ? 'rgba(187,75,88,0.25)' : turn ? 'rgba(130,232,216,0.14)' : 'rgba(207,222,238,0.08)';
    c.fill();
    c.fillStyle = urgent ? '#ffb6bc' : turn ? '#c3f5ec' : '#edf2f7';
    c.textAlign = 'center';
    c.font = `600 44px ${FONT_UI}`;
    c.fillText(count >= 0 ? String(count) : '-', 674, 86);
    c.font = `500 16px ${FONT_UI}`;
    c.fillStyle = '#9fb0c2';
    c.fillText(count === 1 ? 'CARD' : 'CARDS', 674, 123);
    this.tex.needsUpdate = true;
  }
}

/** Keep chips upright; a label should not tip away as the viewer sits lower. */
function faceNameplate(plate: Nameplate, root: Object3D, viewer: Vector3): void {
  // the viewer arrives in table space
  root.worldToLocal(tableToWorld(_v2.copy(viewer)));
  _v2.y = plate.mesh.position.y;
  plate.mesh.lookAt(root.localToWorld(_v2));
}

export interface AvatarState {
  info: SeatInfo;
  count: number;
  turn: boolean;
  crown: boolean;
}

/** Shared look of every avatar: what it does when not driven by tracking. */
abstract class Base {
  readonly root = new Group();
  readonly plate = new Nameplate();
  readonly head = new Group();
  emote: EmoteKind | 'frustrated' | 'win' | 'skipped' | 'hit' | 'throw' | '' = '';
  emoteT = 0;
  voice = 0;
  lookAt = new Vector3(0, TABLE_Y, 0);
  phase = Math.random() * 10;
  slot = 1;
  constructor() {
    this.root.add(this.head, this.plate.mesh);
  }
  react(kind: Base['emote'], seconds = 2.2): void {
    this.emote = kind;
    this.emoteT = seconds;
  }
  abstract update(dt: number, t: number, viewer: Vector3): void;
  /** Head position in table space (for sound, pranks and effects). */
  headWorld(out: Vector3): Vector3 {
    return this.head.getWorldPosition(out);
  }
}

export class HumanAvatar extends Base {
  private torso: Mesh;
  private neck: Mesh;
  private arms: Mesh[] = [];
  private hands: Group[] = [];
  private fingers: Mesh[][] = [[], []];
  private faceMesh: Mesh;
  private faceCanvas = document.createElement('canvas');
  private faceTex: CanvasTexture;
  private faceKey = '';
  private hairGroup = new Group();
  private skinMat: MeshStandardMaterial;
  private hairMat: MeshStandardMaterial;
  private clothMat: MeshStandardMaterial;
  private stripeMat = new MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.8, emissive: 0x2a1000 });
  private pose: PoseMsg | null = null;
  private poseAge = 99;
  private headPos = HEAD_REST.clone();
  private headQ = new Quaternion();
  private wrist = [new Vector3(), new Vector3()];
  private wristQ = [new Quaternion(), new Quaternion()];
  private tips: Vector3[][] = [[], []];
  private chestV = new Vector3();
  private shoulderV = new Vector3();
  private elbowV = new Vector3();
  private emoteHeadQ = new Quaternion();
  private eyes: Mesh[] = [];
  private blinkIn = 2.5 + Math.random() * 3;
  private blinkAge = -1;

  constructor() {
    super();
    this.skinMat = new MeshStandardMaterial({ color: SKIN[1], roughness: 0.62 });
    this.hairMat = new MeshStandardMaterial({ color: HAIR[0], roughness: 0.85 });
    this.clothMat = new MeshStandardMaterial({ color: OUTFIT[0], roughness: 0.92 });
    // The fallback also has an exposed face, rather than a hidden visor.
    const skull = new Mesh(new SphereGeometry(0.095, 28, 20), this.skinMat);
    skull.scale.set(0.92, 1.08, 1.0);
    const eyeWhite = new MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.38 });
    const irisMat = new MeshStandardMaterial({ color: 0x3c5149, roughness: 0.34 });
    const pupilMat = new MeshStandardMaterial({ color: 0x0d1514, roughness: 0.25 });
    for (const side of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.02, 16, 10), eyeWhite);
      eye.name = 'Visible eye';
      eye.position.set(side * 0.034, 0.014, -0.087);
      eye.scale.set(0.9, 0.5, 0.43);
      const iris = new Mesh(new SphereGeometry(0.008, 12, 8), irisMat);
      iris.position.set(side * 0.034, 0.014, -0.095);
      iris.scale.z = 0.24;
      const pupil = new Mesh(new SphereGeometry(0.0035, 10, 6), pupilMat);
      pupil.position.set(side * 0.034, 0.014, -0.097);
      pupil.scale.z = 0.25;
      const brow = new Mesh(new CapsuleGeometry(0.002, 0.028, 3, 6), this.hairMat);
      brow.position.set(side * 0.034, 0.035, -0.087);
      brow.rotation.z = Math.PI / 2 + side * 0.06;
      this.eyes.push(eye, iris, pupil);
      this.head.add(eye, iris, pupil, brow);
    }
    // the lower face: a decal on the skull so the mouth can smile, talk, laugh and grimace
    this.faceCanvas.width = 256;
    this.faceCanvas.height = 128;
    this.faceTex = new CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = SRGBColorSpace;
    this.faceMesh = new Mesh(
      new SphereGeometry(0.0962, 24, 10, -Math.PI / 2 - 0.75, 1.5, Math.PI / 2 + 0.05, 0.62),
      new MeshBasicMaterial({ map: this.faceTex, transparent: true, depthWrite: false }),
    );
    this.faceMesh.scale.copy(skull.scale);
    this.faceMesh.renderOrder = 2;
    const nose = new Mesh(new SphereGeometry(0.013, 12, 8), this.skinMat);
    nose.position.set(0, -0.026, -0.098);
    nose.scale.set(0.9, 1.1, 1);
    for (const sx of [-1, 1]) {
      const ear = new Mesh(new SphereGeometry(0.018, 10, 8), this.skinMat);
      ear.scale.set(0.45, 1, 0.75);
      ear.position.set(sx * 0.087, -0.008, 0.004);
      this.head.add(ear);
    }
    this.head.add(skull, this.hairGroup, this.faceMesh, nose);
    this.buildHair(0);
    // neck and torso (a hoodie with a soft shoulder line)
    this.neck = new Mesh(new CapsuleGeometry(0.042, 0.06, 4, 12), this.skinMat);
    const prof = [
      [0.0, -0.42],
      [0.15, -0.42],
      [0.17, -0.25],
      [0.19, -0.06],
      [0.2, 0.0],
      [0.13, 0.05],
      [0.06, 0.07],
      [0.0, 0.07],
    ].map(([x, y]) => new Vector2(x, y));
    this.torso = new Mesh(new LatheGeometry(prof, 24), this.clothMat);
    this.torso.scale.set(1.12, 1, 0.68);
    // hood folded behind the neck, drawstrings and a contrast stripe, like a real hoodie
    const hood = new Mesh(new TorusGeometry(0.075, 0.03, 10, 24, Math.PI * 1.3), this.clothMat);
    hood.rotation.set(Math.PI / 2 + 0.25, 0, Math.PI * 0.85);
    hood.position.set(0, 0.06, 0.02);
    hood.scale.set(1.25, 1, 1);
    this.torso.add(hood);
    const cord = new MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const string = new Mesh(new CylinderGeometry(0.003, 0.003, 0.12, 6), cord);
      string.position.set(sx * 0.03, -0.01, -0.13);
      string.rotation.x = 0.12;
      this.torso.add(string);
      const stripe = new Mesh(new CylinderGeometry(0.2015, 0.191, 0.02, 32, 1, true, sx > 0 ? -0.55 : Math.PI - 0.15, 0.7), this.stripeMat);
      stripe.position.y = -0.1;
      this.torso.add(stripe);
    }
    this.root.add(this.neck, this.torso);
    const unit = new CapsuleGeometry(1, 1, 4, 10);
    unit.translate(0, 0, 0);
    // capsules are scaled per frame; a unit-length body with radius 1
    const armGeo = new CapsuleGeometry(1, 1, 4, 10);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(armGeo, this.clothMat);
      this.arms.push(m);
      this.root.add(m);
    }
    const fingerGeo = new CapsuleGeometry(1, 1, 3, 6);
    for (let s = 0; s < 2; s++) {
      const h = new Group();
      const palm = new Mesh(new SphereGeometry(0.04, 14, 10), this.skinMat);
      palm.scale.set(0.95, 0.42, 1.15);
      h.add(palm);
      this.hands.push(h);
      this.root.add(h);
      for (let f = 0; f < 5; f++) {
        const m = new Mesh(fingerGeo, this.skinMat);
        this.fingers[s].push(m);
        this.root.add(m);
        this.tips[s].push(new Vector3());
      }
    }
    this.root.traverse((o) => {
      (o as Mesh).raycast = () => {};
      (o as Mesh).castShadow = true;
    });
    this.plate.mesh.castShadow = false;
  }

  setLook(look: number[]): void {
    this.skinMat.color.setHex(SKIN[(look[0] ?? 1) % SKIN.length]);
    this.hairMat.color.setHex(HAIR[(look[1] ?? 0) % HAIR.length]);
    this.clothMat.color.setHex(OUTFIT[(look[2] ?? 0) % OUTFIT.length]);
    this.stripeMat.color.setHex(STRIPE[(look[2] ?? 0) % STRIPE.length]);
    this.buildHair((look[3] ?? 0) % HAIR_STYLES);
    this.faceKey = '';
  }

  private hairStyle = -1;

  /** 0 short crop, 1 curls, 2 long with a bun, 3 buzz cut. */
  private buildHair(style: number): void {
    if (style === this.hairStyle) return;
    this.hairStyle = style;
    this.hairGroup.clear();
    const m = this.hairMat;
    const cap = (cover: number, scale = 1.06) => {
      const h = new Mesh(new SphereGeometry(0.1, 28, 16, 0, Math.PI * 2, 0, Math.PI * cover), m);
      h.position.set(0, 0.012, 0.01);
      h.scale.set(0.97 * scale, 1.05 * scale, 1.06 * scale);
      return h;
    };
    if (style === 3) {
      this.hairGroup.add(cap(0.5, 1.0));
      return;
    }
    this.hairGroup.add(cap(0.56));
    if (style === 1) {
      // a crown of curls
      const curl = new SphereGeometry(0.03, 10, 8);
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const ring = i % 2 ? 0.075 : 0.05;
        const c = new Mesh(curl, m);
        c.position.set(Math.cos(a) * ring, 0.085 + (i % 3) * 0.008, Math.sin(a) * ring + 0.012);
        c.scale.setScalar(0.85 + (i % 4) * 0.08);
        this.hairGroup.add(c);
      }
    } else if (style === 2) {
      const back = new Mesh(new CapsuleGeometry(0.075, 0.1, 6, 14), m);
      back.position.set(0, -0.045, 0.045);
      back.scale.set(1.15, 1, 0.6);
      const bun = new Mesh(new SphereGeometry(0.035, 14, 10), m);
      bun.position.set(0, 0.075, 0.085);
      this.hairGroup.add(back, bun);
    } else {
      // a short quiff at the front
      const quiff = new Mesh(new SphereGeometry(0.05, 14, 10), m);
      quiff.position.set(0, 0.085, -0.035);
      quiff.scale.set(1.5, 0.55, 1);
      this.hairGroup.add(quiff);
    }
    this.hairGroup.traverse((o) => ((o as Mesh).raycast = () => {}));
  }

  /** Mouth and cheeks for a mood ('', 'talk1..3', 'laugh', 'frown', 'o'), drawn only when it changes. */
  private drawFace(mood: string): void {
    if (mood === this.faceKey) return;
    this.faceKey = mood;
    const c = this.faceCanvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 128);
    // gentle cheek colour
    c.fillStyle = 'rgba(220,90,90,0.16)';
    for (const x of [64, 192]) {
      c.beginPath();
      c.ellipse(x, 30, 22, 12, 0, 0, Math.PI * 2);
      c.fill();
    }
    const lip = '#7a2f33';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const mx = 128;
    const my = 74;
    if (mood === 'laugh' || mood.startsWith('talk')) {
      const open = mood === 'laugh' ? 26 : mood === 'talk3' ? 18 : mood === 'talk2' ? 12 : 6;
      const w = mood === 'laugh' ? 34 : 22;
      c.fillStyle = '#3a1418';
      c.beginPath();
      c.moveTo(mx - w, my - 4);
      c.quadraticCurveTo(mx, my - 8, mx + w, my - 4);
      c.quadraticCurveTo(mx + w * 0.8, my + open, mx, my + open + 4);
      c.quadraticCurveTo(mx - w * 0.8, my + open, mx - w, my - 4);
      c.fill();
      if (mood === 'laugh') {
        c.fillStyle = '#f7f3ee';
        c.fillRect(mx - 22, my - 5, 44, 7);
        c.fillStyle = '#d4545e';
        c.beginPath();
        c.ellipse(mx, my + open - 4, 14, 6, 0, 0, Math.PI * 2);
        c.fill();
      }
    } else if (mood === 'frown') {
      c.strokeStyle = lip;
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(mx - 22, my + 8);
      c.quadraticCurveTo(mx, my - 8, mx + 22, my + 8);
      c.stroke();
    } else if (mood === 'o') {
      c.fillStyle = '#3a1418';
      c.beginPath();
      c.ellipse(mx, my + 4, 10, 14, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      c.strokeStyle = lip;
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(mx - 24, my - 4);
      c.quadraticCurveTo(mx, my + 12, mx + 24, my - 4);
      c.stroke();
    }
    this.faceTex.needsUpdate = true;
  }

  setPose(p: PoseMsg): void {
    this.pose = p;
    this.poseAge = 0;
  }

  update(dt: number, t: number, viewer: Vector3): void {
    this.poseAge += dt;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkAge = 0;
      this.blinkIn = 3.1 + Math.random() * 3.7;
    }
    if (this.blinkAge >= 0) {
      this.blinkAge += dt;
      const openness = 1 - Math.sin(Math.min(1, this.blinkAge / 0.16) * Math.PI) * 0.96;
      for (let i = 0; i < this.eyes.length; i++) this.eyes[i].scale.y = (i % 3 === 0 ? 0.5 : 1) * openness;
      if (this.blinkAge >= 0.16) this.blinkAge = -1;
    }
    // poses arrive 12 times a second while someone moves and once a second while they sit still
    const live = this.pose && this.poseAge < 1.5 ? this.pose : null;
    if (this.emoteT > 0) this.emoteT -= dt;
    else this.emote = '';
    const k = 1 - Math.exp(-dt * 18);
    // head
    if (live && live.h.length === 7) {
      _v.set(live.h[0], live.h[1], live.h[2]);
      this.headPos.lerp(_v, k);
      _q.set(live.h[3], live.h[4], live.h[5], live.h[6]);
      this.headQ.slerp(_q, k);
    } else {
      // idle: breathe, glance at whoever is playing
      _v.copy(HEAD_REST);
      _v.y += Math.sin(t * 1.3 + this.phase) * 0.006;
      this.headPos.lerp(_v, 1 - Math.exp(-dt * 4));
      this.headLookAt(this.lookAt, dt);
    }
    this.head.position.copy(this.headPos);
    this.head.quaternion.copy(this.headQ);
    this.applyEmoteHead(t);
    // mouth follows voice
    this.voice = live ? damp(this.voice, live.v ?? 0, 20, dt) : damp(this.voice, 0, 8, dt);
    const e = this.emote;
    const talk = this.voice > 0.05 ? (this.voice > 0.35 ? 'talk3' : this.voice > 0.18 ? 'talk2' : 'talk1') : '';
    this.drawFace(
      e === 'laugh' || e === 'cheer' || e === 'win'
        ? 'laugh'
        : e === 'frustrated' || e === 'angry' || e === 'facepalm'
          ? 'frown'
          : e === 'hit' || e === 'skipped'
            ? 'o'
            : talk,
    );
    // body follows the head (a seated torso leans toward where the head goes)
    // (own vectors: solveElbow uses the shared scratch vectors)
    const chest = this.chestV.set(this.headPos.x * 0.55, this.headPos.y - 0.27, lerp(1.06, this.headPos.z, 0.5));
    this.neck.position.copy(this.headPos).lerp(chest, 0.45);
    this.neck.position.y -= 0.06;
    this.torso.position.copy(chest);
    this.torso.position.y -= 0.0;
    this.torso.rotation.set((this.headPos.z - 0.98) * -1.2 + 0.05, this.headYaw() * 0.35, 0);
    // hands: tracked joints, or a resting/emote pose
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const data = live ? (s === 0 ? live.l : live.r) : null;
      if (data && data.length === 22 && !this.emote) {
        this.wrist[s].lerp(_v.set(data[0], data[1], data[2]), k);
        this.wristQ[s].slerp(_q.set(data[3], data[4], data[5], data[6]), k);
        for (let f = 0; f < 5; f++) this.tips[s][f].lerp(_v.set(data[7 + f * 3], data[8 + f * 3], data[9 + f * 3]), k);
      } else {
        this.proceduralHand(s, side, t, dt);
      }
      // arm IK from shoulder to wrist
      const shoulder = this.shoulderV.copy(chest).add(_v3.set(side * SHOULDER_HALF, 0.02, -0.01));
      const elbow = solveElbow(shoulder, this.wrist[s], side, this.elbowV);
      limb(this.arms[s * 2], shoulder, elbow, 0.045);
      limb(this.arms[s * 2 + 1], elbow, this.wrist[s], 0.037);
      this.hands[s].position.copy(this.wrist[s]);
      this.hands[s].quaternion.copy(this.wristQ[s]);
      // fingers from the knuckle line to each tip
      for (let f = 0; f < 5; f++) {
        const knuckle = new Vector3((f - 2) * 0.017 * -side, 0, -0.045).applyQuaternion(this.wristQ[s]).add(this.wrist[s]);
        if (f === 0) knuckle.copy(new Vector3(side * -0.03, 0, -0.015).applyQuaternion(this.wristQ[s]).add(this.wrist[s]));
        limb(this.fingers[s][f], knuckle, this.tips[s][f], f === 0 ? 0.0105 : 0.009);
      }
    }
    this.placePlate(viewer);
  }

  private headYaw(): number {
    _v.set(0, 0, -1).applyQuaternion(this.headQ);
    return Math.atan2(-_v.x, -_v.z);
  }

  private headLookAt(target: Vector3, dt: number): void {
    // seat space: the avatar faces -Z toward the table centre
    const local = this.root.worldToLocal(tableToWorld(_v.copy(target)));
    const dir = local.sub(this.headPos).normalize();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    _q.setFromEuler(_eul.set(clamp(pitch, -0.6, 0.4), clamp(yaw, -1.0, 1.0), 0, 'YXZ'));
    this.headQ.slerp(_q, 1 - Math.exp(-dt * 3));
  }

  private applyEmoteHead(t: number): void {
    const e = this.emote;
    if (!e) return;
    const s = clamp(this.emoteT, 0, 1);
    const extra = this.emoteHeadQ.identity();
    if (e === 'laugh' || e === 'win') extra.setFromEuler(_eul.set((0.16 + Math.sin(t * 7) * 0.035) * s, 0, 0));
    else if (e === 'frustrated' || e === 'facepalm') extra.setFromEuler(_eul.set(-0.22 * s, 0, 0));
    else if (e === 'angry') extra.setFromEuler(_eul.set(0, Math.sin(t * 6) * 0.07 * s, 0));
    else if (e === 'skipped') extra.setFromEuler(_eul.set(0, 0, Math.sin(t * 5) * 0.08 * s));
    else if (e === 'hit') extra.setFromEuler(_eul.set(0.22 * Math.max(0, this.emoteT - 1.4), 0, 0));
    // Apply to this frame's visible head, never feed a reaction rotation back
    // into the tracked/resting quaternion on every frame.
    this.head.quaternion.multiply(extra);
  }

  private proceduralHand(s: number, side: number, t: number, dt: number): void {
    const e = this.emote;
    const target = new Vector3();
    const q = new Quaternion();
    const h = this.headPos;
    switch (e) {
      case 'clap': {
        const c = Math.abs(Math.sin(t * 11));
        target.set(side * (0.02 + c * 0.07), h.y - 0.22, h.z - 0.3);
        q.setFromAxisAngle(new Vector3(0, 0, 1), -side * 1.4);
        break;
      }
      case 'cheer':
      case 'win':
        target.set(side * 0.24, h.y + 0.25 + Math.sin(t * 9 + s) * 0.04, h.z - 0.05);
        q.setFromAxisAngle(new Vector3(1, 0, 0), -1.4);
        break;
      case 'frustrated':
        // hands on the head
        target.set(side * 0.1, h.y + 0.1, h.z + 0.02);
        q.setFromAxisAngle(new Vector3(0, 0, 1), -side * 1.8);
        break;
      case 'facepalm':
        if (s === 1) target.set(0.02, h.y - 0.02, h.z - 0.12);
        else target.set(-0.2, TABLE_Y + 0.08, h.z - 0.38);
        q.setFromAxisAngle(new Vector3(1, 0, 0), s === 1 ? -1.4 : 0);
        break;
      case 'point':
        if (s === 1) target.set(0.08, h.y - 0.12, h.z - 0.5);
        else target.set(-0.2, TABLE_Y + 0.08, h.z - 0.38);
        break;
      case 'angry':
        target.set(side * 0.16, h.y - 0.18 + Math.abs(Math.sin(t * 16 + s * 2)) * 0.06, h.z - 0.3);
        break;
      default: {
        // holding their cards in front of them, a little idle motion
        target.set(side * 0.085, TABLE_Y + 0.13 + Math.sin(t * 1.1 + s + this.phase) * 0.008, 0.8);
        q.setFromAxisAngle(new Vector3(1, 0, 0), -0.9);
      }
    }
    this.wrist[s].lerp(target, 1 - Math.exp(-dt * 8));
    this.wristQ[s].slerp(q, 1 - Math.exp(-dt * 8));
    // a loose, relaxed curl (a point straightens the index finger)
    for (let f = 0; f < 5; f++) {
      const straight = e === 'point' && s === 1 && f === 1;
      const tip = new Vector3((f - 2) * 0.018 * -side, straight ? 0 : -0.02, straight ? -0.13 : -0.085);
      if (f === 0) tip.set(side * -0.055, -0.01, -0.05);
      this.tips[s][f].copy(tip.applyQuaternion(this.wristQ[s]).add(this.wrist[s]));
    }
  }

  private placePlate(viewer: Vector3): void {
    this.plate.mesh.position.copy(this.headPos).add(_v.set(0, 0.24, 0));
    faceNameplate(this.plate, this.root, viewer);
  }
}

/** The robot opponent from the art direction: glossy white shell, screen face, blue eyes. */
export class RobotAvatar extends Base {
  private eyes: Mesh;
  private faceTex: CanvasTexture;
  private face = document.createElement('canvas');
  private body: Group = new Group();
  private armL = new Group();
  private armR = new Group();
  private tint: Color;
  private faceKey = '';
  private blink = 0;
  private blinkAt = 2;

  /**
   * A friendly table robot (the computer players): glossy white helmet, a
   * black glass visor with glowing eyes, headphone-style ear pods and a small
   * body holding its cards. Sized like a seated person.
   */
  constructor(tint: number) {
    super();
    this.tint = new Color(tint);
    const shell = new MeshStandardMaterial({ color: 0xf2f3f7, roughness: 0.18, metalness: 0.0 });
    const soft = new MeshStandardMaterial({ color: 0xd9dbe3, roughness: 0.45, metalness: 0.0 });
    const glass = new MeshStandardMaterial({ color: 0x05060b, roughness: 0.06, metalness: 0.6 });
    const accent = new MeshBasicMaterial({ color: tint, toneMapped: false });
    // helmet and visor
    const R = 0.118;
    const helmet = new Mesh(new SphereGeometry(R, 40, 28), shell);
    helmet.scale.set(1.12, 0.94, 1.0);
    // a cap of the sphere facing -Z (towards the table)
    const visor = new Mesh(new SphereGeometry(R * 1.012, 40, 20, -Math.PI / 2 - 0.62, 1.24, Math.PI / 2 - 0.5, 0.98), glass);
    visor.scale.copy(helmet.scale);
    this.face.width = 256;
    this.face.height = 128;
    this.faceTex = new CanvasTexture(this.face);
    this.faceTex.colorSpace = SRGBColorSpace;
    this.eyes = new Mesh(
      new PlaneGeometry(0.15, 0.075),
      new MeshBasicMaterial({ map: this.faceTex, transparent: true, depthWrite: false, toneMapped: false, blending: AdditiveBlending }),
    );
    // just in front of the visor glass
    this.eyes.position.set(0, -0.004, -R * 1.02 - 0.002);
    this.eyes.rotation.y = Math.PI;
    for (const sx of [-1, 1]) {
      const pod = new Mesh(new CylinderGeometry(0.046, 0.046, 0.034, 32), shell);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(sx * 0.128, -0.004, 0.004);
      const cap = new Mesh(new CylinderGeometry(0.034, 0.034, 0.006, 32), soft);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(sx * 0.147, -0.004, 0.004);
      const ring = new Mesh(new TorusGeometry(0.036, 0.0035, 8, 40), accent);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * 0.149, -0.004, 0.004);
      this.head.add(pod, cap, ring);
    }
    const antenna = new Mesh(new CylinderGeometry(0.003, 0.004, 0.05, 8), soft);
    antenna.position.set(0.05, 0.13, 0.01);
    antenna.rotation.z = -0.25;
    const bulb = new Mesh(new SphereGeometry(0.009, 12, 8), accent);
    bulb.position.set(0.058, 0.155, 0.01);
    this.head.add(helmet, visor, this.eyes, antenna, bulb);
    // body: a rounded torso with a glowing chest light, short arms holding the cards
    const torso = new Mesh(new SphereGeometry(0.115, 32, 24), shell);
    torso.scale.set(1.0, 1.08, 0.82);
    const collar = new Mesh(new CylinderGeometry(0.045, 0.06, 0.04, 24), soft);
    collar.position.y = 0.125;
    const chest = new Mesh(new CircleGeometry(0.03, 32), glass);
    chest.position.set(0, 0.025, -0.093);
    chest.rotation.y = Math.PI;
    const chestLight = new Mesh(new TorusGeometry(0.02, 0.004, 8, 32), accent);
    chestLight.position.set(0, 0.025, -0.095);
    this.body.add(torso, collar, chest, chestLight);
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      const shoulder = new Mesh(new SphereGeometry(0.034, 16, 12), shell);
      const upper = new Mesh(new CapsuleGeometry(0.026, 0.09, 4, 12), shell);
      upper.position.y = -0.06;
      const hand = new Mesh(new SphereGeometry(0.03, 16, 12), soft);
      hand.position.y = -0.125;
      arm.add(shoulder, upper, hand);
      arm.position.set(sx * 0.118, 0.06, -0.01);
      this.body.add(arm);
    }
    this.root.add(this.body);
    this.root.traverse((o) => {
      (o as Mesh).raycast = () => {};
      (o as Mesh).castShadow = true;
    });
    this.eyes.castShadow = false;
    this.plate.mesh.castShadow = false;
    // 21 primitives were 21 draw calls for a hand-sized robot. Each part that moves on its own
    // (head, body, either arm) becomes one painted mesh, plus its glowing trim: 7 draws.
    const arm = (o: Object3D) => o === this.armL || o === this.armR;
    mergeStatic(this.head, { paint: true });
    mergeStatic(this.body, { paint: true, stop: arm });
    mergeStatic(this.armL, { paint: true });
    mergeStatic(this.armR, { paint: true });
  }

  private drawFace(mood: string): void {
    if (mood === this.faceKey) return;
    this.faceKey = mood;
    const c = this.face.getContext('2d')!;
    c.clearRect(0, 0, 256, 128);
    const col = `#${this.tint.getHexString()}`;
    c.fillStyle = col;
    c.strokeStyle = col;
    c.shadowColor = col;
    c.shadowBlur = 18;
    c.lineWidth = 12;
    c.lineCap = 'round';
    for (const x of [78, 178]) {
      c.beginPath();
      if (mood === 'happy') c.arc(x, 74, 24, Math.PI * 1.1, Math.PI * 1.9);
      else if (mood === 'sad') c.arc(x, 50, 24, Math.PI * 0.15, Math.PI * 0.85);
      else if (mood === 'x') {
        c.moveTo(x - 18, 46);
        c.lineTo(x + 18, 82);
        c.moveTo(x + 18, 46);
        c.lineTo(x - 18, 82);
      } else if (mood === 'blink') {
        c.moveTo(x - 20, 64);
        c.lineTo(x + 20, 64);
      } else if (mood === 'angry') {
        c.moveTo(x - 22, x < 128 ? 44 : 58);
        c.lineTo(x + 22, x < 128 ? 58 : 44);
        c.stroke();
        c.beginPath();
        c.ellipse(x, 76, 14, 16, 0, 0, Math.PI * 2);
        c.fill();
        continue;
      } else {
        c.ellipse(x, 64, 18, 24, 0, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      c.stroke();
    }
    this.faceTex.needsUpdate = true;
  }

  update(dt: number, t: number, viewer: Vector3): void {
    if (this.emoteT > 0) this.emoteT -= dt;
    else this.emote = '';
    const e = this.emote;
    // hover-bob, sway, and a hop when happy
    const hop = e === 'win' || e === 'cheer' || e === 'laugh' ? Math.abs(Math.sin(t * 8)) * 0.05 : 0;
    const shake = e === 'frustrated' || e === 'hit' ? Math.sin(t * 30) * 0.012 : 0;
    this.body.position.set(shake, 0.84 + Math.sin(t * 1.6 + this.phase) * 0.006 + hop, 1.0);
    this.head.position.set(shake, 1.1 + Math.sin(t * 1.6 + this.phase + 0.4) * 0.008 + hop, 0.98);
    // head looks at the action
    const local = this.root.worldToLocal(tableToWorld(_v.copy(this.lookAt))).sub(this.head.position).normalize();
    const yaw = clamp(Math.atan2(-local.x, -local.z), -0.9, 0.9);
    const pitch = clamp(Math.asin(clamp(local.y, -1, 1)), -0.5, 0.3);
    const tilt = e === 'laugh' ? Math.sin(t * 12) * 0.15 : e === 'skipped' ? Math.sin(t * 7) * 0.25 : 0;
    this.head.rotation.set(pitch, yaw, tilt, 'YXZ');
    // arms: holding cards in front of the chest; up for a win, flailing when annoyed
    const up = e === 'win' || e === 'cheer' ? 1 : 0;
    const flail = e === 'frustrated' || e === 'angry' ? Math.sin(t * 18) * 0.5 : 0;
    const clap = e === 'clap' ? Math.abs(Math.sin(t * 11)) : 0;
    const point = e === 'point' || e === 'laugh' ? 1 : 0;
    this.armL.rotation.set(-1.15 - up * 1.7 + flail, 0, -0.25 - up * 0.3 + clap * 0.8);
    this.armR.rotation.set(-1.15 - up * 1.7 - flail - point * 0.35, 0, 0.25 + up * 0.3 - clap * 0.8);
    // face
    this.blinkAt -= dt;
    if (this.blinkAt < 0) {
      this.blink = 0.12;
      this.blinkAt = 2.5 + Math.random() * 3;
    }
    this.blink -= dt;
    const mood =
      e === 'win' || e === 'laugh' || e === 'cheer' || e === 'cool'
        ? 'happy'
        : e === 'frustrated' || e === 'cry'
          ? 'sad'
          : e === 'hit' || e === 'skipped'
            ? 'x'
            : e === 'angry'
              ? 'angry'
              : this.blink > 0
                ? 'blink'
                : 'open';
    this.drawFace(mood);
    this.plate.mesh.position.set(0, 1.33, 0.98);
    faceNameplate(this.plate, this.root, viewer);
  }
}

/** All avatars, keyed by table seat. */
/** A real, photo-scanned person (see people.ts) driven by the game and by tracking. */
export class PersonAvatar extends Base {
  readonly rig: SeatedRig;
  private pose: PoseMsg | null = null;
  private poseAge = 9;
  private moodAge = 0;
  private lastMood = '';
  private frame: RigFrame = newRigFrame();
  /** Is it this person's turn? (They study their cards.) */
  myTurn = false;
  /** Ambient gestures can be reduced without delaying tracked or card-play poses. */
  motionScale = 1;
  /** First person only: where your own fan floats (seat space). */
  ownFan: FanPose | null = null;

  /** A reaction icon that pops above the head, so everyone can read an emote at a glance. */
  private badge = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
  private badgeKind = '';

  constructor(rig: SeatedRig) {
    super();
    this.rig = rig;
    this.root.add(rig.holder);
    this.badge.visible = false;
    this.badge.renderOrder = 6;
    this.root.add(this.badge);
  }

  get person(): number {
    return this.rig.index;
  }

  setPose(p: PoseMsg): void {
    this.pose = p;
    this.poseAge = 0;
  }

  /** A card this person's free hand is playing or drawing (world space), and how much the hand is on it. */
  setReach(at: Vector3 | null, weight: number): void {
    if (at) this.frame.reach.copy(at);
    this.frame.reachW = at ? weight : 0;
  }

  update(dt: number, t: number, viewer: Vector3): void {
    this.poseAge += dt;
    // poses arrive 12 times a second while someone moves and once a second while they sit still
    const live = this.pose && this.poseAge < 1.5 ? this.pose : null;
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      if (this.emoteT <= 0) this.emote = '';
    }
    if (this.emote !== this.lastMood) {
      this.lastMood = this.emote;
      this.moodAge = 0;
    }
    this.moodAge += dt;
    const f = this.frame;
    f.t = t;
    f.dt = dt;
    f.phase = this.phase;
    f.mood = this.emote as Mood;
    // reactions ease in over a quarter second and out over half a second
    f.moodT = Math.min(this.emoteT, this.moodAge * 2);
    f.voice = this.voice;
    // lookAt is in table space; the rig works in world space
    f.look.copy(this.lookAt);
    this.root.parent?.localToWorld(f.look);
    f.tracked = live;
    f.myTurn = this.myTurn;
    f.motionScale = this.motionScale;
    f.ownFan = this.ownFan;
    this.rig.update(this.root, f);
    this.head.position.copy(this.rig.headPos);
    this.plate.mesh.position.set(this.rig.headPos.x, this.rig.headPos.y + 0.225, this.rig.headPos.z);
    // the badge pops in, bobs, and fades with the reaction
    const icon = EMOTE_ICONS[this.emote] ?? '';
    if (icon && this.emoteT > 0) {
      if (this.badgeKind !== this.emote) {
        this.badgeKind = this.emote;
        this.badge.material.map = emoteTexture(icon);
        this.badge.material.needsUpdate = true;
      }
      const age = this.moodAge;
      const pop = age < 0.25 ? 0.6 + 0.4 * Math.sin((age / 0.25) * Math.PI * 0.5) * 1.15 : 1;
      const s = 0.15 * pop * Math.min(1, this.emoteT * 2);
      this.badge.scale.set(s, s, s);
      this.badge.position.set(this.rig.headPos.x, this.rig.headPos.y + 0.36 + Math.sin(t * 3) * 0.012, this.rig.headPos.z);
      this.badge.visible = true;
    } else this.badge.visible = false;
    faceNameplate(this.plate, this.root, viewer);
  }
}

/** Icons for player emotes and the game's own reactions. */
const EMOTE_ICONS: Record<string, string> = {
  laugh: '😂', clap: '👏', point: '👉', facepalm: '🤦', cheer: '🎉', angry: '😠', cool: '😎', cry: '😢',
  frustrated: '😖', hit: '💥', skipped: '🚫', win: '🏆',
};
const emoteTextures = new Map<string, CanvasTexture>();
/** A round badge with the icon in it (drawn once per icon). */
function emoteTexture(icon: string): CanvasTexture {
  let tex = emoteTextures.get(icon);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fillStyle = 'rgba(20,24,40,0.82)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,226,166,0.95)';
  g.stroke();
  g.font = '72px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(icon, 64, 70);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  emoteTextures.set(icon, tex);
  return tex;
}

type Avatar = HumanAvatar | RobotAvatar | PersonAvatar;

/** Which scanned person a seat shows: computer players are named after theirs; people pick one. */
export function personFor(s: SeatInfo): number {
  const byName = PEOPLE.indexOf(s.name.replace(/ \(bot\)$/, '') as (typeof PEOPLE)[number]);
  if (byName >= 0) return byName;
  return Math.abs(Math.round(s.look[0] ?? 0)) % castSize();
}

export class Cast {
  readonly group = new Group();
  private bySeat = new Map<number, Avatar>();
  private reducedMotion = false;
  slotOfSeat: (seat: number) => number = (s) => s;

  /** Create, replace or remove avatars to match the seats. `mySeat` is never drawn. */
  sync(seats: (SeatInfo | null)[], mySeat: number): void {
    for (let seat = 0; seat < 4; seat++) {
      const s = seats[seat];
      const cur = this.bySeat.get(seat);
      if (!s || seat === mySeat) {
        if (cur) {
          cur.root.removeFromParent();
          this.bySeat.delete(seat);
        }
        continue;
      }
      if (peopleReady()) {
        // everyone at the table is a real person; computer players too
        const want = personFor(s);
        if (!(cur instanceof PersonAvatar) || cur.person !== want) {
          const rig = createPersonRig(want);
          if (rig) {
            cur?.root.removeFromParent();
            const av = new PersonAvatar(rig);
            this.bySeat.set(seat, av);
            this.group.add(av.root);
          }
        }
      } else {
        const wantRobot = s.ai || s.autopilot;
        const isRobot = cur instanceof RobotAvatar;
        if (!cur || cur instanceof PersonAvatar || isRobot !== wantRobot) {
          cur?.root.removeFromParent();
          const av = wantRobot ? new RobotAvatar(ROBOT_TINT[seat % 4]) : new HumanAvatar();
          this.bySeat.set(seat, av);
          this.group.add(av.root);
        }
      }
      const av = this.bySeat.get(seat)!;
      if (av instanceof PersonAvatar) av.motionScale = this.reducedMotion ? 0 : 1;
      if (av instanceof HumanAvatar) av.setLook(s.look);
      av.slot = this.slotOfSeat(seat);
      av.root.rotation.y = seatAngle(av.slot);
    }
  }

  get(seat: number): Avatar | undefined {
    return this.bySeat.get(seat);
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    for (const av of this.bySeat.values()) if (av instanceof PersonAvatar) av.motionScale = on ? 0 : 1;
  }

  all(): [number, Avatar][] {
    return [...this.bySeat.entries()];
  }

  pose(p: PoseMsg): void {
    const av = this.bySeat.get(p.seat);
    if (av instanceof HumanAvatar || av instanceof PersonAvatar) av.setPose(p);
  }

  plates(states: Map<number, AvatarState>): void {
    for (const [seat, av] of this.bySeat) {
      const st = states.get(seat);
      if (!st) continue;
      // in Frostpeak a computer player is introduced by the hero it plays
      const name = useHeroes() && st.info.ai ? heroTitle(personFor(st.info)) : st.info.name;
      av.plate.mesh.visible = true; // menu heroes sit without nameplates until a real game
      if (av instanceof PersonAvatar && 'holding' in av.rig) av.rig.holding = true;
      av.plate.draw(name, st.count, st.turn, av.voice, st.info.ai || st.info.autopilot, st.info.connected, st.crown);
    }
  }

  update(dt: number, t: number, viewer: Vector3, lookAt: Vector3): void {
    for (const av of this.bySeat.values()) {
      av.lookAt.copy(lookAt);
      av.update(dt, t, viewer);
    }
  }

  clear(): void {
    for (const av of this.bySeat.values()) av.root.removeFromParent();
    this.bySeat.clear();
  }
}

export type AnyAvatar = Avatar;
export { Object3D };
