/**
 * The Anime Arenas: three cel-shaded worlds around the same table.
 *
 * - Wisteria Shrine: a moonlit shrine terrace under hanging wisteria, a waterfall across the lake,
 *   paper lanterns, fireflies and falling petals.
 * - Midnight Domain: a rain-soaked rooftop in a neon city, a vast summoning circle turning in the sky.
 * - Celestial Arena: a marble terrace above a sea of clouds, floating islands, golden lightning.
 *
 * Same surface as Frostpeak (root, chairs, decor, key, glow, mood, mixed reality), so rules, cards,
 * input and networking are untouched. Everything is generated in code: nothing to download.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import {
  NOISE_GLSL,
  bannerTexture,
  disposeTree,
  floorTexture,
  magicCircleTexture,
  metal,
  neonTexture,
  pondMaterial,
  seeded,
  shojiTexture,
  skyMaterial,
  tableTopTexture,
  toon,
  waterfallMaterial,
  weather,
} from './arena-kit.js';
import type { SkyLook } from './arena-kit.js';
import { SEAT_R, TABLE_R, TABLE_Y, seatAngle } from './env.js';
import { inert, makeNoise, merge, tint } from './frostpeak.js';
import { keep } from './util.js';

export type ArenaName = 'shrine' | 'domain' | 'celestial';

export const ARENA_TITLES: Record<ArenaName, string> = {
  shrine: 'Wisteria Shrine',
  domain: 'Midnight Domain',
  celestial: 'Celestial Arena',
};

const noise = makeNoise(31);

const C = (hex: string) => new Color(hex);

// ---------------------------------------------------------------- small geometry helpers
function box(w: number, h: number, d: number, x: number, y: number, z: number, col: string, ry = 0): BufferGeometry {
  const b = new BoxGeometry(w, h, d);
  if (ry) b.rotateY(ry);
  b.translate(x, y, z);
  return tint(b, C(col));
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, col: string, seg = 12): BufferGeometry {
  const c = new CylinderGeometry(rt, rb, h, seg);
  c.translate(x, y, z);
  return tint(c, C(col));
}
/** Paint a geometry's vertices by height between two colours (for rock, trunks, flowers). */
function gradientY(geo: BufferGeometry, y0: number, y1: number, a: string, b: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const data = new Float32Array(p.count * 3);
  const ca = C(a);
  const cb = C(b);
  const tmp = new Color();
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    tmp.copy(ca).lerp(cb, k).toArray(data, i * 3);
  }
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
}

/** A sweeping hip roof: falls from the ridge, and its corners curl up like a temple roof. */
function templeRoof(w: number, d: number, rise: number, lift: number, col: string, eave: string): BufferGeometry {
  const geo = new PlaneGeometry(w, d, 28, 14);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const u = Math.abs(x) / (w / 2);
    const v = Math.abs(z) / (d / 2);
    const t = Math.max(v, Math.max(0, (u - 0.55) / 0.45));
    // (rounding leaves t a hair over 1 along the front and back edges: a negative base there
    // made the whole edge row NaN, so the eaves were never drawn)
    const y = rise * Math.pow(Math.max(0, 1 - t), 1.6) + lift * (Math.pow(u, 6) * 0.5 + Math.pow(u * v, 2.5) + Math.pow(v, 8) * 0.25);
    p.setY(i, y);
  }
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const data = new Float32Array(pos.count * 3);
  const a = C(col);
  const b = C(eave);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const edge = Math.max(Math.abs(pos.getX(i)) / (w / 2), Math.abs(pos.getZ(i)) / (d / 2));
    tmp.copy(a).lerp(b, edge > 0.93 ? 1 : 0).toArray(data, i * 3);
  }
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
}

/** A ring of rock rising out of water: cliffs or far mountains around the arena. */
function cliffRing(r0: number, r1: number, base: number, height: number, seed: number, low: string, high: string, gap = 0): BufferGeometry {
  const segA = 160;
  const segR = 14;
  const pos: number[] = [];
  const col: number[] = [];
  const cl = C(low);
  const ch = C(high);
  const tmp = new Color();
  const at = (ia: number, ir: number): [number, number, number] => {
    const a = (ia / segA) * Math.PI * 2;
    const k = ir / segR;
    const r = r0 + (r1 - r0) * k;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const n = noise(x * 0.018 + seed, z * 0.018) * 0.5 + 0.5;
    const n2 = noise(x * 0.06 - seed, z * 0.06) * 0.5 + 0.5;
    // a ridge in the middle of the band; a gap ahead of the player keeps the view open
    const ridge = Math.sin(k * Math.PI);
    const open = gap > 0 ? Math.min(1, Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) / gap) : 1;
    const y = base + height * ridge * (0.45 + 0.55 * n) * (0.7 + 0.3 * n2) * (0.35 + 0.65 * open);
    return [x, y, z];
  };
  for (let ia = 0; ia < segA; ia++) {
    for (let ir = 0; ir < segR; ir++) {
      const a = at(ia, ir);
      const b = at(ia + 1, ir);
      const c = at(ia, ir + 1);
      const d = at(ia + 1, ir + 1);
      for (const v of [a, c, b, b, c, d]) {
        pos.push(...v);
        const k = Math.min(1, Math.max(0, (v[1] - base) / height));
        tmp.copy(cl).lerp(ch, Math.pow(k, 1.3)).toArray(col, col.length);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

/** A wisteria raceme: a tapering cluster of blossoms, deep violet at the stem to pale at the tip. */
function racemeGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  const N = 11;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = 0.075 * Math.pow(1 - t, 0.55) * (0.78 + 0.32 * Math.abs(Math.sin(t * 15))) + 0.006;
    pts.push(new Vector2(r, -t));
  }
  const lathe = new LatheGeometry(pts, 6);
  return gradientY(lathe, -1, 0, '#ffe6fb', '#8a5ae0');
}

/** A round paper lantern with ribs (lathe), lit from inside. */
function paperLanternGeometry(): BufferGeometry {
  const pts: Vector2[] = [new Vector2(0.001, -0.17), new Vector2(0.05, -0.17)];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new Vector2(0.05 + 0.1 * Math.sin(t * Math.PI), -0.16 + t * 0.32));
  }
  pts.push(new Vector2(0.05, 0.17), new Vector2(0.001, 0.17));
  return new LatheGeometry(pts, 12);
}

