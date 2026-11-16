/**
 * Frostpeak: a stylized alpine world for the card table.
 *
 * Painterly snow-capped mountains around a still lake, a wooden deck on a
 * cliff top, a timber bridge over a frozen gorge, snowy pines, lanterns and
 * falling snow. Everything is generated here (no large downloads):
 * flat-shaded geometry with vertex colours, a few small shaders, instanced
 * props. It exposes the same surface as `Lounge`, so the game, cards,
 * characters and networking do not care which world is shown.
 *
 * Budget (Quest 3 browser): ~30 draw calls, ~45k triangles, one shadow map
 * focused on the table, three lights.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { SEAT_R, TABLE_R, TABLE_Y, seatAngle } from './env.js';
import { disposeTree } from './arena-kit.js';
import { mergeStatic } from './draw-tuning.js';

// ---------------------------------------------------------------- palette
/** Painterly palette taken from the reference: lilac haze, slate rock, warm timber. */
const FOG = new Color('#c9c4e4');
const SKY_TOP = new Color('#8b93c9');
const SKY_HORIZON = new Color('#dcd7ee');
const SNOW = new Color('#f3f3fb');
const SNOW_SHADE = new Color('#d9dbef');
const ROCK = new Color('#6f6380');
const ROCK_LIGHT = new Color('#8f84a0');
const PINE = new Color('#2f5552');
const PINE_DARK = new Color('#21403f');
const WOOD = new Color('#9a5a37');
const WOOD_DARK = new Color('#6a3a22');
const IRON = new Color('#2c2a33');

const FOG_NEAR = 18;
const FOG_FAR = 420;
const LAKE_Y = -12;

// ---------------------------------------------------------------- noise
/** Small seeded 2D simplex noise (Gustavson), returns -1..1. */
export function makeNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const sk = (xin + yin) * F2;
    const i = Math.floor(xin + sk);
    const j = Math.floor(yin + sk);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    const corner = (gi: number, x: number, y: number) => {
      const tt = 0.5 - x * x - y * y;
      if (tt <= 0) return 0;
      const g = (gi % 8) * 2;
      return tt * tt * tt * tt * (G[g] * x + G[g + 1] * y);
    };
    n += corner(perm[ii + perm[jj]], x0, y0);
    n += corner(perm[ii + i1 + perm[jj + j1]], x1, y1);
    n += corner(perm[ii + 1 + perm[jj + 1]], x2, y2);
    return 70 * n;
  };
}
const noise = makeNoise(7);
const fbm = (x: number, y: number, octaves = 4): number => {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += a * noise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return sum;
};
const ridge = (x: number, y: number): number => {
  let a = 0.55;
  let f = 1;
  let sum = 0;
  for (let o = 0; o < 4; o++) {
    const n = 1 - Math.abs(noise(x * f, y * f));
    sum += a * n * n;
    f *= 2.1;
    a *= 0.5;
  }
  return sum;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- geometry helpers
/**
 * Flat-shades an indexed geometry and colours each face. `paint` receives the
 * face centre and normal and writes the face colour into `out`.
 */
function facet(geo: BufferGeometry, paint: (c: Vector3, n: Vector3, out: Color) => void): BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  const pos = flat.getAttribute('position');
  const nor = flat.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const c = new Vector3();
  const n = new Vector3();
  const out = new Color();
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.x += pos.getX(i + k), c.y += pos.getY(i + k), c.z += pos.getZ(i + k);
    c.multiplyScalar(1 / 3);
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    paint(c, n, out);
    for (let k = 0; k < 3; k++) out.toArray(colors, (i + k) * 3);
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

/** Concatenates non-indexed geometries that share position/normal/color attributes. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const names = ['position', 'normal', 'color'];
  let count = 0;
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) count += g.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const name of names) {
    const data = new Float32Array(count * 3);
    let offset = 0;
    for (const g of flat) {
      const a = g.getAttribute(name);
      if (a) data.set(a.array as Float32Array, offset);
      offset += g.getAttribute('position').count * 3;
    }
    out.setAttribute(name, new BufferAttribute(data, 3));
  }
  return out;
}

/** Colours every vertex of a geometry one colour (for parts merged by `merge`). */
export function tint(geo: BufferGeometry, color: Color): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(data, i * 3);
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
}

