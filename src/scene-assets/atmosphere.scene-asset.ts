import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture,
  DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, Points, PointsMaterial, ShaderMaterial,
} from '@iwsdk/core';

const RAIN_COUNT = 240;
const MIST_COUNT = 14;
const TRAFFIC_COUNT = 20;
const DUST_COUNT = 48;
const TAU = Math.PI * 2;

function random(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function softPoint(): DataTexture {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    const r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, 1 - r) ** 2 * 255);
  }
  const texture = new DataTexture(pixels, 32, 32);
  texture.needsUpdate = true;
  return texture;
}

function quads(centres: Float32Array, shapes: Float32Array): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('iCentre', new InstancedBufferAttribute(centres, 4));
  geometry.setAttribute('iShape', new InstancedBufferAttribute(shapes, 4));
  geometry.instanceCount = centres.length / 4;
  return geometry;
}

const RAIN_VERT = /* glsl */ `
attribute vec4 iCentre;
attribute vec4 iShape;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = position.xy + 0.5;
  vAlpha = iShape.w;
  float fall = fract(iCentre.w - uTime * iShape.z);
  float y = 0.22 + fall * 3.55;
  float wind = sin(uTime * 0.43 + iCentre.w * 6.283) * 0.035;
  vec3 p = vec3(iCentre.x + wind, y, iCentre.z);
  p.xy += position.xy * iShape.xy;
  // Wind leans each streak slightly; the world and the player's view stay still.
  p.x += position.y * iShape.y * 0.13;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  float width = exp(-pow((vUv.x - 0.5) * 4.8, 2.0));
  float tip = smoothstep(0.0, 0.17, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float alpha = width * tip * vAlpha;
  if (alpha < 0.008) discard;
  gl_FragColor = vec4(0.68, 0.82, 0.9, alpha);
  #include <colorspace_fragment>
}`;

const MIST_VERT = /* glsl */ `
attribute vec4 iCentre;
attribute vec4 iShape;
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
varying float vAlpha;
void main() {
  vUv = position.xy + 0.5;
  vPhase = iCentre.w;
  vAlpha = iShape.w;
  vec3 p = iCentre.xyz;
  p.x += sin(uTime * 0.075 + iCentre.w * 6.283) * 1.15;
  p.y += sin(uTime * 0.11 + iCentre.w * 11.0) * 0.07;
  p.xy += position.xy * iShape.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const MIST_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
varying float vAlpha;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
    mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 uv = vUv;
  vec2 flow = uv * vec2(6.0, 3.0) + vec2(uTime * 0.035 + vPhase * 10.0, 0.0);
  float n = noise(flow) * 0.65 + noise(flow * 2.13 + vec2(0.0, uTime * 0.02)) * 0.35;
  float envelope = pow(max(0.0, 1.0 - abs(uv.x * 2.0 - 1.0)), 0.65)
    * pow(max(0.0, 1.0 - abs(uv.y * 2.0 - 1.0)), 1.6);
  float alpha = smoothstep(0.2, 0.85, n) * envelope * vAlpha;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(0.35, 0.45, 0.5, alpha);
  #include <colorspace_fragment>
}`;

const TRAFFIC_VERT = /* glsl */ `
attribute vec4 iCentre;
attribute vec4 iShape;
uniform float uTime;
varying vec2 vUv;
varying float vDirection;
varying float vAlpha;
void main() {
  vUv = position.xy + 0.5;
  vDirection = iShape.z;
  vAlpha = iShape.w;
  float progress = fract(iCentre.w + uTime * 0.028 * iShape.z);
  vec3 p = vec3(mix(-11.0, 11.0, progress), iCentre.y, iCentre.z);
  p.xy += position.xy * iShape.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const TRAFFIC_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vDirection;
varying float vAlpha;
void main() {
  vec2 a = (vUv - vec2(0.40, 0.58)) * vec2(15.0, 5.5);
  vec2 b = (vUv - vec2(0.64, 0.58)) * vec2(15.0, 5.5);
  float lamps = exp(-dot(a, a)) + exp(-dot(b, b));
  // A short wet-road reflection below each pair, in the same distant lane.
  float reflection = exp(-pow((vUv.x - 0.52) * 5.0, 2.0))
    * exp(-pow((vUv.y - 0.32) * 9.0, 2.0)) * 0.22;
  float alpha = (lamps + reflection) * vAlpha;
  if (alpha < 0.006) discard;
  vec3 colour = vDirection > 0.0 ? vec3(1.0, 0.83, 0.59) : vec3(0.95, 0.27, 0.2);
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}`;