/** A stone lantern (toro): base, post, firebox, roof and finial. Its firebox glows separately. */
function stoneLanternGeometry(stone: string): BufferGeometry {
  const parts = [
    cyl(0.2, 0.24, 0.12, 0, 0.06, 0, stone, 6),
    cyl(0.08, 0.1, 0.62, 0, 0.43, 0, stone, 8),
    cyl(0.2, 0.16, 0.08, 0, 0.78, 0, stone, 6),
    cyl(0.04, 0.3, 0.16, 0, 1.12, 0, stone, 6),
    cyl(0.03, 0.05, 0.1, 0, 1.24, 0, stone, 6),
  ];
  // four corner posts of the firebox
  for (const [x, z] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) parts.push(box(0.04, 0.2, 0.04, x, 0.92, z, stone));
  return merge(parts);
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

interface ArenaLook {
  sky: SkyLook;
  fog: [string, number, number];
  hemi: [string, string, number];
  key: [string, number, Vector3];
  lamp: [string, number];
  table: [string, string, string];
  floor: [string, string, string];
  pouf: string;
}

const LOOKS: Record<ArenaName, ArenaLook> = {
  shrine: {
    sky: {
      top: '#0d0b2e', mid: '#2a2170', horizon: '#6a4aa8', below: '#120f30',
      stars: 1.1, nebula: 0.55, nebulaColor: '#8a5cff', clouds: 0.5, cloudColor: '#3d3277',
      moonDir: new Vector3(0.36, 0.4, -0.84), moonColor: '#fff4dc', moonSize: 0.075, moonGlow: 1,
      moon2Dir: new Vector3(0, 1, 0), moon2Color: '#000000', moon2Size: 0,
    },
    fog: ['#3a3070', 30, 420],
    hemi: ['#9d90ff', '#2a1f4e', 1.05],
    key: ['#d6dcff', 1.35, new Vector3(2.6, 5.4, -4.6)],
    lamp: ['#ffb46b', 2.8],
    table: ['#141633', '#6c6fb8', '#e6be6e'],
    floor: ['#2b2a46', '#151325', '#d9b25a'],
    pouf: '#6a35a8',
  },
  domain: {
    sky: {
      top: '#07061a', mid: '#1c1240', horizon: '#6a2a76', below: '#0c0818',
      stars: 0.25, nebula: 0.6, nebulaColor: '#7b3cff', clouds: 0.9, cloudColor: '#2f2352',
      moonDir: new Vector3(-0.5, 0.45, -0.74), moonColor: '#e7d6ff', moonSize: 0.035, moonGlow: 0.6,
      moon2Dir: new Vector3(0, 1, 0), moon2Color: '#000000', moon2Size: 0,
    },
    fog: ['#2a1a48', 22, 300],
    hemi: ['#6f6cff', '#1d1030', 0.8],
    key: ['#b9c6ff', 0.95, new Vector3(-3, 5.5, -3.5)],
    lamp: ['#ffc38a', 2.5],
    table: ['#100f24', '#8a5cff', '#e6be6e'],
    floor: ['#24222f', '#121019', '#b77cff'],
    pouf: '#5b2a96',
  },
  celestial: {
    sky: {
      top: '#2b5cc4', mid: '#7fb2ff', horizon: '#ffe6c4', below: '#d8e6ff',
      stars: 0, nebula: 0, nebulaColor: '#000000', clouds: 1, cloudColor: '#ffffff',
      moonDir: new Vector3(-0.48, 0.34, -0.81), moonColor: '#dfe9ff', moonSize: 0.17, moonGlow: 0.35,
      moon2Dir: new Vector3(0.52, 0.46, -0.72), moon2Color: '#ff8f7a', moon2Size: 0.032,
    },
    fog: ['#d9e6ff', 45, 560],
    hemi: ['#d6e6ff', '#cdb89a', 1.25],
    key: ['#fff1d6', 2.0, new Vector3(-3.5, 6, 2.5)],
    lamp: ['#ffd59a', 1.1],
    table: ['#161a38', '#8fa2ff', '#f0c873'],
    floor: ['#e6e1ef', '#b8b0cb', '#d9a940'],
    pouf: '#6f3bb0',
  },
};

export class AnimeArena {
  readonly root = new Group();
  readonly chairs: Object3D[] = [];
  readonly decor = new Group();
  readonly viewer = new Vector3(0, 1.2, 1);
  readonly key: DirectionalLight;
  readonly kind: ArenaName;

  private look: ArenaLook;
  private hemi: HemisphereLight;
  private lamp: PointLight;
  private sky: ShaderMaterial;
  private fog: Fog;
  private sceneRef: Scene | null = null;
  private mr = false;
  private reduced = false;
  private flashing = true;
  private glowMat = new MeshBasicMaterial({ color: 0x719e94, toneMapped: false });
  private glowColor = new Color(0x719e94);
  private glowTarget = new Color(0x719e94);
  private glowPower = 1;
  private mood = 0;
  private moodTarget = 0;
  private floorCircles: Mesh[] = [];
  private lanternGlow: MeshBasicMaterial[] = [];
  /** Each glowing material's own colour, so the flicker keeps it. */
  private lanternBase: Color[] = [];
  /** Things that animate with time: shader uniforms, spinning circles, swaying flowers. */
  private timed: ShaderMaterial[] = [];
  private weathers: Points[] = [];
  private spinners: { obj: Object3D; speed: number }[] = [];
  private sway = { value: 0 };
  private flash = 0;
  private nextFlash = 6;
  private bolt: Mesh | null = null;
  private boltPos: Float32Array | null = null;
  private blink: MeshBasicMaterial | null = null;
  private neon: MeshBasicMaterial[] = [];
  private mists: Sprite[] = [];

  constructor(kind: ArenaName) {
    this.kind = kind;
    this.look = LOOKS[kind];
    const L = this.look;
    this.root.name = `Arena_${kind}`;
    this.root.add(this.decor);

    this.hemi = new HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]);
    this.key = new DirectionalLight(L.key[0], L.key[1]);
    this.key.position.copy(L.key[2]);
    this.key.target.position.set(0, TABLE_Y, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -2.6;
    cam.right = cam.top = 2.6;
    cam.near = 1;
    cam.far = 14;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.lamp = new PointLight(L.lamp[0], L.lamp[1], 6, 2);
    this.lamp.position.set(0, 2.3, 0);
    this.root.add(this.hemi, this.key, this.key.target, this.lamp);
    this.fog = new Fog(L.fog[0], L.fog[1], L.fog[2]);

    this.sky = skyMaterial(L.sky);
    const dome = new Mesh(new SphereGeometry(900, 48, 24), this.sky);
    dome.name = 'Arena_Sky';
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.decor.add(dome);
    this.timed.push(this.sky);

    this.buildTable();
    this.buildPoufs();
    this.buildFloorCircles();
    if (kind === 'shrine') this.buildShrine();
    else if (kind === 'domain') this.buildDomain();
    else this.buildCelestial();
    for (const m of this.lanternGlow) this.lanternBase.push(m.color.clone());
    inert(this.root);
  }

  // ---------------------------------------------------------------- shared set
  private buildTable(): void {
    const [base, vein, gold] = this.look.table;
    const topMat = new MeshStandardMaterial({ map: tableTopTexture(base, vein, gold), roughness: 0.32, metalness: 0.15 });
    const sideMat = metal('gold');
    const top = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R - 0.015, 0.06, 72), [sideMat, topMat, topMat]);
    top.position.y = TABLE_Y - 0.03;
    top.castShadow = true;
    top.receiveShadow = true;
    top.name = 'Table_Walnut_Surface';
    const rim = new Mesh(new TorusGeometry(TABLE_R + 0.004, 0.02, 8, 96), metal('gold'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE_Y - 0.004;
    const ring = new Mesh(new RingGeometry(TABLE_R - 0.07, TABLE_R - 0.058, 96), this.glowMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = TABLE_Y + 0.0015;
    ring.name = 'Arena_GlowRing';
    // a turned pedestal, navy lacquer with gold bands
    const prof: Vector2[] = [];
    const H = TABLE_Y - 0.06;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = 0.1 + 0.2 * Math.pow(1 - t, 3) + 0.05 * Math.pow(t, 6) + 0.02 * Math.sin(t * Math.PI * 3) * (1 - t);
      prof.push(new Vector2(r, t * H));
    }
    const pedestal = new Mesh(new LatheGeometry(prof, 24), new MeshStandardMaterial({ color: '#1b1940', roughness: 0.4, metalness: 0.2 }));
    pedestal.castShadow = true;
    const bands = new Group();
    for (const [y, r] of [[0.04, 0.29], [H * 0.55, 0.115], [H - 0.02, 0.15]] as const) {
      const b = new Mesh(new TorusGeometry(r, 0.012, 6, 40), metal('gold'));
      b.rotation.x = Math.PI / 2;
      b.position.y = y;
      bands.add(b);
    }
    const table = new Group();
    table.name = 'Arena_Table';
    table.add(top, rim, ring, pedestal, bands);
    this.root.add(table);
  }

  /** Tufted velvet poufs with a gold band, one per seat (the heroes sit on them). */
  private buildPoufs(): void {
    const pts: Vector2[] = [];
    const prof: [number, number][] = [
      [0.001, 0.0], [0.2, 0.0], [0.245, 0.04], [0.27, 0.14], [0.272, 0.3], [0.262, 0.42], [0.235, 0.49], [0.17, 0.525], [0.07, 0.535], [0.001, 0.53],
    ];
    for (const [r, y] of prof) pts.push(new Vector2(r, y));
    const body = new LatheGeometry(pts, 28);
    // tufting: the top dips at buttons and puffs between them
    const p = body.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const y = p.getY(i);
      if (y > 0.42) {
        const a = Math.atan2(x, z);
        p.setY(i, y + 0.012 * Math.cos(a * 8));
      }
    }
    body.computeVertexNormals();
    const velvet = new MeshStandardMaterial({ color: this.look.pouf, roughness: 0.82, metalness: 0.0, emissive: this.look.pouf, emissiveIntensity: 0.08 });
    const band = new TorusGeometry(0.274, 0.016, 6, 48);
    band.rotateX(Math.PI / 2);
    band.translate(0, 0.2, 0);
    const gold = metal('gold');
    for (let slot = 0; slot < 4; slot++) {
      const a = seatAngle(slot);
      const r = SEAT_R + 0.06;
      const seat = new Group();
      seat.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      seat.rotation.y = a;
      seat.name = `Arena_Pouf_${slot}`;
      const m = new Mesh(body, velvet);
      m.castShadow = true;
      m.receiveShadow = true;
      seat.add(m, new Mesh(band, gold));
      this.chairs.push(seat);
      this.root.add(seat);
    }
  }

  /** Two summoning circles on the floor round the table, turning; they take the colour in play. */
  private buildFloorCircles(): void {
    const specs: [number, 0 | 1 | 2, number, number][] = [
      [3.4, 0, 0.05, 0.6],
      [5.2, 1, -0.025, 0.28],
    ];
    for (const [size, style, speed, opacity] of specs) {
      const m = new Mesh(
        new PlaneGeometry(size, size),
        new MeshBasicMaterial({ map: magicCircleTexture(style, 1024, 11 + style), color: 0x719e94, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012 + style * 0.002;
      m.renderOrder = 2;
      m.name = 'Arena_FloorCircle';
      this.floorCircles.push(m);
      this.spinners.push({ obj: m, speed });
      this.decor.add(m);
    }
  }

  private buildFloor(radius: number, depth: number, sideCol: string): void {
    const [stone, joint, inlay] = this.look.floor;
    const floor = new Mesh(new CircleGeometry(radius, 96), new MeshStandardMaterial({ map: floorTexture(stone, joint, inlay), roughness: 0.38, metalness: 0.08 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'Arena_Floor';
    const side = new Mesh(merge([cyl(radius, radius * 0.97, depth, 0, -depth / 2, 0, sideCol, 72)]), toon());
    side.name = 'Arena_FloorEdge';
    this.decor.add(floor, side);
  }

  /** Posts and two rails around the terrace edge. */
  private buildRailing(radius: number, postCol: string, railKind: 'lacquer' | 'gold' | 'silver', skipFront = 0): void {
    const n = 44;
    const posts = new InstancedMesh(merge([box(0.09, 0.95, 0.09, 0, 0.475, 0, postCol), box(0.13, 0.06, 0.13, 0, 0.98, 0, postCol)]), toon(), n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (skipFront && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < skipFront) continue;
      _p.set(Math.sin(a) * radius, 0, Math.cos(a) * radius);
      posts.setMatrixAt(k++, _m.compose(_p, _q.setFromAxisAngle(_up, a), _s.set(1, 1, 1)));
    }
    posts.count = k;
    posts.castShadow = false;
    posts.name = 'Arena_RailPosts';
    const railGeo = new TorusGeometry(radius, 0.03, 6, 160);
    railGeo.rotateX(Math.PI / 2);
    const rail = new Mesh(railGeo, metal(railKind));
    rail.position.y = 0.95;
    const low = new Mesh(railGeo, metal(railKind));
    low.position.y = 0.45;
    low.scale.set(1, 0.6, 1);
    this.decor.add(posts, rail, low);
  }

  /** Paper lanterns at the given spots (one draw call), glowing and flickering softly. */
  private paperLanterns(spots: [number, number, number, number][], color: string): void {
    const geo = paperLanternGeometry();
    const mat = new MeshBasicMaterial({ color, toneMapped: false });
    this.lanternGlow.push(mat);
    const m = new InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, s], i) => m.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(s, s * 1.1, s))));
    m.name = 'Arena_PaperLanterns';
    // a soft halo sprite per lantern reads as light spill at a distance
    const halo = new SpriteMaterial({ map: magicGlow(), color, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.55, toneMapped: false });
    for (const [x, y, z, s] of spots) {
      const sp = new Sprite(halo);
      sp.position.set(x, y, z);
      sp.scale.setScalar(s * 1.3);
      this.decor.add(sp);
    }
    this.decor.add(m);
  }

  private stoneLanterns(spots: [number, number, number][], stone: string): void {
    const body = new InstancedMesh(stoneLanternGeometry(stone), toon(), spots.length);
    const fireMat = new MeshBasicMaterial({ color: '#ffc27a', toneMapped: false });
    this.lanternGlow.push(fireMat);
    const fire = new InstancedMesh(new BoxGeometry(0.18, 0.17, 0.18), fireMat, spots.length);
    spots.forEach(([x, y, z], i) => {
      body.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, Math.atan2(x, z)), _s.set(1, 1, 1)));
      fire.setMatrixAt(i, _m.compose(_p.set(x, y + 0.92, z), _q, _s));
    });
    body.castShadow = true;
    body.name = 'Arena_StoneLanterns';
    this.decor.add(body, fire);
  }

  // ---------------------------------------------------------------- Wisteria Shrine
  private buildShrine(): void {
    this.buildFloor(5.2, 0.5, '#3a3358');
    this.buildRailing(5.05, '#9e2228', 'lacquer', 0.32);
    // garden ring one step down, mossy stone, out to the cliff edge
    const garden = new Mesh(new RingGeometry(5.1, 18, 96, 6), new MeshStandardMaterial({ color: '#2d3b4f', roughness: 0.95 }));
    garden.rotation.x = -Math.PI / 2;
    garden.position.y = -0.42;
    garden.receiveShadow = true;
    const gardenEdge = new Mesh(merge([cyl(18, 16.5, 12, 0, -6.4, 0, '#262746', 64)]), toon());
    this.decor.add(garden, gardenEdge);

    // the lake below, with the moon's reflection
    const lake = new Mesh(new PlaneGeometry(1400, 1400), pondMaterial('#0d1033', '#3a3f86', this.look.sky.moonDir, '#fff1d0'));
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = -12;
    lake.name = 'Arena_Lake';
    this.timed.push(lake.material as ShaderMaterial);
    // cliffs across the water and far mountains, open ahead for the moon
    const near = new Mesh(cliffRing(48, 120, -12, 58, 3, '#2a2860', '#8f86d8', 0.5), toon({ emissive: 0x241c52, emissiveIntensity: 1 }));
    const far = new Mesh(cliffRing(180, 330, -12, 150, 9, '#33307a', '#a99ee8'), toon({ emissive: 0x2c2466, emissiveIntensity: 1 }));
    this.decor.add(lake, near, far);

    this.buildPavilion(-5.2, -6.6);
    this.buildWisteria();
    this.buildTorii(-17, -24, 0.5);

    // a waterfall pouring off the cliff ahead and to the right, with mist at its foot
    const fall = new Mesh(new PlaneGeometry(9, 52, 1, 1), waterfallMaterial('#eaf6ff', '#5d7fd0'));
    fall.position.set(16, 14, -70);
    fall.lookAt(0, 14, 0);
    fall.name = 'Arena_Waterfall';
    this.timed.push(fall.material as ShaderMaterial);
    this.decor.add(fall);
    this.addMist(16, -9, -68, 26, '#cfd8ff');
    // a little shrine lit on the far cliff
    const far2 = new Group();
    far2.position.set(-38, 30, -88);
    far2.scale.setScalar(2.2);
    far2.lookAt(0, 30, 0);
    far2.add(new Mesh(merge([box(3, 1.4, 2, 0, 0.7, 0, '#3b1f2a'), templeRoof(4.4, 3.2, 1.0, 0.5, '#23244a', '#c79a4a').translate(0, 1.4, 0)]), toon()));
    const win = new Mesh(new PlaneGeometry(2.4, 0.9), new MeshBasicMaterial({ map: shojiTexture(6, 2), toneMapped: false }));
    win.position.set(0, 0.7, 1.01);
    far2.add(win);
    this.decor.add(far2);

    // stone lanterns round the garden; paper lanterns in the pavilion eaves and on the railing
    const stones: [number, number, number][] = [];
    for (const a of [0.9, 1.5, 2.2, -0.9, -1.5, -2.2, 2.75, -2.75]) stones.push([Math.sin(a) * 6.4, -0.42, Math.cos(a) * 6.4]);
    this.stoneLanterns(stones, '#7d7898');
    const papers: [number, number, number, number][] = [];
    for (const a of [1.1, 1.75, 2.4, -1.1, -1.75, -2.4]) papers.push([Math.sin(a) * 5.05, 1.25, Math.cos(a) * 5.05, 0.9]);
    this.paperLanterns(papers, '#ffb070');

    // petals drifting down and fireflies over the garden
    const sky = weather('lantern', 90, 70, -10, 46, 13);
    sky.position.set(0, 0, -40);
    this.weathers.push(sky);
    this.decor.add(sky);
    const petals = weather('petal', 520, 7, -0.4, 6, 3);
    const flies = weather('firefly', 70, 9, 0.2, 2.6, 5);
    flies.position.y = 0;
    this.weathers.push(petals, flies);
    this.decor.add(petals, flies);
  }

  /** The shrine hall behind and to the left: red pillars, glowing paper walls, a two-tier roof. */
  private buildPavilion(x: number, z: number): void {
    const g = new Group();
    g.position.set(x, -0.42, z);
    g.rotation.y = Math.atan2(-x, -z);
    const W = 6;
    const D = 3.6;
    const red = '#b3262a';
    const parts: BufferGeometry[] = [box(W + 1.2, 0.5, D + 1.2, 0, 0.25, 0, '#4a4568'), box(W + 1.6, 0.18, D + 1.6, 0, 0.09, 0, '#3a3656')];
    // steps up to the hall
    for (let i = 0; i < 3; i++) parts.push(box(2.2, 0.17, 0.4, 0, 0.085 + i * 0.17, D / 2 + 1.0 - i * 0.35, '#57537a'));
    for (const px of [-W / 2, -W / 6, W / 6, W / 2]) {
      for (const pz of [-D / 2, D / 2]) {
        parts.push(cyl(0.15, 0.17, 3.0, px, 2.0, pz, red, 12));
        parts.push(cyl(0.22, 0.22, 0.12, px, 0.56, pz, '#2b2a40', 10));
      }
    }
    parts.push(box(W + 0.5, 0.28, 0.3, 0, 3.45, D / 2, '#7a1a1e'), box(W + 0.5, 0.28, 0.3, 0, 3.45, -D / 2, '#7a1a1e'));
    parts.push(box(0.3, 0.28, D + 0.3, -W / 2, 3.45, 0, '#7a1a1e'), box(0.3, 0.28, D + 0.3, W / 2, 3.45, 0, '#7a1a1e'));
    // a low balustrade along the front
    parts.push(box(W, 0.07, 0.08, 0, 1.05, D / 2 + 0.25, red), box(W, 0.05, 0.06, 0, 0.75, D / 2 + 0.25, red));
    parts.push(templeRoof(W + 2.6, D + 2.4, 1.3, 0.75, '#262a55', '#d6aa55').translate(0, 3.6, 0));
    parts.push(box(W * 0.62, 0.9, D * 0.55, 0, 5.0, 0, '#7a1a1e'));
    parts.push(templeRoof(W * 0.85, D * 0.95, 1.0, 0.55, '#262a55', '#d6aa55').translate(0, 5.4, 0));
    const hall = new Mesh(merge(parts), toon());
    (hall.material as { side: number }).side = DoubleSide;
    hall.castShadow = true;
    hall.receiveShadow = true;
    hall.name = 'Arena_Pavilion';
    // glowing shoji walls behind the pillars
    const paper = new MeshBasicMaterial({ map: shojiTexture(), toneMapped: false, side: DoubleSide });
    this.lanternGlow.push(paper);
    for (const [px, w] of [[-W / 3, W / 3], [0, W / 3], [W / 3, W / 3]] as const) {
      const p = new Mesh(new PlaneGeometry(w - 0.3, 2.6), paper);
      p.position.set(px, 1.95, -D / 2 + 0.08);
      g.add(p);
    }
    const sideL = new Mesh(new PlaneGeometry(D - 0.3, 2.6), paper);
    sideL.rotation.y = Math.PI / 2;
    sideL.position.set(-W / 2 + 0.08, 1.95, 0);
    g.add(hall, sideL);
    // ridge ornaments
    for (const sx of [-1, 1]) {
      const orn = new Mesh(new ConeGeometry(0.12, 0.6, 6), metal('gold'));
      orn.position.set(sx * W * 0.31, 6.55, 0);
      g.add(orn);
    }
    // lanterns hanging from the front eave
    const spots: [number, number, number, number][] = [];
    for (const px of [-W / 2, -W / 6, W / 6, W / 2]) {
      g.updateMatrixWorld(true);
      const w = g.localToWorld(_p.set(px, 2.75, D / 2 + 0.45));
      spots.push([w.x, w.y, w.z, 1.25]);
    }
    this.decor.add(g);
    this.paperLanterns(spots, '#ffa45e');
  }

  /** Wisteria everywhere: on a pergola round the terrace sides and on a great old tree. */
  private buildWisteria(): void {
    const rnd = seeded(17);
    const frame: BufferGeometry[] = [];
    const spots: [number, number, number, number, number][] = [];
    const arcs: [number, number][] = [
      [0.72, 2.55],
      [-2.55, -0.72],
    ];
    const R = 4.7;
    const H = 3.1;
    for (const [a0, a1] of arcs) {
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        frame.push(cyl(0.07, 0.08, H, Math.sin(a) * (R + 0.35), H / 2 - 0.42, Math.cos(a) * (R + 0.35), '#4a2e22', 8));
        frame.push(box(1.5, 0.1, 0.12, Math.sin(a) * R, H - 0.38, Math.cos(a) * R, '#5a3826', a + Math.PI / 2));
      }
      const segs = 18;
      for (let i = 0; i < segs; i++) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / segs;
        const len = ((a1 - a0) / segs) * (R + 0.35) + 0.05;
        frame.push(box(len, 0.12, 0.14, Math.sin(a) * (R + 0.35), H - 0.3, Math.cos(a) * (R + 0.35), '#5a3826', a + Math.PI / 2));
        frame.push(box(len, 0.1, 0.12, Math.sin(a) * (R - 0.45), H - 0.3, Math.cos(a) * (R - 0.45), '#5a3826', a + Math.PI / 2));
      }
      // racemes hang in clumps along the pergola
      for (let i = 0; i < 120; i++) {
        const a = a0 + (a1 - a0) * rnd();
        const r = R - 0.55 + rnd() * 1.1;
        spots.push([Math.sin(a) * r, H - 0.32, Math.cos(a) * r, 0.32 + rnd() * 0.55, rnd()]);
      }
    }
    // the old tree, back right of the shrine hall
    const tx = 5.6;
    const tz = -7.8;
    const trunk: BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      const c = new CylinderGeometry(0.32 - t * 0.04, 0.42 - t * 0.04, 1.0, 9);
      c.rotateZ(Math.sin(i * 1.3) * 0.18);
      c.translate(tx + Math.sin(i * 0.9) * 0.25, -0.42 + 0.5 + i * 0.9, tz + Math.cos(i * 1.1) * 0.2);
      trunk.push(tint(c, C('#3b2620')));
    }
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2;
      const c = new CylinderGeometry(0.07, 0.16, 3.2, 6);
      c.rotateZ(1.1);
      c.rotateY(a);
      c.translate(tx + Math.cos(a) * 1.3, 4.6, tz - Math.sin(a) * 1.3);
      trunk.push(tint(c, C('#3b2620')));
    }
    frame.push(...trunk);
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 3.3;
      spots.push([tx + Math.cos(a) * r, 5.2 - r * 0.35 + rnd() * 0.6, tz + Math.sin(a) * r * 0.8, 0.45 + rnd() * 0.7, rnd()]);
    }
    const wood = new Mesh(merge(frame), toon());
    wood.castShadow = true;
    wood.name = 'Arena_Pergola';
    this.decor.add(wood);

    // all blossoms in one instanced mesh; the wind sways each from its stem
    const mat = toon({ emissive: 0x6a46c0, emissiveIntensity: 0.75 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSway = this.sway;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hang = -position.y;
        float ph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
        transformed.x += sin(uSway * 1.3 + ph) * 0.07 * hang * hang;
        transformed.z += cos(uSway * 1.1 + ph * 1.3) * 0.05 * hang * hang;`,
      );
    };
    const blossoms = new InstancedMesh(racemeGeometry(), mat, spots.length);
    spots.forEach(([x, y, z, len, turn], i) => {
      blossoms.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, turn * 6.28), _s.set(1.5 + len * 0.6, len, 1.5 + len * 0.6)));
    });
    blossoms.name = 'Arena_Wisteria';
    this.decor.add(blossoms);
  }

  private buildTorii(x: number, z: number, y: number): void {
    const red = '#c62a2a';
    const parts = [
      cyl(0.22, 0.26, 5.2, -2.2, 2.6, 0, red, 12),
      cyl(0.22, 0.26, 5.2, 2.2, 2.6, 0, red, 12),
      box(5.6, 0.35, 0.45, 0, 4.3, 0, red),
      box(0.3, 0.9, 0.3, 0, 4.85, 0, red),
      cyl(0.32, 0.34, 0.4, -2.2, 0.2, 0, '#1b1a2a', 12),
      cyl(0.32, 0.34, 0.4, 2.2, 0.2, 0, '#1b1a2a', 12),
    ];
    // the curved top beam sweeps up at the ends
    const top = new BoxGeometry(7.4, 0.42, 0.7, 16, 1, 1);
    const p = top.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.pow(Math.abs(p.getX(i)) / 3.7, 2.5) * 0.55);
    top.translate(0, 5.45, 0);
    parts.push(tint(top, C('#1b1a2a')));
    const g = new Mesh(merge(parts), toon());
    g.position.set(x, y - 12, z);
    g.scale.setScalar(1.6);
    g.lookAt(0, y - 12, 0);
    const rock = new Mesh(merge([cyl(4, 6.5, 13, 0, -6.5, 0, '#2a2850', 9)]), toon());
    rock.position.set(x, y - 12 + 0.5, z);
    this.decor.add(g, rock);
  }

  private addMist(x: number, y: number, z: number, size: number, color: string): void {
    const mat = new SpriteMaterial({ map: magicGlow(), color, transparent: true, depthWrite: false, opacity: 0.35 });
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(mat);
      s.position.set(x + (i - 1.5) * size * 0.25, y + i * 1.5, z + i);
      s.scale.set(size * (1 + i * 0.15), size * 0.45, 1);
      this.mists.push(s);
      this.decor.add(s);
    }
  }

  // ---------------------------------------------------------------- Midnight Domain
  private buildDomain(): void {
    const [stone, joint] = this.look.floor;
    // the rooftop: wet concrete tiles, neon smeared across the puddles
    const roof = new Mesh(new PlaneGeometry(13, 13), new MeshStandardMaterial({ map: rooftopTexture(stone, joint), roughness: 0.22, metalness: 0.25 }));
    roof.rotation.x = -Math.PI / 2;
    roof.receiveShadow = true;
    roof.name = 'Arena_Floor';
    const parts: BufferGeometry[] = [];
    for (const [w, d, x, z] of [[13.4, 0.35, 0, 6.5], [13.4, 0.35, 0, -6.5], [0.35, 13.4, 6.5, 0], [0.35, 13.4, -6.5, 0]] as const) {
      parts.push(box(w, 0.75, d, x, 0.37, z, '#2b2838'));
      parts.push(box(w, 0.06, d + 0.05, x, 0.77, z, '#4b4660'));
    }
    // rooftop clutter: vents, a water tank, an antenna mast
    parts.push(box(1.2, 0.8, 0.9, -5.2, 0.4, -4.6, '#3a3850'), box(0.9, 0.6, 0.9, -3.9, 0.3, -5.3, '#33314a'));
    parts.push(cyl(0.8, 0.8, 1.8, 5.0, 1.5, -5.0, '#4a4560', 14), box(1.6, 0.6, 1.6, 5.0, 0.3, -5.0, '#2d2b40'));
    parts.push(cyl(0.05, 0.08, 7, 5.6, 3.5, 5.4, '#5a5570', 6));
    parts.push(box(13.4, 4.5, 0.4, 0, -2.25, 6.5, '#1f1d2c'), box(13.4, 4.5, 0.4, 0, -2.25, -6.5, '#1f1d2c'));
    parts.push(box(0.4, 4.5, 13.4, 6.5, -2.25, 0, '#1f1d2c'), box(0.4, 4.5, 13.4, -6.5, -2.25, 0, '#1f1d2c'));
    const shell = new Mesh(merge(parts), toon());
    shell.receiveShadow = true;
    shell.name = 'Arena_Rooftop';
    this.decor.add(roof, shell);
    this.blink = new MeshBasicMaterial({ color: '#ff3048', toneMapped: false });
    const beacon = new Mesh(new SphereGeometry(0.09, 10, 8), this.blink);
    beacon.position.set(5.6, 7.05, 5.4);
    this.decor.add(beacon);

    // the city: one instanced draw for every tower, windows lit in the shader
    this.buildCity();

    // strings of lights over the roof, and red lanterns along the parapet
    const bulbs: [number, number, number][] = [];
    const strings: [Vector3, Vector3][] = [
      [new Vector3(-6.3, 3.4, -6.3), new Vector3(6.3, 3.4, -6.3)],
      [new Vector3(-6.3, 3.4, -6.3), new Vector3(-6.3, 3.4, 6.3)],
      [new Vector3(6.3, 3.4, -6.3), new Vector3(6.3, 3.4, 6.3)],
      [new Vector3(-6.3, 3.4, -2), new Vector3(6.3, 3.4, -2)],
    ];
    const poles: BufferGeometry[] = [];
    for (const [a, b] of strings) {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        _p.lerpVectors(a, b, t);
        _p.y -= Math.sin(t * Math.PI) * 0.7;
        bulbs.push([_p.x, _p.y, _p.z]);
      }
    }
    for (const [x, z] of [[-6.3, -6.3], [6.3, -6.3], [-6.3, 6.3], [6.3, 6.3], [-6.3, -2], [6.3, -2]]) poles.push(cyl(0.04, 0.05, 3.4, x, 1.7, z, '#3d3a50', 6));
    this.decor.add(new Mesh(merge(poles), toon()));
    const bulbMat = new MeshBasicMaterial({ color: '#ffd6a0', toneMapped: false });
    this.lanternGlow.push(bulbMat);
    const bulbMesh = new InstancedMesh(new SphereGeometry(0.045, 8, 6), bulbMat, bulbs.length);
    const tints = ['#ffd6a0', '#ff8fd0', '#8fe8ff'];
    bulbs.forEach(([x, y, z], i) => {
      bulbMesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(1, 1, 1)));
      bulbMesh.setColorAt(i, C(tints[i % 3]));
    });
    this.decor.add(bulbMesh);
    const reds: [number, number, number, number][] = [];
    for (const x of [-4.5, -1.5, 1.5, 4.5]) reds.push([x, 1.25, -6.35, 1.0]);
    for (const z of [-3.5, 0, 3.5]) reds.push([-6.35, 1.25, z, 1.0], [6.35, 1.25, z, 1.0]);
    this.paperLanterns(reds, '#ff5a4a');

    // red banners with brushed lettering on the parapet
    const words = ['夜札', '魔法', '勝負', '祭'];
    words.forEach((w, i) => {
      const side = i % 2 ? 1 : -1;
      const mat = new MeshBasicMaterial({ map: neonTexture(w, '#ff2a4a', true), transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true });
      const cloth = new Mesh(new PlaneGeometry(0.55, 1.7), new MeshStandardMaterial({ color: '#8a1020', roughness: 0.8, side: DoubleSide }));
      const x = side * 6.3;
      const z = -4.2 + Math.floor(i / 2) * 3;
      cloth.position.set(x, 1.65, z);
      cloth.rotation.y = side * -Math.PI / 2;
      const glyphs = new Mesh(new PlaneGeometry(0.5, 1.6), mat);
      glyphs.position.set(x - side * 0.02, 1.65, z);
      glyphs.rotation.y = side * -Math.PI / 2;
      this.decor.add(cloth, glyphs);
    });

    // the summoning circle that hangs over the city
    for (const [size, style, speed, op, y] of [[130, 0, 0.03, 0.8, 0], [80, 1, -0.05, 0.6, 0.3], [34, 2, 0.08, 0.65, 0.6]] as const) {
      const ring = new Mesh(
        new PlaneGeometry(size, size),
        new MeshBasicMaterial({ map: magicCircleTexture(style as 0 | 1 | 2, 1024, 40 + style), color: '#b06cff', transparent: true, opacity: op, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false }),
      );
      const holder = new Group();
      holder.position.set(12, 50 + y, -165);
      holder.lookAt(0, 0, 0);
      holder.rotateX(-0.55);
      holder.add(ring);
      this.spinners.push({ obj: ring, speed });
      this.decor.add(holder);
    }
    const glow = new Sprite(new SpriteMaterial({ map: magicGlow(), color: '#9b5cff', transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.5, fog: false }));
    glow.position.set(12, 50, -165);
    glow.scale.setScalar(220);
    this.decor.add(glow);

    const rain = weather('rain', 2600, 9, -1, 13, 7);
    this.weathers.push(rain);
    this.decor.add(rain);
  }

  private buildCity(): void {
    const rnd = seeded(23);
    const spots: [number, number, number, number, number, number][] = [];
    for (let i = 0; i < 340; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 42 + Math.pow(rnd(), 0.8) * 200;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // near blocks stay below the roof so you look out over them; towers rise further off
      const top = r < 80 ? -14 + rnd() * 16 : r < 150 ? -6 + rnd() * rnd() * 70 : 10 + rnd() * rnd() * 130;
      const w = 8 + rnd() * 14;
      const d = 8 + rnd() * 14;
      spots.push([x, -90, z, w, top + 90, d]);
    }
    // the tower: a red-and-white lattice spire to the left
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new ShaderMaterial({
      fog: true,
      uniforms: { ...this.fogUniforms(), uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        varying vec3 vNormal2;
        varying float vSeed;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal2 = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal2;
        varying float vSeed;
        ${NOISE_GLSL}
        void main() {
          vec3 n = normalize(vNormal2);
          vec3 base = mix(vec3(0.012, 0.01, 0.03), vec3(0.03, 0.022, 0.06), vSeed);
          if (n.y > 0.5) { gl_FragColor = vec4(base * 0.8, 1.0); }
          else {
            float along = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
            vec2 cell = vec2(floor(along / 1.6), floor(vWorld.y / 2.2));
            vec2 f = vec2(fract(along / 1.6), fract(vWorld.y / 2.2));
            float lit = step(0.66 - vSeed * 0.16, hash12(cell + vSeed * 31.0));
            float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.68);
            vec3 warm = mix(vec3(1.0, 0.78, 0.45), vec3(0.55, 0.85, 1.0), step(0.7, hash12(cell * 1.7)));
            warm = mix(warm, vec3(1.0, 0.45, 0.85), step(0.9, hash12(cell * 2.3)));
            float flick = 0.85 + 0.15 * sin(uTime * 0.5 + hash12(cell) * 60.0);
            vec3 col = base + warm * win * lit * flick * 0.8;
            // a cool rim from the sky circle on the upper floors
            col += vec3(0.08, 0.03, 0.16) * smoothstep(10.0, 120.0, vWorld.y);
            gl_FragColor = vec4(col, 1.0);
          }
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.timed.push(mat);
    const city = new InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, w, h, d], i) => city.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, Math.round(Math.atan2(x, z) / (Math.PI / 2)) * (Math.PI / 2)), _s.set(w, h, d))));
    city.frustumCulled = false;
    city.name = 'Arena_City';
    this.decor.add(city);

    const tower = gradientY(new CylinderGeometry(0.6, 9, 180, 4, 12, true), -90, 90, '#d43a2c', '#f2efe9');
    const t = new Mesh(tower, toon());
    t.position.set(-70, 20, -150);
    this.decor.add(t);

    // neon signs on the nearer buildings
    const signs: [string, string, boolean, number, number, number, number][] = [
      ['ラーメン', '#ff4fb0', true, -30, 2, -40, 9],
      ['カード', '#3ff0ff', false, 34, 6, -52, 14],
      ['夜', '#ffcf3f', true, 44, 0, -20, 8],
      ['AFTERHOURS', '#b77cff', false, -6, 14, -78, 26],
      ['魔法', '#ff5a5a', true, -46, 4, -12, 9],
      ['勝負', '#7cff9e', false, 48, 10, 18, 12],
      ['札', '#ff8f3f', true, -40, 8, 30, 9],
    ];
    for (const [text, color, vertical, x, y, z, size] of signs) {
      const mat = new MeshBasicMaterial({ map: neonTexture(text, color, vertical), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true });
      this.neon.push(mat);
      const sign = new Mesh(new PlaneGeometry(vertical ? size * 0.31 : size, vertical ? size : size * 0.31), mat);
      sign.position.set(x, y, z);
      sign.lookAt(0, y, 0);
      this.decor.add(sign);
    }
  }

  // ---------------------------------------------------------------- Celestial Arena
  private buildCelestial(): void {
    this.buildFloor(5.6, 0.35, '#d9d3e6');
    // the platform floats: a rock root hangs under the marble
    const root = new Mesh(gradientY(new ConeGeometry(5.4, 9, 12, 4), -4.5, 4.5, '#5b4b6e', '#9a8aa8').rotateX(Math.PI).translate(0, -4.85, 0), toon());
    this.decor.add(root);
    // columns round the edge, between the seats so no column stands behind a head
    const parts: BufferGeometry[] = [];
    const gold: BufferGeometry[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const x = Math.sin(a) * 5.2;
      const z = Math.cos(a) * 5.2;
      if (Math.cos(a) > 0.8) continue; // nothing right in front of you
      parts.push(cyl(0.28, 0.3, 5.2, x, 2.6, z, '#f1eef7', 16));
      parts.push(box(0.85, 0.22, 0.85, x, 0.11, z, '#ddd7e8'), box(0.8, 0.25, 0.8, x, 5.3, z, '#ddd7e8'));
      gold.push(new TorusGeometry(0.31, 0.03, 6, 24).rotateX(Math.PI / 2).translate(x, 4.95, z));
      gold.push(new TorusGeometry(0.32, 0.03, 6, 24).rotateX(Math.PI / 2).translate(x, 0.32, z));
    }
    // a broken ring of architrave over the back half
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * 0.55 + (i / 13) * Math.PI * 0.9;
      parts.push(box(1.3, 0.35, 0.6, Math.sin(a) * 5.2, 5.55, Math.cos(a) * 5.2, '#ece7f3', a + Math.PI / 2));
    }
    const cols = new Mesh(merge(parts), toon());
    cols.castShadow = true;
    cols.name = 'Arena_Columns';
    const goldMesh = new Mesh(mergeIndexed(gold), metal('gold'));
    this.decor.add(cols, goldMesh);
    // banners on the columns at the sides
    const banner = new MeshStandardMaterial({ map: bannerTexture('#5a2ea6', '#f0c873'), transparent: true, side: DoubleSide, forceSinglePass: true, roughness: 0.8, alphaTest: 0.5 });
    banner.onBeforeCompile = (shader) => {
      shader.uniforms.uSway = this.sway;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float drop = 1.0 - uv.y;
        transformed.z += sin(uSway * 1.6 + position.y * 2.5) * 0.06 * drop;`,
      );
    };
    for (const a of [((1.5 / n) * Math.PI * 2), ((6.5 / n) * Math.PI * 2), ((3.5 / n) * Math.PI * 2), ((4.5 / n) * Math.PI * 2)]) {
      const b = new Mesh(new PlaneGeometry(0.8, 2.6, 1, 8), banner);
      b.position.set(Math.sin(a) * 4.82, 3.6, Math.cos(a) * 4.82);
      b.lookAt(0, 3.6, 0);
      this.decor.add(b);
    }

    // a sea of cloud far below, and islands drifting in the sky
    const sea = new Mesh(new PlaneGeometry(1800, 1800), cloudSeaMaterial(this.fogUniforms()));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -26;
    this.timed.push(sea.material as ShaderMaterial);
    this.decor.add(sea);
    this.buildIslands();

    const motes = weather('mote', 360, 8, 0, 5, 9);
    this.weathers.push(motes);
    this.decor.add(motes);

    // a reusable lightning bolt (a jagged ribbon), redrawn for each strike far off
    this.boltPos = new Float32Array(26 * 2 * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.boltPos, 3));
    const idx: number[] = [];
    for (let i = 0; i < 25; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    this.bolt = new Mesh(g, new MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, forceSinglePass: true, toneMapped: false, fog: false }));
    this.bolt.frustumCulled = false;
    this.decor.add(this.bolt);
  }

  private buildIslands(): void {
    const rnd = seeded(41);
    const rock: BufferGeometry[] = [];
    const green: BufferGeometry[] = [];
    const white: BufferGeometry[] = [];
    const falls: [number, number, number, number, number][] = [];
    const isles: [number, number, number, number][] = [
      [-48, 6, -70, 9],
      [62, 14, -95, 13],
      [-110, 22, -150, 18],
      [20, -4, -40, 4],
      [120, 2, -30, 8],
      [-90, -2, 10, 7],
      [140, 30, -200, 22],
    ];
    for (const [x, y, z, s] of isles) {
      const cone = new ConeGeometry(s, s * 1.9, 9, 4);
      cone.rotateX(Math.PI);
      const p = cone.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i);
        const pz = p.getZ(i);
        const k = noise(px * 0.3 + x, pz * 0.3 + z) * 0.22;
        p.setX(i, px * (1 + k));
        p.setZ(i, pz * (1 + k));
      }
      cone.translate(x, y - s * 0.95, z);
      rock.push(gradientY(cone, y - s * 1.9, y, '#4c3d63', '#a4889a'));
      const cap = new CylinderGeometry(s * 1.04, s * 0.98, s * 0.18, 12);
      cap.translate(x, y + s * 0.05, z);
      green.push(tint(cap, C('#6fbf73')));
      // trees on top
      for (let t = 0; t < Math.max(2, s * 0.6); t++) {
        const a = rnd() * Math.PI * 2;
        const r = rnd() * s * 0.7;
        const h = s * (0.25 + rnd() * 0.2);
        const tree = new ConeGeometry(h * 0.35, h, 7);
        tree.translate(x + Math.cos(a) * r, y + s * 0.14 + h / 2, z + Math.sin(a) * r);
        green.push(tint(tree, C(rnd() < 0.5 ? '#3f9a62' : '#58b46c')));
      }
      if (s > 8) falls.push([x + s * 0.7, y, z + s * 0.3, s * 0.35, s * 3.4]);
    }
    // a floating city of white spires on the largest island
    const [cx, cy, cz, cs] = isles[6];
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * cs * 0.6;
      const h = cs * (0.3 + rnd() * 0.9);
      const w = cs * (0.05 + rnd() * 0.05);
      white.push(cyl(w, w * 1.15, h, cx + Math.cos(a) * r, cy + cs * 0.15 + h / 2, cz + Math.sin(a) * r, '#f2eef8', 8));
      const cap = new ConeGeometry(w * 1.4, w * 3, 8);
      cap.translate(cx + Math.cos(a) * r, cy + cs * 0.15 + h + w * 1.5, cz + Math.sin(a) * r);
      white.push(tint(cap, C('#e2b65b')));
    }
    this.decor.add(new Mesh(merge([...rock, ...green, ...white]), toon()));
    for (const [x, y, z, w, h] of falls) {
      const f = new Mesh(new PlaneGeometry(w, h), waterfallMaterial('#ffffff', '#9cc8ff'));
      f.position.set(x, y - h / 2, z);
      f.lookAt(0, y - h / 2, 0);
      this.timed.push(f.material as ShaderMaterial);
      this.decor.add(f);
    }
  }

  /** A strike of golden lightning far out in the sky (skipped with reduced flashing). */
  private strike(): void {
    if (!this.bolt || !this.boltPos) return;
    const rnd = Math.random;
    const a = -2.4 + rnd() * 1.6 + (rnd() < 0.5 ? 0 : Math.PI * 0.9);
    const r = 160 + rnd() * 120;
    let x = Math.sin(a) * r;
    let y = 140 + rnd() * 60;
    let z = Math.cos(a) * r;
    const drop = 7 + rnd() * 4;
    for (let i = 0; i < 26; i++) {
      const w = 1.2 * (1 - i / 26) + 0.25;
      this.boltPos.set([x - w, y, z, x + w, y, z], i * 6);
      x += (rnd() - 0.5) * 12;
      z += (rnd() - 0.5) * 6;
      y -= drop;
    }
    this.bolt.geometry.getAttribute('position').needsUpdate = true;
    this.bolt.lookAt(0, 0, 0);
    this.bolt.rotation.set(0, 0, 0);
    this.flash = 1;
  }

  /** Own copies of the fog uniforms: three refreshes them from the scene fog every frame. */
  private fogUniforms(): Record<string, { value: unknown }> {
    return {
      fogColor: { value: this.fog.color.clone() },
      fogNear: { value: this.fog.near },
      fogFar: { value: this.fog.far },
      fogDensity: { value: 0 },
    };
  }

  // ---------------------------------------------------------------- the Lounge surface
  async load(onProgress?: (k: number) => void): Promise<void> {
    onProgress?.(1);
  }

  setMixedReality(on: boolean): void {
    this.mr = on;
    this.decor.visible = !on;
    if (this.chairs[0]) this.chairs[0].visible = !on;
    if (this.sceneRef) this.sceneRef.fog = on ? null : this.fog;
  }

  setGlow(hex: number, power = 1): void {
    this.glowTarget.setHex(hex);
    this.glowPower = power;
  }

  setMood(m: -1 | 0 | 1): void {
    this.moodTarget = m;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.flashing = !on;
    for (const w of this.weathers) {
      const u = (w.material as ShaderMaterial).uniforms;
      u.uSpeed.value = on ? 0.35 : 1;
      u.uOpacity.value = on ? 0.5 : 1;
    }
  }

  /** Detach from the scene (the fog is ours) and free GPU memory, when switching worlds. */
  dispose(): void {
    if (this.sceneRef && this.sceneRef.fog === this.fog) this.sceneRef.fog = null;
    this.root.removeFromParent();
    disposeTree(this.root);
  }

  update(dt: number, t: number): void {
    if (!this.sceneRef) {
      let s: Object3D = this.root;
      while (s.parent) s = s.parent;
      if ((s as Scene).isScene) {
        this.sceneRef = s as Scene;
        if (!this.mr) this.sceneRef.fog = this.fog;
      }
    }
    const time = this.reduced ? t * 0.4 : t;
    for (const m of this.timed) m.uniforms.uTime.value = time;
    for (const w of this.weathers) (w.material as ShaderMaterial).uniforms.uTime.value = time;
    this.sway.value = time;
    for (const s of this.spinners) s.obj.rotation.z += s.speed * dt * (this.reduced ? 0.4 : 1);

    // the colour in play runs through the table ring and the floor circles
    const k = 1 - Math.exp(-dt * 4);
    this.glowColor.lerp(this.glowTarget, k);
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
    this.glowMat.color.copy(this.glowColor).multiplyScalar(Math.min(1.6, 0.9 * this.glowPower * pulse));
    for (const c of this.floorCircles) (c.material as MeshBasicMaterial).color.copy(this.glowColor).multiplyScalar(0.55 + 0.25 * this.glowPower);

    const flicker = this.reduced ? 1 : 0.92 + 0.05 * Math.sin(t * 9.3) + 0.03 * Math.sin(t * 6.1 + 1.3);
    for (let i = 0; i < this.lanternGlow.length; i++) this.lanternGlow[i].color.copy(this.lanternBase[i]).multiplyScalar(flicker);
    if (this.blink) this.blink.color.setRGB(Math.sin(t * 3) > 0.3 ? 1 : 0.15, 0.1, 0.15);
    for (let i = 0; i < this.neon.length; i++) {
      const buzz = this.reduced ? 1 : Math.sin(t * 23 + i * 7) > 0.97 ? 0.4 : 1;
      this.neon[i].opacity = buzz;
    }
    for (let i = 0; i < this.mists.length; i++) this.mists[i].material.opacity = 0.28 + 0.08 * Math.sin(t * 0.4 + i);

    // storms: lightning over the clouds (celestial) or a city flash (domain)
    if (this.flashing && (this.kind === 'celestial' || this.kind === 'domain')) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 7 + Math.random() * 8;
        if (this.kind === 'celestial') this.strike();
        else this.flash = 0.7;
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.4);
      const f = this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40));
      this.sky.uniforms.uFlash.value = f * (this.kind === 'celestial' ? 0.12 : 0.18);
      if (this.bolt) (this.bolt.material as MeshBasicMaterial).opacity = Math.min(1, this.flash * 1.6);
    } else this.sky.uniforms.uFlash.value = 0;

    this.mood += (this.moodTarget - this.mood) * (1 - Math.exp(-dt * 3));
    const dim = this.mood < 0 ? 1 + this.mood * 0.45 : 1 + this.mood * 0.2;
    this.hemi.intensity = this.look.hemi[2] * dim;
    this.sky.uniforms.uDim.value = dim;
    this.lamp.intensity = this.look.lamp[1] * (this.mood < 0 ? 1 + this.mood * 0.3 : 1);
  }
}