/** Painted timber planks on a small canvas (no texture download). */
function plankTexture(rows: number, base: string, dark: string, light: string): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const shade = 0.88 + ((r * 37) % 9) / 50;
    g.fillStyle = base;
    g.globalAlpha = 1;
    g.fillRect(0, r * h, size, h);
    g.fillStyle = `rgba(255,236,210,${(shade - 0.88) * 0.9})`;
    g.fillRect(0, r * h, size, h);
    // grain strokes
    g.strokeStyle = dark;
    g.globalAlpha = 0.18;
    g.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      const y = r * h + h * (0.15 + 0.7 * (((k * 53 + r * 17) % 97) / 97));
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k + r) * 2.5);
      g.stroke();
    }
    // top highlight and dark seam (painted bevel)
    g.globalAlpha = 0.55;
    g.fillStyle = light;
    g.fillRect(0, r * h + 2, size, 3);
    g.globalAlpha = 0.85;
    g.fillStyle = dark;
    g.fillRect(0, r * h + h - 4, size, 4);
    // a few board ends and nails
    const cut = ((r * 211) % 380) + 66;
    g.fillRect(cut, r * h, 4, h);
    g.globalAlpha = 0.6;
    g.fillStyle = '#2b1d16';
    for (const nx of [cut - 14, cut + 18]) {
      g.beginPath();
      g.arc(nx, r * h + h * 0.3, 3, 0, Math.PI * 2);
      g.arc(nx, r * h + h * 0.7, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Static scenery never takes rays or pointer events. */
export function inert(o: Object3D): void {
  o.traverse((c) => {
    (c as Mesh).raycast = () => {};
  });
}

// ---------------------------------------------------------------- terrain
/** Height of the snowy plateau, gorge and cliff around the deck (world metres). */
function groundY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.05, z * 0.05) * 1.8 * smooth(4.5, 16, r) + 0.6 * smooth(4, 10, r);
  h -= 0.35 * (1 - smooth(3.2, 4.6, r)); // under the deck
  // the frozen gorge to the east, crossed by the bridge
  const gorge = Math.exp(-((x - 8.2) ** 2) / (2 * 1.35 ** 2));
  h -= 6.5 * gorge * smooth(26, 10, Math.abs(z + 2));
  // the cliff edge in front of the table: the plateau falls away to the lake
  const cliff = smooth(-9, -18, z + 0.25 * fbm(x * 0.08, 3) * 6);
  h = h * (1 - cliff) + (LAKE_Y - 1.5 + fbm(x * 0.1, z * 0.1) * 1.2) * cliff;
  // a rise behind and to the sides closes the view in
  h += 9 * smooth(26, 58, r) * (1 - cliff) * (0.6 + 0.4 * ridge(x * 0.03, z * 0.03));
  return h;
}

function buildGround(): BufferGeometry {
  const rings = 46;
  const spokes = 120;
  const pos: number[] = [];
  const radius = (i: number) => 64 * (i / rings) ** 1.6;
  const vert = (i: number, j: number) => {
    const a = (j / spokes) * Math.PI * 2;
    const r = radius(i);
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    return [x, groundY(x, z), z];
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < spokes; j++) {
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i + 1, j + 1);
      const d = vert(i, j + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return facet(geo, (c, n, out) => {
    const steep = 1 - n.y;
    const snowy = n.y > 0.72 - 0.08 * noise(c.x * 0.3, c.z * 0.3);
    if (c.y < LAKE_Y + 0.6) out.copy(ROCK).lerp(FOG, 0.15);
    else if (snowy) out.copy(SNOW).lerp(SNOW_SHADE, smooth(0.05, 0.25, steep) + 0.15 * noise(c.x, c.z));
    else out.copy(ROCK).lerp(ROCK_LIGHT, 0.5 + 0.5 * noise(c.x * 0.5, c.z * 0.5));
  });
}

/**
 * One ring of distant mountains. A valley is left open straight ahead (north)
 * so the lake runs to the horizon, as in the reference.
 */
function buildRange(r0: number, r1: number, height: number, valley: number, seed: number): BufferGeometry {
  const spokes = 150;
  const rows = 7;
  const pos: number[] = [];
  const vert = (i: number, j: number) => {
    const a = (j / spokes) * Math.PI * 2;
    const t = i / rows;
    const r = r0 + (r1 - r0) * t;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    const ahead = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const open = valley > 0 ? smooth(0.06, valley, ahead) : 1;
    const profile = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7;
    const peaks = 0.35 + 0.65 * ridge(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 + t * 0.6);
    const h = LAKE_Y - 3 + height * profile * peaks * (0.25 + 0.75 * open);
    return [x, h, z];
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < spokes; j++) {
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i + 1, j + 1);
      const d = vert(i, j + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const snowLine = LAKE_Y + height * 0.18;
  return facet(geo, (c, n, out) => {
    const snowy = n.y > 0.22 + 0.16 * noise(c.x * 0.02, c.z * 0.02) || (c.y > snowLine + height * 0.25 && n.y > 0.06);
    if (snowy && c.y > snowLine - 8 * noise(c.x * 0.05, c.z * 0.05)) out.copy(SNOW).lerp(SNOW_SHADE, smooth(0.5, 0.95, 1 - n.y));
    else out.copy(ROCK).lerp(ROCK_LIGHT, 0.35 + 0.35 * noise(c.x * 0.04, c.z * 0.04));
  });
}

// ---------------------------------------------------------------- props
function rockGeometry(seed: number): BufferGeometry {
  const g = new DodecahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  const n = makeNoise(seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + 0.22 * n(x * 1.7 + seed, z * 1.7) + 0.1 * n(y * 2.3, x * 2.3);
    pos.setXYZ(i, x * k * 1.25, Math.max(-0.35, y * k * 0.8), z * k);
  }
  return facet(g, (_c, nn, out) => {
    if (nn.y > 0.55) out.copy(SNOW).lerp(SNOW_SHADE, 0.2 * (1 - nn.y));
    else out.copy(ROCK).lerp(ROCK_LIGHT, 0.3 + 0.4 * Math.abs(nn.x));
  });
}

function pineGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.09, 0.14, 0.9, 6);
  trunk.translate(0, 0.45, 0);
  parts.push(tint(trunk, WOOD_DARK));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const r = 1.15 - i * 0.24;
    const h = 1.15 - i * 0.12;
    const y = 0.7 + i * 0.72;
    const cone = new CylinderGeometry(0.02, r, h, 7, 1);
    cone.translate(0, y + h / 2, 0);
    parts.push(
      facet(cone, (c, n, out) => {
        // snow sits on the upper, outward faces of each tier
        if (n.y > 0.42 && (c.y - y) / h < 0.62) out.copy(SNOW).lerp(SNOW_SHADE, 0.25);
        else out.copy(PINE).lerp(PINE_DARK, 0.5 + 0.5 * Math.sin(i + c.x * 3));
      }),
    );
  }
  return merge(parts);
}

function chairGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: Color) => {
    const b = new BoxGeometry(w, h, d);
    b.translate(x, y, z);
    parts.push(tint(b, col));
  };
  box(0.5, 0.07, 0.48, 0, 0.45, 0, WOOD);
  for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) box(0.07, 0.45, 0.07, x, 0.225, z, WOOD_DARK);
  box(0.07, 0.62, 0.07, -0.21, 0.79, 0.21, WOOD_DARK);
  box(0.07, 0.62, 0.07, 0.21, 0.79, 0.21, WOOD_DARK);
  box(0.5, 0.16, 0.05, 0, 0.98, 0.21, WOOD);
  box(0.5, 0.06, 0.05, 0, 0.72, 0.21, WOOD);
  const cushion = new CylinderGeometry(0.2, 0.22, 0.06, 10);
  cushion.translate(0, 0.51, 0);
  parts.push(tint(cushion, new Color('#7b2f3a')));
  return merge(parts);
}

/** The timber bridge, built along +X from the origin, `len` long. */
function bridgeGeometry(len: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: Color) => {
    const b = new BoxGeometry(w, h, d);
    b.translate(x, y, z);
    parts.push(tint(b, col));
  };
  const planks = Math.round(len / 0.32);
  for (let i = 0; i < planks; i++) {
    const shade = new Color().copy(WOOD).lerp(WOOD_DARK, ((i * 7) % 5) / 9);
    box(0.28, 0.08, 1.5 + ((i * 3) % 4) * 0.03, 0.16 + i * 0.32, 0, 0, shade);
  }
  for (const z of [-0.78, 0.78]) {
    box(len + 0.2, 0.22, 0.14, len / 2, -0.12, z, WOOD_DARK);
    box(len, 0.08, 0.09, len / 2, 0.86, z, WOOD);
    box(len, 0.06, 0.06, len / 2, 0.5, z, WOOD);
    for (const x of [0, len / 3, (2 * len) / 3, len]) box(0.16, 1.05, 0.16, x, 0.42, z, WOOD_DARK);
    for (const x of [len * 0.22, len * 0.78]) {
      const disc = new CylinderGeometry(0.13, 0.13, 0.05, 12);
      disc.rotateX(Math.PI / 2);
      disc.translate(x, -0.12, z * 1.06);
      parts.push(tint(disc, IRON));
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------- shaders
const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  float fogAmount(float d) { return smoothstep(uFogNear, uFogFar, d); }
`;

function fogUniforms() {
  return {
    uFogColor: { value: FOG.clone() },
    uFogNear: { value: FOG_NEAR },
    uFogFar: { value: FOG_FAR },
  };
}

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: SKY_TOP.clone() },
      uHorizon: { value: SKY_HORIZON.clone() },
      uSun: { value: new Vector3(-0.35, 0.32, -0.88).normalize() },
      uMood: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // always behind everything
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform float uMood;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        float sun = max(0.0, dot(normalize(vDir), uSun));
        col += vec3(1.0, 0.92, 0.82) * (pow(sun, 18.0) * 0.35 + pow(sun, 3.0) * 0.08);
        col = mix(col, col * vec3(0.62, 0.6, 0.78), clamp(-uMood, 0.0, 1.0) * 0.6);
        col = mix(col, col * vec3(1.08, 1.0, 0.86), clamp(uMood, 0.0, 1.0) * 0.5);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function lakeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uTime: { value: 0 },
      uDeep: { value: new Color('#4e6aa8') },
      uShallow: { value: new Color('#8ea6da') },
      uSky: { value: SKY_HORIZON.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_GLSL}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      varying vec3 vWorld;
      float wave(vec2 p) {
        return sin(p.x * 0.35 + uTime * 0.6) * 0.5 + sin(p.y * 0.27 - uTime * 0.45 + p.x * 0.11) * 0.5;
      }
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float d = length(toEye);
        vec3 v = toEye / d;
        // stylized ripple bands that thin out with distance
        float w = wave(vWorld.xz) * 0.5 + wave(vWorld.xz * 2.7 + 13.0) * 0.5;
        float bands = smoothstep(0.82, 0.97, w) * (1.0 - smoothstep(30.0, 160.0, d));
        float fresnel = pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.35 * w);
        col = mix(col, uSky, fresnel * 0.75);
        col += bands * 0.22;
        float glint = pow(max(0.0, w), 24.0) * (1.0 - smoothstep(20.0, 90.0, d));
        col += vec3(1.0, 0.97, 0.9) * glint * 0.5;
        col = mix(col, uFogColor, fogAmount(d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function streamMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...fogUniforms(), uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_GLSL}
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        float flow = sin(vWorld.z * 2.2 + uTime * 1.7 + sin(vWorld.x * 3.0) * 1.3);
        float foam = smoothstep(0.75, 0.98, flow) * 0.5 + smoothstep(0.9, 1.25, abs(vWorld.x - 8.2)) * 0.8;
        vec3 col = mix(vec3(0.33, 0.45, 0.72), vec3(0.93, 0.95, 1.0), clamp(foam, 0.0, 1.0));
        col = mix(col, uFogColor, fogAmount(length(cameraPosition - vWorld)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function snowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 1 }, uOpacity: { value: 0.85 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uSpeed;
      varying float vFade;
      void main() {
        vec3 p = position;
        float fall = uTime * uSpeed * (0.35 + aSeed * 0.35);
        p.y = mod(p.y - fall, 11.0) - 1.0;
        p.x += sin(uTime * 0.6 + aSeed * 40.0) * 0.35;
        p.z += cos(uTime * 0.5 + aSeed * 23.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp((0.035 + aSeed * 0.03) * 900.0 / max(d, 0.5), 1.0, 9.0);
        vFade = smoothstep(0.25, 1.2, d) * (1.0 - smoothstep(9.0, 15.0, d));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c)) * vFade * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0), a);
      }`,
  });
}