/** Rain, low window mist and distant street traffic, all outside the lounge.
 * Four draw calls, with deterministic geometry and no browser or world state.
 * Shader time keeps the weather alive even while the player is on a menu.
 */
export class LoungeAtmosphere {
  readonly group = new Group();
  private dustPositions = new Float32Array(DUST_COUNT * 3);
  private dustAttribute = new BufferAttribute(this.dustPositions, 3).setUsage(DynamicDrawUsage);
  private materials: ShaderMaterial[] = [];
  private reduced = false;
  private lastTick = -1;

  constructor() {
    this.group.name = 'Lounge atmosphere';
    const rainCentres = new Float32Array(RAIN_COUNT * 4);
    const rainShapes = new Float32Array(RAIN_COUNT * 4);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const p = i * 4;
      rainCentres.set([(random(i + 201) - 0.5) * 9.4, 0, -5.06 - random(i + 301) * 1.2, random(i + 1)], p);
      rainShapes.set([0.012 + random(i + 11) * 0.012, 0.15 + random(i + 401) * 0.18, 0.56 + random(i + 101) * 0.36, 0.26 + random(i + 51) * 0.24], p);
    }
    this.layer('Wind-driven rain outside glass', rainCentres, rainShapes, RAIN_VERT, RAIN_FRAG, false);

    const mistCentres = new Float32Array(MIST_COUNT * 4);
    const mistShapes = new Float32Array(MIST_COUNT * 4);
    for (let i = 0; i < MIST_COUNT; i++) {
      const p = i * 4;
      mistCentres.set([(random(i + 901) - 0.5) * 9, 0.15 + random(i + 921) * 0.85, -6.0 - random(i + 941) * 0.3, random(i + 961)], p);
      mistShapes.set([3.4 + random(i + 981) * 4.2, 0.65 + random(i + 1001) * 0.8, 0, 0.16 + random(i + 1021) * 0.12], p);
    }
    this.layer('Low drifting exterior mist', mistCentres, mistShapes, MIST_VERT, MIST_FRAG, false);

    const carCentres = new Float32Array(TRAFFIC_COUNT * 4);
    const carShapes = new Float32Array(TRAFFIC_COUNT * 4);
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const p = i * 4, lane = i % 4;
      carCentres.set([0, 0.25 + lane * 0.16, -6.1 - lane * 0.08, random(i + 1101)], p);
      carShapes.set([0.36 + random(i + 1121) * 0.14, 0.105, i % 2 ? -0.7 - random(i + 1141) * 0.4 : 0.7 + random(i + 1141) * 0.4, 0.65], p);
    }
    this.layer('Distant city traffic and wet-road glints', carCentres, carShapes, TRAFFIC_VERT, TRAFFIC_FRAG, true);

    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute('position', this.dustAttribute);
    const dust = new Points(dustGeometry, new PointsMaterial({ color: 0xf5d4a4, map: softPoint(), size: 0.011, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }));
    dust.name = 'Warm indoor light motes';
    this.exclude(dust);
    this.group.add(dust);
    this.update(0);
  }

  private exclude(object: Mesh | Points): void {
    object.frustumCulled = false;
    object.raycast = () => {};
    object.userData.iwsdkPreviewBounds = 'exclude';
  }

  private layer(name: string, centres: Float32Array, shapes: Float32Array, vertexShader: string, fragmentShader: string, additive: boolean): void {
    const material = new ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, toneMapped: false,
      ...(additive ? { blending: AdditiveBlending } : {}),
    });
    this.materials.push(material);
    const mesh = new Mesh(quads(centres, shapes), material);
    mesh.name = name;
    // Transparent room glass must remain behind these exterior layers in the
    // transparent pass; ordinary opaque walls still occlude them by depth.
    mesh.renderOrder = additive ? 2 : 1;
    this.exclude(mesh);
    this.group.add(mesh);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.group.visible = !on;
  }

  update(time: number): void {
    if (this.reduced) return;
    for (const material of this.materials) material.uniforms.uTime.value = time;
    if (time - this.lastTick < 1 / 30) return;
    this.lastTick = time;
    for (let i = 0; i < DUST_COUNT; i++) {
      const p = i * 3;
      const phase = random(i + 501) * TAU;
      this.dustPositions[p] = (random(i + 601) - 0.5) * 4.8 + Math.sin(time * 0.11 + phase) * 0.04;
      this.dustPositions[p + 1] = 1.05 + random(i + 701) * 1.7 + Math.sin(time * 0.16 + phase) * 0.04;
      this.dustPositions[p + 2] = -3.6 + random(i + 801) * 4;
    }
    this.dustAttribute.needsUpdate = true;
  }
}
