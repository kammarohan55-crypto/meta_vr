/**
 * Immediate-mode instanced quads. One draw call covers every halo, mote,
 * bubble, sparkle, star and ring in the scene; a second covers the soft
 * ground shadows. Emitters push quads each frame between begin() and end().
 */
import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from '@iwsdk/core';

export type QuadMode = 'glow' | 'ground' | 'shadow';

/** Fragment shapes selected per quad. */
export const SHAPE_HALO = 0;
export const SHAPE_DOT = 1;
export const SHAPE_RING = 2;
export const SHAPE_SPARK = 3;

const VERT = /* glsl */ `
attribute vec3 iCenter;
attribute vec4 iColor;
attribute vec2 iParam;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vUv = position.xy * 2.0;
  vColor = iColor;
  vShape = iParam.y;
  #ifdef FLAT
    vec3 p = iCenter + vec3(position.x, 0.0, position.y) * iParam.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #else
    vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
    float s = length(modelMatrix[0].xyz);
    mv.xy += position.xy * iParam.x * s;
    gl_Position = projectionMatrix * mv;
  #endif
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float a;
  if (vShape < 0.5) {
    a = pow(1.0 - d, 2.4);
  } else if (vShape < 1.5) {
    a = smoothstep(1.0, 0.5, d);
  } else if (vShape < 2.5) {
    a = smoothstep(0.8, 0.9, d) * smoothstep(1.0, 0.93, d) + pow(d, 6.0) * 0.12;
  } else {
    vec2 q = abs(vUv);
    float star = max(0.0, 1.0 - (q.x * q.y * 60.0 + d));
    a = star * star + pow(1.0 - d, 7.0) * 0.6;
  }
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class QuadField {
  readonly mesh: Mesh;
  readonly max: number;
  count = 0;
  private geo: InstancedBufferGeometry;
  private center: Float32Array;
  private color: Float32Array;
  private param: Float32Array;
  private aCenter: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private aParam: InstancedBufferAttribute;

  constructor(max: number, mode: QuadMode) {
    this.max = max;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.center = new Float32Array(max * 3);
    this.color = new Float32Array(max * 4);
    this.param = new Float32Array(max * 2);
    this.aCenter = new InstancedBufferAttribute(this.center, 3);
    this.aColor = new InstancedBufferAttribute(this.color, 4);
    this.aParam = new InstancedBufferAttribute(this.param, 2);
    this.aCenter.setUsage(DynamicDrawUsage);
    this.aColor.setUsage(DynamicDrawUsage);
    this.aParam.setUsage(DynamicDrawUsage);
    geo.setAttribute('iCenter', this.aCenter);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iParam', this.aParam);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: mode === 'glow' ? {} : { FLAT: 1 },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: mode === 'shadow' ? NormalBlending : AdditiveBlending,
    });
    if (mode !== 'glow') {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
    }
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 'shadow' ? 1 : 10;
    this.mesh.name = `fx-${mode}`;
    // Never let helper quads steal pointer hits or grabs.
    this.mesh.raycast = () => {};
  }

  begin(): void {
    this.count = 0;
  }

  add(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    a: number,
    shape = SHAPE_HALO,
  ): void {
    const i = this.count;
    if (i >= this.max || a <= 0.002 || size <= 0) return;
    this.center[i * 3] = x;
    this.center[i * 3 + 1] = y;
    this.center[i * 3 + 2] = z;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
    this.param[i * 2] = size;
    this.param[i * 2 + 1] = shape;
    this.count = i + 1;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    const n = this.count;
    this.aCenter.clearUpdateRanges();
    this.aColor.clearUpdateRanges();
    this.aParam.clearUpdateRanges();
    if (n > 0) {
      this.aCenter.addUpdateRange(0, n * 3);
      this.aColor.addUpdateRange(0, n * 4);
      this.aParam.addUpdateRange(0, n * 2);
      this.aCenter.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aParam.needsUpdate = true;
    }
  }
}