// ---------------------------------------------------------------- the world
type Instance = [x: number, z: number, scale: number, turn: number, yOffset?: number];

export class Frostpeak {
  readonly root = new Group();
  /** One chair per seat angle (south, west, north, east). */
  readonly chairs: Object3D[] = [];
  /** Everything that is not the table, chairs and lights: hidden in mixed reality. */
  readonly decor = new Group();
  /** Where the viewer's head is, in table space (set by the app each frame). */
  readonly viewer = new Vector3(0, 1.2, 1);
  readonly key: DirectionalLight;

  private hemi: HemisphereLight;
  private lantern: PointLight;
  private sky = skyMaterial();
  private lake = lakeMaterial();
  private stream = streamMaterial();
  private snow = snowMaterial();
  private glowMat: MeshBasicMaterial;
  private flameMat: MeshBasicMaterial;
  private glowColor = new Color(0x719e94);
  private glowTarget = new Color(0x719e94);
  private glowPower = 1;
  private moodTarget = 0;
  private mood = 0;
  private reduced = false;
  private fog = new Fog(FOG, FOG_NEAR, FOG_FAR);
  private sceneRef: Scene | null = null;
  /** Shared time for the wind in the pines (a uniform object, updated each frame). */
  private wind = { value: 0 };
  private mists: { sprite: Sprite; speed: number; base: number; radius: number; angle: number }[] = [];
  private birds: InstancedMesh | null = null;
  private birdMat: ShaderMaterial | null = null;
  private mr = false;