let glowTex: CanvasTexture | null = null;
/** A soft round light, for halos and mist. */
function magicGlow(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = keep(new CanvasTexture(c));
  glowTex.colorSpace = SRGBColorSpace;
  return glowTex;
}

/** Wet concrete tiles with puddles holding streaks of neon. */
function rooftopTexture(stone: string, joint: string): CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const rnd = seeded(77);
  g.fillStyle = joint;
  g.fillRect(0, 0, S, S);
  const base = new Color(stone);
  const tmp = new Color();
  const T = S / 12;
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      tmp.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
      g.fillStyle = `#${tmp.getHexString()}`;
      g.fillRect(i * T + 2, j * T + 2, T - 4, T - 4);
    }
  }
  // puddles reflecting neon
  for (let k = 0; k < 16; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rx = 40 + rnd() * 110;
    const ry = 25 + rnd() * 60;
    g.fillStyle = 'rgba(8,6,18,0.55)';
    g.beginPath();
    g.ellipse(x, y, rx, ry, rnd() * 3, 0, Math.PI * 2);
    g.fill();
    const neon = ['255,79,176', '63,240,255', '183,124,255', '255,207,63'][k % 4];
    const grad = g.createLinearGradient(x, y - ry, x, y + ry);
    grad.addColorStop(0, `rgba(${neon},0)`);
    grad.addColorStop(0.5, `rgba(${neon},0.35)`);
    grad.addColorStop(1, `rgba(${neon},0)`);
    g.fillStyle = grad;
    g.fillRect(x - rx * 0.15, y - ry, rx * 0.3, ry * 2);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A sea of cloud seen from above: soft billows drifting, pink-lit at their edges. */
function cloudSeaMaterial(fog: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    uniforms: { ...fog, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vWorld.xz * 0.012 + vec2(uTime * 0.004, uTime * 0.002);
        float n = fbm2(p) * 0.65 + fbm2(p * 3.1 + 4.0) * 0.35;
        vec3 shade = vec3(0.74, 0.78, 0.94);
        vec3 lit = vec3(1.0, 0.98, 0.97);
        vec3 rose = vec3(1.0, 0.82, 0.86);
        vec3 col = mix(shade, lit, smoothstep(0.35, 0.65, n));
        col = mix(col, rose, smoothstep(0.62, 0.8, n) * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** Merge indexed geometries that only carry positions and normals (gold trim). */
function mergeIndexed(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of flat) count += g.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const name of ['position', 'normal']) {
    const data = new Float32Array(count * 3);
    let o = 0;
    for (const g of flat) {
      data.set(g.getAttribute(name).array as Float32Array, o);
      o += g.getAttribute('position').count * 3;
    }
    out.setAttribute(name, new BufferAttribute(data, 3));
  }
  return out;
}
