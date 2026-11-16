/**
 * Shared pieces for the Anime Arenas: a painted sky (gradient, stars, nebula, moons, clouds),
 * GPU-animated weather (petals, rain, motes, fireflies), waterfalls, cel shading, gold trim and
 * the magic-circle artwork. Everything is generated here: no downloads, no per-frame allocation.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshMatcapMaterial,
  MeshToonMaterial,
  NearestFilter,
  NormalBlending,
  Object3D,
  Points,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from '@iwsdk/core';
import { isKept, keep } from './util.js';

// ---------------------------------------------------------------- glsl helpers
export const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm2(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------- materials

let gradient: DataTexture | null = null;
/** Three hard light bands: the cel-shaded anime look for MeshToonMaterial. */
export function toonGradient(): DataTexture {
  if (gradient) return gradient;
  gradient = new DataTexture(new Uint8Array([90, 175, 255]), 3, 1, RedFormat);
  gradient.minFilter = gradient.magFilter = NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return keep(gradient);
}

/** Cel-shaded material with per-vertex colours (merged architecture). */
export function toon(opts: { emissive?: number; emissiveIntensity?: number } = {}): MeshToonMaterial {
  return new MeshToonMaterial({
    vertexColors: true,
    gradientMap: toonGradient(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

const matcaps = new Map<string, MeshMatcapMaterial>();
/**
 * Polished metal without lights or reflections: a painted sphere (matcap). Gold trim,
 * lacquer and chrome read as precious metal at no lighting cost.
 */
export function metal(kind: 'gold' | 'lacquer' | 'silver' | 'jade'): MeshMatcapMaterial {
  let m = matcaps.get(kind);
  if (m) return m;
  const stops: Record<string, [string, string, string, string]> = {
    gold: ['#fff7d6', '#f2c75c', '#a8741c', '#3f2706'],
    lacquer: ['#ffd0c4', '#d8352a', '#7a0f12', '#2a0306'],
    silver: ['#ffffff', '#c9d2e6', '#6c7590', '#1d2131'],
    jade: ['#e8fff4', '#5fd1a5', '#1f7a5e', '#08261c'],
  };
  const [hi, mid, lo, rim] = stops[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const base = g.createRadialGradient(100, 86, 6, 128, 128, 128);
  base.addColorStop(0, hi);
  base.addColorStop(0.28, mid);
  base.addColorStop(0.78, lo);
  base.addColorStop(1, rim);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // a second, cooler bounce light along the lower rim
  const bounce = g.createRadialGradient(170, 210, 4, 170, 210, 90);
  bounce.addColorStop(0, 'rgba(255,255,255,0.35)');
  bounce.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = bounce;
  g.fillRect(0, 0, 256, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  m = keep(new MeshMatcapMaterial({ matcap: keep(tex) }));
  matcaps.set(kind, m);
  return m;
}

// ---------------------------------------------------------------- sky
export interface SkyLook {
  top: string;
  mid: string;
  horizon: string;
  below: string;
  stars: number;
  nebula: number;
  nebulaColor: string;
  clouds: number;
  cloudColor: string;
  moonDir: Vector3;
  moonColor: string;
  moonSize: number;
  moonGlow: number;
  moon2Dir: Vector3;
  moon2Color: string;
  moon2Size: number;
}

export function skyMaterial(look: SkyLook): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new Color(look.top) },
      uMid: { value: new Color(look.mid) },
      uHorizon: { value: new Color(look.horizon) },
      uBelow: { value: new Color(look.below) },
      uStars: { value: look.stars },
      uNebula: { value: look.nebula },
      uNebulaColor: { value: new Color(look.nebulaColor) },
      uClouds: { value: look.clouds },
      uCloudColor: { value: new Color(look.cloudColor) },
      uMoonDir: { value: look.moonDir.clone().normalize() },
      uMoonColor: { value: new Color(look.moonColor) },
      uMoonSize: { value: look.moonSize },
      uMoonGlow: { value: look.moonGlow },
      uMoon2Dir: { value: look.moon2Dir.clone().normalize() },
      uMoon2Color: { value: new Color(look.moon2Color) },
      uMoon2Size: { value: look.moon2Size },
      uTime: { value: 0 },
      uDim: { value: 1 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uBelow, uNebulaColor, uCloudColor, uMoonColor, uMoon2Color;
      uniform vec3 uMoonDir, uMoon2Dir;
      uniform float uStars, uNebula, uClouds, uMoonSize, uMoonGlow, uMoon2Size, uTime, uDim, uFlash;
      varying vec3 vDir;
      ${NOISE_GLSL}
      vec3 moon(vec3 col, vec3 d, vec3 dir, vec3 tint, float size, float glow) {
        if (size <= 0.0) return col;
        float m = dot(d, dir);
        float disc = smoothstep(cos(size), cos(size * 0.965), m);
        vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
        vec3 up = cross(side, dir);
        vec2 q = vec2(dot(d, side), dot(d, up)) / size;
        float maria = fbm2(q * 2.6 + 3.0);
        float craters = smoothstep(0.62, 0.7, vnoise(q * 9.0)) * 0.12;
        float shade = 0.78 + 0.22 * smoothstep(0.2, 0.75, maria) - craters;
        // a soft terminator: the lit edge faces up and to the side
        shade *= 0.82 + 0.18 * smoothstep(-1.0, 0.6, q.x + q.y);
        col = mix(col, tint * shade, disc);
        float halo = pow(max(m, 0.0), 2600.0 / (size * size * 400.0 + 1.0)) * 0.55 + pow(max(m, 0.0), 40.0) * 0.16;
        return col + tint * halo * glow;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float az = atan(d.x, d.z);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, h));
        col = mix(col, uTop, smoothstep(0.3, 0.95, h));
        col = mix(uBelow, col, smoothstep(-0.14, 0.02, h));
        if (uNebula > 0.0) {
          float n = fbm2(vec2(az * 1.6 + uTime * 0.003, h * 5.0));
          float band = smoothstep(0.08, 0.4, h) * smoothstep(0.95, 0.45, h);
          col += uNebulaColor * pow(n, 2.6) * band * uNebula;
        }
        if (uStars > 0.0) {
          vec3 q = d * 300.0;
          vec3 cell = floor(q);
          float r = hash13(cell);
          float s = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(q) - 0.5));
          float tw = 0.55 + 0.45 * sin(uTime * (1.2 + r * 3.0) + r * 70.0);
          col += vec3(1.0, 0.95, 0.88) * s * tw * uStars * smoothstep(0.02, 0.22, h) * (0.6 + 0.8 * fract(r * 91.7));
        }
        if (uClouds > 0.0) {
          float n = fbm2(vec2(az * 2.4 + uTime * 0.004, h * 7.5 - uTime * 0.002));
          float band = smoothstep(0.5, 0.03, h) * smoothstep(-0.08, 0.04, h);
          float c = smoothstep(0.42, 0.72, n) * band;
          col = mix(col, uCloudColor * (0.85 + 0.25 * n), c * uClouds);
        }
        col = moon(col, d, uMoonDir, uMoonColor, uMoonSize, uMoonGlow);
        col = moon(col, d, uMoon2Dir, uMoon2Color, uMoon2Size, 0.5);
        col = col * uDim + vec3(1.0, 0.92, 0.7) * uFlash;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- weather
export type WeatherKind = 'petal' | 'rain' | 'mote' | 'firefly' | 'lantern';

/**
 * A field of particles animated entirely on the GPU: `count` points in a box around the table.
 * Petals tumble and drift, rain streaks down, motes rise, fireflies wander and pulse.
 */
export function weather(kind: WeatherKind, count: number, half: number, base: number, height: number, seed = 1): Points {
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < count; i++) {
    // keep a clear column over the table itself for rain, so cards never hide behind streaks
    let x = (rnd() * 2 - 1) * half;
    let z = (rnd() * 2 - 1) * half;
    if (kind === 'rain' && x * x + z * z < 2.2) {
      x *= 2.2;
      z *= 2.2;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = rnd() * height;
    pos[i * 3 + 2] = z;
    seeds[i] = rnd();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  const defines: Record<string, string> = { [kind.toUpperCase()]: '1' };
  const size = { petal: 0.05, rain: 0.09, mote: 0.03, firefly: 0.035, lantern: 0.5 }[kind];
  const mat = new ShaderMaterial({
    defines,
    transparent: true,
    depthWrite: false,
    blending: kind === 'petal' ? NormalBlending : AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uSize: { value: size },
      uBase: { value: base },
      uHeight: { value: height },
      uOpacity: { value: 1 },
      uPixel: { value: 900 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uSpeed, uSize, uBase, uHeight, uPixel;
      varying float vFade;
      varying float vSeed;
      varying float vAngle;
      void main() {
        vec3 p = position;
        float t = uTime * uSpeed;
        vAngle = 0.0;
        #ifdef PETAL
          p.y = uBase + mod(p.y - t * (0.22 + aSeed * 0.22), uHeight);
          p.x += sin(t * 0.7 + aSeed * 40.0) * 0.7 + sin(t * 0.23 + aSeed * 9.0) * 0.4;
          p.z += cos(t * 0.55 + aSeed * 23.0) * 0.5;
          vAngle = t * (1.2 + aSeed * 2.2) + aSeed * 6.283;
        #endif
        #ifdef RAIN
          p.y = uBase + mod(p.y - t * (8.0 + aSeed * 3.0), uHeight);
        #endif
        #ifdef MOTE
          p.y = uBase + mod(p.y + t * (0.12 + aSeed * 0.18), uHeight);
          p.x += sin(t * 0.45 + aSeed * 30.0) * 0.35;
          p.z += cos(t * 0.38 + aSeed * 12.0) * 0.35;
        #endif
        #ifdef FIREFLY
          p += vec3(sin(t * 0.37 + aSeed * 17.0) * 0.9, sin(t * 0.61 + aSeed * 9.0) * 0.35, cos(t * 0.31 + aSeed * 29.0) * 0.9);
        #endif
        #ifdef LANTERN
          p.y = uBase + mod(p.y + t * (0.25 + aSeed * 0.25), uHeight);
          p.x += sin(t * 0.11 + aSeed * 20.0) * 2.0;
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(uSize * (0.65 + aSeed * 0.7) * uPixel / max(d, 0.4), 1.0, 30.0);
        vFade = smoothstep(0.35, 1.3, d) * (1.0 - smoothstep(uHeight * 1.6, uHeight * 2.4 + 8.0, d));
        vSeed = aSeed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity;
      varying float vFade;
      varying float vSeed;
      varying float vAngle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        vec4 col = vec4(0.0);
        #ifdef PETAL
          float ca = cos(vAngle); float sa = sin(vAngle);
          vec2 q = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
          // a petal flips as it tumbles: its width breathes
          float w = 0.22 + 0.14 * abs(sin(vAngle * 0.7));
          float e = (q.x * q.x) / 0.21 + (q.y * q.y) / (w * w);
          float a = smoothstep(1.0, 0.75, e);
          vec3 lilac = vec3(0.78, 0.6, 1.0);
          vec3 pink = vec3(1.0, 0.72, 0.9);
          col = vec4(mix(lilac, pink, vSeed) * (0.85 + 0.3 * q.y), a * 0.92);
        #endif
        #ifdef RAIN
          float a = smoothstep(0.05, 0.0, abs(c.x)) * smoothstep(0.5, 0.05, abs(c.y)) * 0.55;
          col = vec4(vec3(0.72, 0.8, 1.0) * a, a);
        #endif
        #ifdef MOTE
          float r = length(c);
          float tw = 0.6 + 0.4 * sin(uTime * 2.5 + vSeed * 40.0);
          float a = (smoothstep(0.5, 0.0, r) * 0.5 + smoothstep(0.12, 0.0, r)) * tw;
          col = vec4(vec3(1.0, 0.82, 0.42) * a, a);
        #endif
        #ifdef LANTERN
          // a paper sky lantern: a warm rounded body and a soft halo, fading near the top
          float body = smoothstep(0.2, 0.14, abs(c.x)) * smoothstep(0.26, 0.18, abs(c.y + 0.02));
          float halo = smoothstep(0.5, 0.0, length(c)) * 0.45;
          float a = max(body, halo);
          vec3 tint = mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.82, 0.45), body);
          col = vec4(tint * a, a);
        #endif
        #ifdef FIREFLY
          float r = length(c);
          float pulse = pow(0.5 + 0.5 * sin(uTime * (1.6 + vSeed * 1.4) + vSeed * 30.0), 3.0);
          float a = (smoothstep(0.5, 0.0, r) * 0.6 + smoothstep(0.1, 0.0, r)) * pulse;
          col = vec4(vec3(0.85, 1.0, 0.55) * a, a);
        #endif
        col.a *= vFade * uOpacity;
        #ifndef PETAL
          col.rgb *= vFade * uOpacity;
        #endif
        if (col.a < 0.01) discard;
        gl_FragColor = col;
      }`,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = `Arena_Weather_${kind}`;
  pts.renderOrder = 4;
  return pts;
}

// ---------------------------------------------------------------- water
/** A falling sheet of water: streaks run down, foam boils at the bottom, edges feather out. */
export function waterfallMaterial(light = '#dff3ff', deep = '#6aa6d8'): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: new Color(light) }, uDeep: { value: new Color(deep) } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uLight, uDeep;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        float flow = vUv.y * 5.0 + uTime * 1.4;
        float streak = vnoise(vec2(vUv.x * 34.0, flow)) * 0.7 + vnoise(vec2(vUv.x * 90.0, flow * 2.2)) * 0.3;
        float foam = smoothstep(0.22, 0.0, vUv.y) * (0.6 + 0.4 * vnoise(vec2(vUv.x * 20.0, uTime * 3.0)));
        vec3 col = mix(uDeep, uLight, smoothstep(0.35, 0.85, streak)) + foam * 0.5;
        float a = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x) * (0.7 + 0.3 * streak);
        a = max(a, foam * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x));
        gl_FragColor = vec4(col, a * 0.92);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** Still night water: deep colour, slow ripples and a long shimmering reflection of the moon. */
export function pondMaterial(deep: string, shallow: string, moonDir: Vector3, moonColor: string): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uTime: { value: 0 }, uDeep: { value: new Color(deep) }, uShallow: { value: new Color(shallow) }, uMoonDir: { value: moonDir.clone().normalize() }, uMoon: { value: new Color(moonColor) } },
    ]),
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
      uniform vec3 uDeep, uShallow, uMoonDir, uMoon;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vWorld.xz;
        float n = vnoise(p * 0.35 + vec2(uTime * 0.12, 0.0)) + vnoise(p * 0.9 - vec2(0.0, uTime * 0.18)) * 0.5;
        vec3 nrm = normalize(vec3((n - 0.75) * 0.18, 1.0, (vnoise(p * 0.5 + 7.0 + uTime * 0.1) - 0.5) * 0.18));
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 r = reflect(view, nrm);
        float spec = pow(max(dot(r, uMoonDir), 0.0), 60.0);
        float fres = pow(1.0 - max(dot(-view, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, fres * 0.8) + uMoon * spec * 1.4;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- artwork
/** A tiny deterministic generator for canvas artwork. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

/** One invented rune: a few strokes in a small cell (no font needed, nothing copied). */
function rune(g: CanvasRenderingContext2D, size: number, rnd: () => number): void {
  const pts: [number, number][] = [
    [-0.5, -0.5], [0, -0.5], [0.5, -0.5], [-0.5, 0], [0, 0], [0.5, 0], [-0.5, 0.5], [0, 0.5], [0.5, 0.5],
  ];
  const strokes = 2 + Math.floor(rnd() * 3);
  g.beginPath();
  let [x, y] = pts[Math.floor(rnd() * 9)];
  g.moveTo(x * size, y * size);
  for (let k = 0; k < strokes; k++) {
    [x, y] = pts[Math.floor(rnd() * 9)];
    g.lineTo(x * size, y * size);
  }
  if (rnd() < 0.35) {
    g.moveTo(size * 0.18, 0);
    g.arc(0, 0, size * 0.18, 0, Math.PI * 2);
  }
  g.stroke();
}

/** Draw a ring of runes between two radii. */
function runeBand(g: CanvasRenderingContext2D, r: number, count: number, size: number, rnd: () => number): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.translate(0, -r);
    rune(g, size, rnd);
    g.restore();
  }
}

const circles = new Map<string, CanvasTexture>();
/**
 * A summoning circle: double rings, rune bands, an inscribed star and small orbs. Drawn white,
 * so a material colour tints it. `style` varies the geometry (0 hexagram, 1 octagram, 2 seal).
 */
export function magicCircleTexture(style: 0 | 1 | 2 = 0, size = 1024, seed = 7): CanvasTexture {
  const key = `${style}:${size}:${seed}`;
  const hit = circles.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const R = size * 0.48;
  const rnd = seeded(seed);
  g.translate(size / 2, size / 2);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  g.shadowBlur = size * 0.012;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const ring = (r: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  ring(R, size * 0.007);
  ring(R * 0.955, size * 0.003);
  g.lineWidth = size * 0.0035;
  runeBand(g, R * 0.89, 40, R * 0.06, rnd);
  ring(R * 0.82, size * 0.004);
  // the star
  const pointsN = style === 1 ? 8 : 6;
  const starR = R * 0.8;
  g.lineWidth = size * 0.0045;
  g.beginPath();
  const step = style === 1 ? 3 : 2;
  for (let k = 0; k <= pointsN; k++) {
    const a = ((k * step) % pointsN) / pointsN * Math.PI * 2 - Math.PI / 2;
    if (k === 0) g.moveTo(Math.cos(a) * starR, Math.sin(a) * starR);
    else g.lineTo(Math.cos(a) * starR, Math.sin(a) * starR);
  }
  if (style === 0) {
    // a hexagram is two triangles
    g.moveTo(Math.cos(-Math.PI / 2) * starR, Math.sin(-Math.PI / 2) * starR);
    for (let k = 1; k <= 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * starR, Math.sin(a) * starR);
    }
    g.moveTo(Math.cos(Math.PI / 2) * starR, Math.sin(Math.PI / 2) * starR);
    for (let k = 1; k <= 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      g.lineTo(Math.cos(a) * starR, Math.sin(a) * starR);
    }
  }
  g.stroke();
  // orbs at the star's points
  for (let k = 0; k < pointsN; k++) {
    const a = (k / pointsN) * Math.PI * 2 - Math.PI / 2;
    g.lineWidth = size * 0.004;
    g.beginPath();
    g.arc(Math.cos(a) * starR, Math.sin(a) * starR, R * 0.055, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(Math.cos(a) * starR, Math.sin(a) * starR, R * 0.018, 0, Math.PI * 2);
    g.fill();
  }
  ring(R * 0.46, size * 0.004);
  g.lineWidth = size * 0.003;
  runeBand(g, R * 0.4, 20, R * 0.05, rnd);
  ring(R * 0.33, size * 0.003);
  if (style === 2) {
    // a seal: a bold slash through the centre
    g.lineWidth = size * 0.03;
    g.beginPath();
    g.moveTo(-R * 0.26, R * 0.26);
    g.lineTo(R * 0.26, -R * 0.26);
    g.stroke();
    ring(R * 0.3, size * 0.022);
  } else {
    ring(R * 0.12, size * 0.005);
    g.beginPath();
    g.arc(0, 0, R * 0.04, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  circles.set(key, keep(tex));
  return tex;
}

/** Wisteria clusters in gold leaf, for table and banner artwork. */
export function wisteriaSpray(g: CanvasRenderingContext2D, x: number, y: number, len: number, color: string, rnd: () => number): void {
  g.save();
  g.fillStyle = color;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const r = len * 0.075 * (1 - k * 0.65);
    const px = x + Math.sin(k * 5 + rnd()) * len * 0.05;
    const py = y + k * len;
    for (let j = -1; j <= 1; j += 2) {
      g.beginPath();
      g.ellipse(px + j * r * 0.9, py, r, r * 0.7, j * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** Dark obsidian marble with gold rings, rune band and wisteria: the arena table top. */
export function tableTopTexture(base: string, vein: string, gold: string, seed = 3): CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const rnd = seeded(seed);
  const bg = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.55);
  bg.addColorStop(0, base);
  bg.addColorStop(1, '#05040c');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  // veins
  g.globalAlpha = 0.18;
  g.strokeStyle = vein;
  for (let i = 0; i < 26; i++) {
    g.lineWidth = 0.6 + rnd() * 2.4;
    g.beginPath();
    let x = rnd() * S;
    let y = rnd() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      const nx = x + (rnd() - 0.4) * 260;
      const ny = y + (rnd() - 0.5) * 180;
      g.quadraticCurveTo((x + nx) / 2 + (rnd() - 0.5) * 120, (y + ny) / 2 + (rnd() - 0.5) * 120, nx, ny);
      x = nx;
      y = ny;
    }
    g.stroke();
  }
  // starlight specks in the stone
  g.globalAlpha = 1;
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(255,240,210,${0.15 + rnd() * 0.5})`;
    const r = rnd() * 1.4;
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  g.translate(S / 2, S / 2);
  g.strokeStyle = gold;
  g.fillStyle = gold;
  g.shadowColor = 'rgba(255,200,90,0.6)';
  g.shadowBlur = 6;
  const ring = (r: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  const R = S / 2;
  ring(R * 0.975, 7);
  ring(R * 0.94, 2);
  // wisteria sprays hanging inward from the outer band
  for (let i = 0; i < 12; i++) {
    g.save();
    g.rotate((i / 12) * Math.PI * 2 + 0.13);
    g.translate(0, -R * 0.93);
    wisteriaSpray(g, 0, 0, R * 0.17, i % 2 ? 'rgba(232,190,110,0.85)' : 'rgba(196,150,255,0.55)', rnd);
    g.restore();
  }
  ring(R * 0.7, 2.5);
  g.lineWidth = 2;
  runeBand(g, R * 0.665, 48, R * 0.035, rnd);
  ring(R * 0.63, 2.5);
  // a swirl of gold filaments, like the reference table's inlay
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2);
    g.beginPath();
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const r = R * (0.2 + t * 0.4);
      const a = t * 2.6;
      if (k === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke();
    g.restore();
  }
  ring(R * 0.19, 3);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Floor slabs laid in rings, with gold inlay circles around the table. */
export function floorTexture(stone: string, joint: string, inlay: string, seed = 5): CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const rnd = seeded(seed);
  g.fillStyle = joint;
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const R = S / 2;
  const base = new Color(stone);
  const tmp = new Color();
  // concentric courses of slabs
  for (let ring = 0; ring < 9; ring++) {
    const r0 = R * (0.16 + ring * 0.1);
    const r1 = r0 + R * 0.096;
    const n = 8 + ring * 6;
    const off = rnd();
    for (let k = 0; k < n; k++) {
      const a0 = ((k + off) / n) * Math.PI * 2 + 0.004;
      const a1 = ((k + 1 + off) / n) * Math.PI * 2 - 0.004;
      tmp.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
      g.fillStyle = `#${tmp.getHexString()}`;
      g.beginPath();
      g.arc(0, 0, r1, a0, a1);
      g.arc(0, 0, r0, a1, a0, true);
      g.closePath();
      g.fill();
    }
  }
  // the inner disc under the table
  g.fillStyle = stone;
  g.beginPath();
  g.arc(0, 0, R * 0.155, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = inlay;
  g.shadowColor = inlay;
  g.shadowBlur = 4;
  for (const [r, w] of [[0.155, 4], [0.36, 3], [0.37, 1.5], [0.96, 5]] as const) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, R * r, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Glowing paper panels (shoji) or lit windows: a warm grid on a canvas. */
export function shojiTexture(cols = 4, rows = 6, paper = '#ffd9a0', frame = '#3a1d10'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, paper);
  grad.addColorStop(1, '#ffb15e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 384);
  g.strokeStyle = frame;
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 376);
  g.lineWidth = 4;
  for (let i = 1; i < cols; i++) {
    g.beginPath();
    g.moveTo((i * 256) / cols, 0);
    g.lineTo((i * 256) / cols, 384);
    g.stroke();
  }
  for (let j = 1; j < rows; j++) {
    g.beginPath();
    g.moveTo(0, (j * 384) / rows);
    g.lineTo(256, (j * 384) / rows);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** A glowing neon sign: bright core, coloured tube glow, on transparent. */
export function neonTexture(text: string, color: string, vertical = false): CanvasTexture {
  const c = document.createElement('canvas');
  const long = 512;
  const short = 160;
  c.width = vertical ? short : long;
  c.height = vertical ? long : short;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...text];
  const fontPx = vertical ? Math.min(118, (long - 40) / chars.length) : Math.min(120, (long - 40) / (chars.length * 0.62));
  g.font = `800 ${Math.floor(fontPx)}px "Yu Gothic UI", "Meiryo", "Noto Sans JP", "Segoe UI", sans-serif`;
  const draw = (blur: number, style: string, width: number) => {
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.strokeStyle = style;
    g.lineWidth = width;
    g.fillStyle = style;
    if (vertical) chars.forEach((ch, i) => g.fillText(ch, short / 2, 20 + fontPx * (i + 0.5)));
    else g.fillText(text, long / 2, short / 2 + 4);
  };
  draw(28, color, 6);
  draw(10, color, 3);
  draw(0, '#ffffff', 1);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A hanging cloth banner with a gold emblem (a stylised AFTERHOURS crest, not any real mark). */
export function bannerTexture(cloth: string, trim: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 640;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 0, 640);
  grad.addColorStop(0, cloth);
  grad.addColorStop(1, '#1a0d2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 640);
  g.strokeStyle = trim;
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 612);
  // the crest: a crescent around a four-point star
  g.translate(128, 250);
  g.fillStyle = trim;
  g.beginPath();
  g.arc(0, 0, 70, 0.6, Math.PI * 2 - 0.6);
  g.arc(18, 0, 56, Math.PI * 2 - 0.75, 0.75, true);
  g.fill();
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const r = k % 2 ? 9 : 36;
    const a = (k / 8) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r + 6, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.setTransform(1, 0, 0, 1, 0, 0);
  // a pointed hem
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, 560);
  g.lineTo(128, 640);
  g.lineTo(0, 640);
  g.closePath();
  g.moveTo(256, 560);
  g.lineTo(128, 640);
  g.lineTo(256, 640);
  g.closePath();
  g.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Free every geometry, material and texture under an object. */
export function disposeTree(o: Object3D): void {
  const seen = new Set<unknown>();
  o.traverse((c) => {
    const m = c as Mesh;
    // shared, cached resources (cards, toon ramp, metals, magic circles) stay for the next world
    if (m.geometry && !seen.has(m.geometry) && !isKept(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (seen.has(mat) || isKept(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) {
        if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture && !seen.has(v) && !isKept(v)) {
          seen.add(v);
          (v as { dispose(): void }).dispose();
        }
      }
      mat.dispose();
    }
  });
}