  constructor() {
    this.root.name = 'Frostpeak';
    this.root.add(this.decor);

    // light: cool sky from above, warm lantern over the table, a low winter sun for shape
    this.hemi = new HemisphereLight(0xd6dcff, 0x7a6d86, 1.25);
    this.key = new DirectionalLight(0xfff0de, 1.6);
    this.key.position.set(-3.2, 5.5, -2.4);
    this.key.target.position.set(0, TABLE_Y, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -2.4;
    cam.right = cam.top = 2.4;
    cam.near = 1;
    cam.far = 12;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.lantern = new PointLight(0xffb36b, 2.2, 5.5, 2);
    this.lantern.position.set(0, 2.35, 0);
    this.root.add(this.hemi, this.key, this.key.target, this.lantern);

    this.glowMat = new MeshBasicMaterial({ color: 0x719e94, toneMapped: false });
    this.flameMat = new MeshBasicMaterial({ color: 0xffc27a, toneMapped: false });

    this.buildSky();
    this.buildLandscape();
    this.buildDeck();
    this.buildTable();
    this.buildChairs();
    this.buildSnow();
    this.buildMist();
    this.buildBirds();
    inert(this.root);
  }

  private buildSky(): void {
    const dome = new Mesh(new SphereGeometry(900, 32, 16), this.sky);
    dome.name = 'Frostpeak_Sky';
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.decor.add(dome);
  }

  private buildLandscape(): void {
    const land = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const ground = new Mesh(buildGround(), land);
    ground.name = 'Frostpeak_Ground';
    ground.receiveShadow = true;
    this.decor.add(ground);

    const ranges = [
      buildRange(120, 200, 62, 0.34, 11),
      buildRange(220, 320, 115, 0.24, 23),
      buildRange(340, 520, 210, 0.08, 37),
    ];
    for (const [i, geo] of ranges.entries()) {
      const m = new Mesh(geo, land);
      m.name = `Frostpeak_Range_${i}`;
      this.decor.add(m);
    }

    const lake = new Mesh(new PlaneGeometry(1600, 1600), this.lake);
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = LAKE_Y;
    lake.name = 'Frostpeak_Lake';
    this.decor.add(lake);

    const stream = new Mesh(new PlaneGeometry(2.6, 60, 1, 1), this.stream);
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(8.2, -5.9, -2);
    stream.name = 'Frostpeak_Stream';
    this.decor.add(stream);

    // timber bridge over the gorge, to the front right
    const bridge = new Mesh(bridgeGeometry(5.6), new MeshLambertMaterial({ vertexColors: true }));
    bridge.name = 'Frostpeak_Bridge';
    bridge.position.set(5.4, groundY(5.4, -2.2) + 0.06, -2.2);
    bridge.castShadow = false;
    this.decor.add(bridge);

    // snow-capped rocks around the plateau, the gorge and the cliff edge
    const rockMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const rocks: Instance[][] = [
      [[-5.8, -6.5, 1.4, 0.3], [6.2, -5.4, 1.2, 1.1], [10.4, -4.1, 1.6, 2.2], [-9.5, -9.8, 2.1, 0.8], [3.5, -9.6, 1.3, 1.9], [-3.4, -10.5, 1.7, 2.7]],
      [[7.0, 1.6, 1.1, 0.5], [9.6, 2.4, 1.4, 1.4], [-6.8, 3.4, 1.0, 2.0], [-12, -3, 2.4, 0.2], [13.5, -7.5, 2.6, 1.0], [0.8, -12.2, 2.2, 0.6]],
      [[-15, -14, 3.6, 0.9], [16, -15, 3.2, 2.4], [-7.5, -15.5, 2.8, 1.6], [9.5, -12.5, 2.5, 0.4], [-18, 2, 3.0, 1.2], [19, 4, 3.4, 2.8]],
    ];
    rocks.forEach((set, v) => {
      const mesh = new InstancedMesh(rockGeometry(31 + v * 7), rockMat, set.length);
      set.forEach(([x, z, s, turn], i) => mesh.setMatrixAt(i, place(x, groundY(x, z) - s * 0.15, z, s, turn)));
      mesh.name = `Frostpeak_Rocks_${v}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.decor.add(mesh);
    });

    // snowy pines on the slopes, kept out of the view over the lake
    const pines: Instance[] = [];
    const rand = makeNoise(99);
    for (let i = 0; i < 140; i++) {
      const a = (i / 140) * Math.PI * 2 + rand(i, 1) * 0.3;
      const r = 13 + ((i * 37) % 26) + rand(i, 2) * 3;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const ahead = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (ahead < 0.62 && r < 30) continue; // keep the lake view clear
      if (Math.abs(x - 8.2) < 2.2 && z > -16 && z < 12) continue; // not in the gorge
      if (groundY(x, z) < LAKE_Y + 1) continue;
      pines.push([x, z, 0.9 + ((i * 13) % 10) / 10, i * 1.7]);
    }
    const pineMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    pineMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float bend = max(0.0, position.y - 0.7);
          float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float sway = sin(uWind * 1.1 + phase) * 0.6 + sin(uWind * 2.3 + phase * 1.7) * 0.25;
          transformed.x += sway * 0.035 * bend * bend;
          transformed.z += cos(uWind * 0.9 + phase) * 0.02 * bend * bend;`,
        );
    };
    const pineMesh = new InstancedMesh(pineGeometry(), pineMat, pines.length);
    pines.forEach(([x, z, s, turn], i) => pineMesh.setMatrixAt(i, place(x, groundY(x, z) - 0.1, z, 0.55 + s * 0.4, turn)));
    pineMesh.name = 'Frostpeak_Pines';
    this.decor.add(pineMesh);
  }

  private buildDeck(): void {
    const tex = plankTexture(8, '#8a5739', '#4e2c1c', '#c4906a');
    tex.repeat.set(2.4, 2.4);
    const deckMat = new MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
    const deck = new Mesh(new CylinderGeometry(3.15, 3.25, 0.22, 8), deckMat);
    deck.position.y = -0.11;
    deck.rotation.y = Math.PI / 8;
    deck.receiveShadow = true;
    deck.name = 'Frostpeak_Deck';
    this.root.add(deck);

    // corner posts with lanterns, and a low rail behind you and to the sides
    const frame: BufferGeometry[] = [];
    const lanternGlass: BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = Math.sin(a) * 3.0;
      const z = -Math.cos(a) * 3.0;
      const ahead = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5;
      const postH = ahead ? 0.55 : 1.05;
      const post = new BoxGeometry(0.16, postH, 0.16);
      post.translate(x, postH / 2, z);
      frame.push(tint(post, WOOD_DARK));
      if (!ahead && k % 2 === 1) {
        const cap = new BoxGeometry(0.24, 0.05, 0.24);
        cap.translate(x, postH + 0.24, z);
        frame.push(tint(cap, IRON));
        const glass = new BoxGeometry(0.16, 0.2, 0.16);
        glass.translate(x, postH + 0.11, z);
        lanternGlass.push(tint(glass, new Color('#ffd28a')));
      }
      // rail to the next post, except across the view ahead
      const b = ((k + 1) / 8) * Math.PI * 2;
      const nextAhead = Math.abs(Math.atan2(Math.sin(b), Math.cos(b))) < 0.5;
      if (!ahead && !nextAhead) {
        const nx = Math.sin(b) * 3.0;
        const nz = -Math.cos(b) * 3.0;
        const len = Math.hypot(nx - x, nz - z);
        for (const y of [0.55, 0.95]) {
          const rail = new BoxGeometry(len, 0.07, 0.08);
          rail.rotateY(-Math.atan2(nz - z, nx - x));
          rail.translate((x + nx) / 2, y, (z + nz) / 2);
          frame.push(tint(rail, WOOD));
        }
      }
    }
    const frameMesh = new Mesh(merge(frame), new MeshLambertMaterial({ vertexColors: true }));
    frameMesh.name = 'Frostpeak_DeckFrame';
    this.decor.add(frameMesh);
    const glass = new Mesh(merge(lanternGlass), this.flameMat);
    glass.name = 'Frostpeak_Lanterns';
    this.decor.add(glass);

    // a hanging lantern over the table (the warm point light lives here)
    const hang = new Group();
    const body = new Mesh(new CylinderGeometry(0.11, 0.14, 0.24, 8), new MeshLambertMaterial({ color: IRON }));
    const flame = new Mesh(new CylinderGeometry(0.07, 0.09, 0.16, 8), this.flameMat);
    const chain = new Mesh(new CylinderGeometry(0.01, 0.01, 0.6, 4), new MeshLambertMaterial({ color: IRON }));
    chain.position.y = 0.42;
    hang.add(body, flame, chain);
    hang.position.set(0, 2.45, 0);
    hang.name = 'Frostpeak_HangingLantern';
    this.root.add(hang);
  }

