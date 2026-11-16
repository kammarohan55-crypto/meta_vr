import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3,
  CylinderGeometry, DataTexture, DoubleSide, Group, LatheGeometry, Matrix4,
  Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  RepeatWrapping, RingGeometry, ShaderMaterial, SRGBColorSpace, TorusGeometry,
  TubeGeometry, Vector2, Vector3,
} from '@iwsdk/core';

const Y = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const TABLE = 0.74;
const DETAIL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
}`;
const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  float sway = sin(uTime * 2.7 + y * 4.0) * 0.035 * y;
  float x = vUv.x - 0.5 - sway;
  float taper = 0.19 * pow(max(0.0, 1.0 - y), 0.65) + 0.006;
  float flame = exp(-pow(x / taper, 2.0) * 2.0) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.65, 1.0, y));
  vec3 c = mix(vec3(1.0, 0.57, 0.14), vec3(1.0, 0.92, 0.65), exp(-abs(x) * 40.0) * (1.0 - y));
  gl_FragColor = vec4(c, flame * 0.88);
  #include <colorspace_fragment>
}`;
const STEAM_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  float curl = sin(y * 9.0 - uTime * 0.9) * 0.11 + sin(y * 17.0 + uTime * 0.6) * 0.035;
  float x = vUv.x - 0.5 - curl;
  float w = 0.045 + y * 0.11;
  float a = exp(-x * x / (w * w)) * sin(y * 3.14159) * 0.13;
  gl_FragColor = vec4(0.8, 0.81, 0.78, a);
  #include <colorspace_fragment>
}`;

function texture(kind: 'wood' | 'linen'): DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = Math.sin(x * 19.13 + y * 73.61) * 43758.54;
    const grain = n - Math.floor(n);
    const v = kind === 'wood' ? 0.82 + Math.sin(x * 0.9 + Math.sin(y * 0.08) * 0.7) * 0.1 + grain * 0.08
      : 0.85 + Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) * 0.06 + grain * 0.05;
    const p = (y * size + x) * 4;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = Math.round(v * 255);
    pixels[p + 3] = 255;
  }
  const t = new DataTexture(pixels, size, size);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(kind === 'wood' ? 3 : 5, kind === 'wood' ? 0.8 : 5);
  t.needsUpdate = true;
  return t;
}

/** Local Y follows the leaf stem. A cupped continuous blade has a raised
 * midrib, swept edges and a pointed tip, rather than flat cut-out planes. */
function leafGeometry(): BufferGeometry {
  const p: number[] = [], uv: number[] = [], indices: number[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const width = Math.max(0.00025, Math.sin(Math.PI * t) ** 0.8 * (0.062 + t * 0.018));
    for (const side of [-1, 0, 1]) {
      p.push(side * width, t * 0.31, Math.sin(t * Math.PI) * 0.016 - Math.abs(side) * width * 0.23 + t * t * 0.028);
      uv.push((side + 1) / 2, t);
    }
    if (i < steps) for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

/** Additive architectural furnishing. Origin: floor under the card table;
 * +Y is up, the city window is at -Z. All static pieces merge by material.
 * No lights or shadows are added. Only the small candle/coffee steam animates.
 */
export class InteriorDetails {
  readonly group = new Group();
  private batches = new Map<MeshStandardMaterial, BufferGeometry[]>();
  private motionMaterials: ShaderMaterial[] = [];
  private reduced = false;
  private wood = new MeshStandardMaterial({ name: 'Smoked fluted walnut', color: 0x352720, map: texture('wood'), roughness: 0.68 });
  private charcoal = new MeshStandardMaterial({ name: 'Satin charcoal metal', color: 0x151c1e, metalness: 0.65, roughness: 0.42 });
  private brass = new MeshStandardMaterial({ name: 'Brushed champagne brass', color: 0xb49a62, metalness: 0.92, roughness: 0.35, envMapIntensity: 1.05 });
  private ceramic = new MeshStandardMaterial({ name: 'Handmade charcoal ceramic', color: 0x333e3c, roughness: 0.72 });
  private soil = new MeshStandardMaterial({ name: 'Dark potting soil', color: 0x1a1712, roughness: 1 });
  private foliage = new MeshStandardMaterial({ name: 'Ficus deep green', color: 0x294735, roughness: 0.6, side: DoubleSide });
  private foliageLight = new MeshStandardMaterial({ name: 'Ficus sage highlights', color: 0x4b6340, roughness: 0.65, side: DoubleSide });
  private linen = new MeshStandardMaterial({ name: 'Woven oatmeal linen', color: 0xbbb09a, map: texture('linen'), roughness: 0.95 });
  private wax = new MeshStandardMaterial({ name: 'Ivory candle wax', color: 0xd7c3a0, roughness: 0.86 });
  private diffuser = new MeshStandardMaterial({ name: 'Warm opal diffuser', color: 0xead8b5, emissive: 0xffd9a0, emissiveIntensity: 1.55, roughness: 0.7 });
  private glass = new MeshPhysicalMaterial({ name: 'Smoked candle glass', color: 0x8a6a40, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide });

  constructor(includeSideWalls = true) {
    this.group.name = 'Architectural lounge details';
    this.pendant();
    if (includeSideWalls) { this.wall(-1); this.wall(1); }
    this.planter(-2.65, -3.85, 0.1);
    this.planter(2.7, -3.85, 1.7);
    this.tableDetails();
    this.mergeBatches();
    this.billboard('Quiet candle flame', FLAME_FRAGMENT, -0.52, TABLE + 0.115, -0.12, 0.023, 0.047, true);
    this.billboard('Steam above coffee', STEAM_FRAGMENT, 0.5, TABLE + 0.185, -0.2, 0.055, 0.17, false);
    this.update(0);
  }

  private place(material: MeshStandardMaterial, geometry: BufferGeometry, x: number, y: number, z: number,
    sx = 1, sy = 1, sz = 1, rotation?: Quaternion): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(new Matrix4().compose(new Vector3(x, y, z), rotation ?? new Quaternion(), new Vector3(sx, sy, sz)));
    const batch = this.batches.get(material);
    if (batch) batch.push(g); else this.batches.set(material, [g]);
  }

  private span(material: MeshStandardMaterial, a: Vector3, b: Vector3, radius: number, top = radius): void {
    const direction = b.clone().sub(a), centre = a.clone().add(b).multiplyScalar(0.5);
    this.place(material, new CylinderGeometry(top, radius, direction.length(), 8), centre.x, centre.y, centre.z,
      1, 1, 1, new Quaternion().setFromUnitVectors(Y, direction.normalize()));
  }

  private pendant(): void {
    // A continuous hollow metal channel, with its diffuser recessed underneath.
    const profile = [[0.568, -0.024], [0.6, -0.024], [0.606, -0.017], [0.606, 0.018],
      [0.599, 0.025], [0.568, 0.025], [0.563, 0.018], [0.563, -0.017], [0.568, -0.024]];
    this.place(this.brass, new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 96), 0, 2.1, -1.9, 1.4, 1, 1.1);
    this.place(this.charcoal, new CylinderGeometry(0.15, 0.15, 0.035, 48), 0, 3.035, -1.9);
    const horizontal = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    this.place(this.diffuser, new RingGeometry(0.57, 0.598, 96), 0, 2.074, -1.9, 1.4, 1.1, 1, horizontal);
    for (let i = 0; i < 3; i++) {
      const a = TAU * i / 3 + 0.35;
      this.span(this.charcoal, new Vector3(Math.cos(a) * 0.09, 3.016, -1.9 + Math.sin(a) * 0.07),
        new Vector3(Math.cos(a) * 0.815, 2.122, -1.9 + Math.sin(a) * 0.64), 0.0024);
    }
  }

  private wall(side: number): void {
    const rotation = new Quaternion().setFromAxisAngle(Y, -side * Math.PI / 2);
    const part = (mat: MeshStandardMaterial, g: BufferGeometry, x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).applyQuaternion(rotation).add(new Vector3(side * 4.39, 0, -1.7));
      this.place(mat, g, p.x, p.y, p.z, 1, 1, 1, rotation);
    };
    // Half-round flutes end against continuous skirting and a matching cap.
    for (let i = 0; i < 52; i++) {
      this.place(this.wood, new CylinderGeometry(0.024, 0.024, 2.64, 8), side * 4.445, 1.46, -3.55 + i * 0.067);
    }
    this.place(this.charcoal, new BoxGeometry(0.07, 0.09, 3.55), side * 4.43, 0.1, -1.81);
    this.place(this.brass, new BoxGeometry(0.045, 0.01, 3.55), side * 4.4, 0.151, -1.81);
    part(this.charcoal, new BoxGeometry(0.86, 1.22, 0.045), 0, 1.73, 0);
    part(this.linen, new BoxGeometry(0.79, 1.15, 0.006), 0, 1.73, 0.027);
    for (const x of [-0.424, 0.424]) part(this.brass, new BoxGeometry(0.012, 1.22, 0.015), x, 1.73, 0.027);
    for (const y of [1.126, 2.334]) part(this.brass, new BoxGeometry(0.86, 0.012, 0.015), 0, y, 0.027);
    // Two gently interlocking sculptural strokes on a textured canvas.
    for (let k = 0; k < 2; k++) {
      const points: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        points.push(new Vector3(Math.sin(t * Math.PI * 1.55 + k * 1.8) * 0.23, 1.26 + t * 0.93, 0.039));
      }
      const g = new TubeGeometry(new CatmullRomCurve3(points), 32, k === 0 ? 0.014 : 0.009, 5, false);
      part(k === 0 ? this.charcoal : this.brass, g, 0, 0, 0);
    }
    // An opal globe in a narrow brass cradle, with an actual wall attachment.
    part(this.charcoal, new BoxGeometry(0.12, 0.32, 0.025), 1.0, 1.85, -0.015);
    part(this.brass, new CylinderGeometry(0.028, 0.028, 0.34, 12), 1.0, 1.85, 0.05);
    part(this.diffuser, new LatheGeometry([[0, -0.11], [0.045, -0.1], [0.061, -0.04], [0.063, 0.04], [0.045, 0.1], [0, 0.11]].map(([r, y]) => new Vector2(r, y)), 24), 1.0, 1.85, 0.095);
  }

  private planter(x: number, z: number, phase: number): void {
    const profile = [[0, 0.02], [0.22, 0.02], [0.25, 0.05], [0.28, 0.36], [0.3, 0.49],
      [0.3, 0.53], [0.282, 0.54], [0.27, 0.515], [0.265, 0.47]];
    this.place(this.ceramic, new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 48), x, 0, z);
    this.place(this.soil, new CylinderGeometry(0.267, 0.267, 0.012, 40), x, 0.478, z);
    this.place(this.brass, new CylinderGeometry(0.225, 0.225, 0.025, 40), x, 0.0175, z);
    // Glazed vertical ribs catch a little sidelight without adding separate draws.
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * TAU;
      const curve = new CatmullRomCurve3([
        new Vector3(x + Math.cos(a) * 0.242, 0.06, z + Math.sin(a) * 0.242),
        new Vector3(x + Math.cos(a) * 0.271, 0.3, z + Math.sin(a) * 0.271),
        new Vector3(x + Math.cos(a) * 0.292, 0.49, z + Math.sin(a) * 0.292),
      ]);
      this.place(this.ceramic, new TubeGeometry(curve, 5, 0.003, 4, false), 0, 0, 0);
    }
    const trunk = new CatmullRomCurve3([new Vector3(x, 0.48, z), new Vector3(x - 0.04, 1.15, z + 0.015), new Vector3(x + 0.06, 2.02, z + 0.03)]);
    this.place(this.wood, new TubeGeometry(trunk, 12, 0.019, 7, false), 0, 0, 0);
    const blade = leafGeometry();
    for (let branch = 0; branch < 7; branch++) {
      const a = phase + branch * 2.39996;
      const h = 0.81 + branch * 0.16;
      const extent = 0.46 + Math.sin(branch * 1.7 + phase) * 0.09;
      const curve = new CatmullRomCurve3([
        new Vector3(x, h, z),
        new Vector3(x + Math.cos(a) * extent * 0.6, h + 0.19, z + Math.sin(a) * extent * 0.6),
        new Vector3(x + Math.cos(a) * extent, h + 0.44, z + Math.sin(a) * extent),
      ]);
      this.place(this.wood, new TubeGeometry(curve, 10, 0.006, 5, false), 0, 0, 0);
      for (let j = 0; j < 8; j++) {
        const t = 0.23 + j * 0.105;
        const p = curve.getPoint(t);
        const f = a + (j % 2 ? -0.72 : 0.72);
        const direction = new Vector3(Math.cos(f) * 0.8, 0.58 - j * 0.027, Math.sin(f) * 0.8).normalize();
        const q = new Quaternion().setFromUnitVectors(Y, direction);
        const size = 0.8 + Math.sin(j * 2.1 + branch + phase) * 0.17;
        this.span(this.wood, p, p.clone().addScaledVector(direction, 0.035), 0.0018);
        p.addScaledVector(direction, 0.028);
        this.place((j + branch) % 3 ? this.foliage : this.foliageLight, blade, p.x, p.y, p.z, size, size, size, q);
      }
    }
  }

  private tableDetails(): void {
    // Leather coasters have a turned brass edge; their radii stay clear of play.
    for (const [x, z] of [[-0.52, -0.12], [0.5, -0.2], [-0.48, 0.32]]) {
      this.place(this.charcoal, new CylinderGeometry(0.058, 0.058, 0.003, 40), x, TABLE + 0.0015, z);
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
      this.place(this.brass, new TorusGeometry(0.055, 0.0007, 5, 48), x, TABLE + 0.0034, z, 1, 1, 1, q);
    }
    // Small folded napkin, with a raised folded edge and four fine stitched lines.
    this.place(this.linen, new BoxGeometry(0.105, 0.003, 0.145), 0.48, TABLE + 0.002, 0.34);
    this.place(this.linen, new BoxGeometry(0.104, 0.0022, 0.052), 0.48, TABLE + 0.0044, 0.294);
    for (let i = 0; i < 4; i++) this.place(this.linen, new BoxGeometry(0.001, 0.0004, 0.128), 0.434 + i * 0.03, TABLE + 0.004, 0.34);
    // A smoked hurricane jar surrounds the candle, with a turned metal foot.
    this.place(this.brass, new CylinderGeometry(0.039, 0.037, 0.006, 32), -0.52, TABLE + 0.007, -0.12);
    this.place(this.glass, new CylinderGeometry(0.038, 0.035, 0.112, 36, 1, true), -0.52, TABLE + 0.064, -0.12);
    this.place(this.wax, new CylinderGeometry(0.031, 0.031, 0.082, 32), -0.52, TABLE + 0.048, -0.12);
    this.place(this.charcoal, new CylinderGeometry(0.0007, 0.0007, 0.009, 6), -0.52, TABLE + 0.0935, -0.12);
  }

  private mergeBatches(): void {
    for (const [material, pieces] of this.batches) {
      const count = pieces.reduce((n, g) => n + g.attributes.position.count, 0);
      const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
      let cursor = 0;
      for (const g of pieces) {
        positions.set(g.attributes.position.array as Float32Array, cursor * 3);
        normals.set(g.attributes.normal.array as Float32Array, cursor * 3);
        if (g.attributes.uv) uvs.set(g.attributes.uv.array as Float32Array, cursor * 2);
        cursor += g.attributes.position.count;
        g.dispose();
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = `Interior · ${material.name}`;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.raycast = () => {};
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  private billboard(name: string, fragmentShader: string, x: number, y: number, z: number, width: number, height: number, additive: boolean): void {
    const material = new ShaderMaterial({ vertexShader: DETAIL_VERTEX, fragmentShader,
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, toneMapped: false,
      ...(additive ? { blending: AdditiveBlending } : {}),
    });
    this.motionMaterials.push(material);
    const mesh = new Mesh(new PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(x, y, z);
    mesh.raycast = () => {};
    this.group.add(mesh);
  }

  update(time: number, _viewer?: Vector3): void {
    if (this.reduced) return;
    for (const material of this.motionMaterials) material.uniforms.uTime.value = time;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (on) for (const material of this.motionMaterials) material.uniforms.uTime.value = 0;
  }
}