  private buildTable(): void {
    const tex = plankTexture(6, '#6e4430', '#3b2216', '#a8754f');
    tex.repeat.set(1.5, 1.5);
    const topMat = new MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 });
    const top = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R - 0.02, 0.07, 48), topMat);
    top.position.y = TABLE_Y - 0.035;
    top.castShadow = true;
    top.receiveShadow = true;
    top.name = 'Table_Walnut_Surface';
    const rim = new Mesh(new TorusGeometry(TABLE_R + 0.005, 0.03, 8, 64), new MeshStandardMaterial({ color: IRON, roughness: 0.45, metalness: 0.6 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE_Y - 0.035;
    // the rune ring shows the colour to match (setGlow)
    const ring = new Mesh(new RingGeometry(TABLE_R - 0.072, TABLE_R - 0.06, 72), this.glowMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = TABLE_Y + 0.0015;
    ring.name = 'Frostpeak_GlowRing';
    const pedestal = new Mesh(new CylinderGeometry(0.1, 0.16, TABLE_Y - 0.07, 10), new MeshLambertMaterial({ color: WOOD_DARK }));
    pedestal.position.y = (TABLE_Y - 0.07) / 2;
    pedestal.castShadow = true;
    const feet = new Mesh(
      merge([0, 1, 2, 3].map((k) => {
        const f = new BoxGeometry(0.62, 0.08, 0.12);
        f.rotateY((k * Math.PI) / 2 + Math.PI / 4);
        f.translate(0, 0.04, 0);
        return tint(f, WOOD_DARK);
      })),
      new MeshLambertMaterial({ vertexColors: true }),
    );
    const table = new Group();
    table.name = 'Frostpeak_Table';
    table.add(top, rim, ring, pedestal, feet);
    this.root.add(table);
  }

  private buildChairs(): void {
    const geo = chairGeometry();
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const others = new Group();
    others.name = 'Frostpeak_Chairs';
    for (let slot = 0; slot < 4; slot++) {
      const chair = new Mesh(geo, mat);
      const a = seatAngle(slot);
      const r = SEAT_R + 0.06;
      chair.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      chair.rotation.y = a;
      chair.castShadow = true;
      chair.name = `Frostpeak_Chair_${slot}`;
      this.chairs.push(chair);
      // your own chair stays separate (mixed reality hides it); the other three are one draw
      (slot === 0 ? this.root : others).add(chair);
    }
    this.root.add(others);
    mergeStatic(others);
  }

  private buildSnow(): void {
    const count = 1600;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = Math.random() * 11;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 26;
      seed[i] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const snow = new Points(geo, this.snow);
    snow.frustumCulled = false;
    snow.renderOrder = 5;
    snow.name = 'Frostpeak_Snow';
    this.snowPoints = snow;
    this.decor.add(snow);
  }

  /** Soft banks of cloud drifting slowly along the mountain flanks across the valley. */
  private buildMist(): void {
    // a painterly cloud bank: soft puffs along a band, flatter underneath
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 160;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    for (let k = 0; k < 22; k++) {
      const u = k / 21;
      const x = 40 + u * 432 + noise(k * 1.7, 3.1) * 18;
      const edge = Math.sin(u * Math.PI);
      const r = (26 + 30 * edge) * (0.8 + 0.3 * (0.5 + 0.5 * noise(k * 2.3, 7.7)));
      const y = 104 - r * 0.45 + noise(k * 0.9, 1.3) * 6;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.55 * (0.4 + 0.6 * edge)})`);
      grad.addColorStop(0.6, `rgba(255,255,255,${0.3 * (0.4 + 0.6 * edge)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    for (let i = 0; i < 7; i++) {
      const mat = new SpriteMaterial({ map: tex, color: new Color('#f4f1ff'), transparent: true, depthWrite: false, opacity: 0.8, fog: true });
      const sprite = new Sprite(mat);
      // cloud banks hanging against the mountain flanks, above the plateau edge
      const radius = 80 + i * 10;
      const w = 80 + (i % 3) * 30;
      sprite.scale.set(w, w * 0.3, 1);
      sprite.renderOrder = 1;
      sprite.name = `Frostpeak_Mist_${i}`;
      this.mists.push({ sprite, speed: 0.008 + (i % 4) * 0.004, base: 8 + (i % 3) * 7, radius, angle: -0.9 + i * 0.3 });
      this.decor.add(sprite);
    }
  }

  /** A small flock circling the valley; wings flap in the vertex shader. */
  private buildBirds(): void {
    // one gull silhouette, drawn facing the viewer: an arched wing either side (inner panel
    // and a swept tip), 0.66 m across, so far birds read as the painted "M" from any angle
    const wing = [0, 0.02, 0, -0.02, -0.14, 0.02, 0, 0.02, -0.14, 0.02, -0.15, 0.065, -0.15, 0.065, -0.14, 0.02, -0.33, -0.03];
    const pos = new Float32Array(54); // 2 wings x 3 triangles x 3 vertices
    for (let v = 0; v < 9; v++) {
      pos[v * 3] = wing[v * 2];
      pos[v * 3 + 1] = wing[v * 2 + 1];
      pos[27 + v * 3] = -wing[v * 2]; // mirrored right wing
      pos[27 + v * 3 + 1] = wing[v * 2 + 1];
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new ShaderMaterial({
      side: 2,
      uniforms: { ...fogUniforms(), uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          // the wings beat up and down; the tips lag a little behind the elbows
          vec3 p = position;
          float id = float(gl_InstanceID);
          float beat = sin(uTime * 7.0 + id * 1.7);
          float lag = sin(uTime * 7.0 + id * 1.7 - 0.6);
          float ax = abs(p.x);
          p.y += min(ax, 0.15) * beat * 0.9 + max(ax - 0.15, 0.0) * lag * 1.4;
          vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec4 mv = viewMatrix * c;
          mv.xy += p.xy * s;
          vWorld = c.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_GLSL}
        varying vec3 vWorld;
        void main() {
          vec3 col = mix(vec3(0.16, 0.15, 0.22), uFogColor, fogAmount(length(cameraPosition - vWorld)));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const birds = new InstancedMesh(geo, mat, 7);
    birds.frustumCulled = false;
    birds.name = 'Frostpeak_Birds';
    this.birds = birds;
    this.birdMat = mat;
    this.decor.add(birds);
  }

  /** Nothing to download: the world is generated in the constructor. */
  async load(onProgress?: (k: number) => void): Promise<void> {
    onProgress?.(1);
  }

  /** Detach from the scene (the fog is ours) and free GPU memory, when switching worlds. */
  dispose(): void {
    if (this.sceneRef && this.sceneRef.fog === this.fog) this.sceneRef.fog = null;
    this.root.removeFromParent();
    disposeTree(this.root);
  }

  /** Mixed reality: keep the table, chairs and lights; let passthrough show your real room. */
  setMixedReality(on: boolean): void {
    this.mr = on;
    this.decor.visible = !on;
    if (this.chairs[0]) this.chairs[0].visible = !on;
    this.root.getObjectByName('Frostpeak_Deck')!.visible = !on;
    this.root.getObjectByName('Frostpeak_HangingLantern')!.visible = !on;
    if (this.sceneRef) this.sceneRef.fog = on ? null : this.fog;
  }

  /** Recolour the rune ring (the current colour to match). */
  setGlow(hex: number, power = 1): void {
    this.glowTarget.setHex(hex);
    this.glowPower = power;
  }

  /** Darken the sky for a dramatic moment (-1), restore (0), or warm it for a win (1). */
  setMood(m: -1 | 0 | 1): void {
    this.moodTarget = m;
  }

  /**
   * Lean rendering for a headset that cannot hold its frame rate: every other cloud bank (they
   * are large see-through layers, the costliest pixels here) and half the snowflakes.
   */
  setLean(on: boolean): void {
    this.mists.forEach((m, i) => (m.sprite.visible = !on || i % 2 === 0));
    this.snowPoints?.geometry.setDrawRange(0, on ? 800 : Infinity);
  }
  private snowPoints: Points | null = null;

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.snow.uniforms.uSpeed.value = on ? 0.35 : 1;
    this.snow.uniforms.uOpacity.value = on ? 0.45 : 0.85;
  }

  update(dt: number, t: number): void {
    // fog lives on the scene; attach it once the world is in one
    if (!this.sceneRef) {
      let s: Object3D = this.root;
      while (s.parent) s = s.parent;
      if ((s as Scene).isScene) {
        this.sceneRef = s as Scene;
        if (!this.mr) this.sceneRef.fog = this.fog;
      }
    }
    const time = this.reduced ? t * 0.4 : t;
    this.lake.uniforms.uTime.value = time;
    this.stream.uniforms.uTime.value = time;
    this.snow.uniforms.uTime.value = t;
    this.wind.value = time;
    for (const m of this.mists) {
      const a = m.angle + time * m.speed;
      // drift around the valley ahead, fading out at the ends of the arc
      const ahead = Math.sin(a);
      m.sprite.position.set(Math.sin(a) * m.radius, m.base + Math.sin(time * 0.05 + m.radius) * 1.5, -Math.abs(Math.cos(a)) * m.radius - 20);
      m.sprite.material.opacity = 0.85 * Math.max(0, 1 - Math.abs(ahead) * 0.9);
      if (a > Math.PI * 0.6) m.angle -= Math.PI * 1.2;
    }
    if (this.birds && this.birdMat) {
      this.birdMat.uniforms.uTime.value = t;
      for (let i = 0; i < 7; i++) {
        // a loose flock wheeling over the valley; each bird faces along its path
        const a = time * 0.09 + i * 0.35;
        const r = 24 + (i % 3) * 4;
        _p.set(Math.sin(a) * r, 12 + Math.sin(time * 0.4 + i) * 1.5 + (i % 2) * 1.2, -42 - Math.cos(a) * r * 0.5);
        // the silhouette faces the viewer in the shader, so only position and size matter here
        _q.identity();
        _s.setScalar(3.2);
        this.birds.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }

    const k = 1 - Math.exp(-dt * 4);
    this.glowColor.lerp(this.glowTarget, k);
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
    this.glowMat.color.copy(this.glowColor).multiplyScalar(Math.min(1.6, 0.9 * this.glowPower * pulse));

    const flicker = this.reduced ? 1 : 0.93 + 0.05 * Math.sin(t * 11.3) + 0.03 * Math.sin(t * 7.1 + 1.3);
    this.flameMat.color.setRGB(1, 0.76 * flicker, 0.48 * flicker);

    this.mood += (this.moodTarget - this.mood) * (1 - Math.exp(-dt * 3));
    const dim = this.mood < 0 ? 1 + this.mood * 0.5 : 1 + this.mood * 0.25;
    this.hemi.intensity = 1.25 * dim;
    this.key.intensity = 1.6 * (this.mood < 0 ? 1 + this.mood * 0.4 : 1 + this.mood * 0.2);
    this.lantern.intensity = 2.2 * flicker * (1 + Math.max(0, this.mood) * 0.3);
    this.sky.uniforms.uMood.value = this.mood;
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _up = new Vector3(0, 1, 0);
function place(x: number, y: number, z: number, scale: number, turn: number): Matrix4 {
  _q.setFromAxisAngle(_up, turn);
  _s.setScalar(scale);
  _p.set(x, y, z);
  return _m.compose(_p, _q, _s);
}
