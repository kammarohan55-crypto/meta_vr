/**
 * The lounge: Blender-built room, table and chairs (public/models/*.glb), plus
 * the lighting that makes them read. One shadow-casting spotlight over the
 * table (cards cast real shadows on the marble), soft fill from the window and
 * the practical lamps, and a coloured LED ring in the table that the game can
 * recolour.
 *
 * If a model is missing the scene still works: a simple stand-in is built so
 * the game is always playable.
 */
import {
  AdditiveBlending,
  AssetManager,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  Object3D,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  RingGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SpotLight,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { drawCardTo, makePosterCanvas } from './cards.js';
import { LoungeAtmosphere } from '../scene-assets/atmosphere.scene-asset.js';
import { InteriorDetails } from '../scene-assets/interior-details.scene-asset.js';
import { faceTablePoint } from './util.js';

/** Table top height above the floor (metres). */
export const TABLE_Y = 0.74;
export const TABLE_R = 0.72;
/** Distance from the table centre to each chair. */
export const SEAT_R = 1.04;

const base = (p: string) => `${(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL}${p}`;

export class Lounge {
  /** Everything static, centred on the table, which stands on the floor at the origin. */
  readonly root = new Group();
  /** The chairs, one per seat angle (south, west, north, east). */
  readonly chairs: Object3D[] = [];
  private glowMats: MeshStandardMaterial[] = [];
  private glowColor = new Color(0x719e94);
  private glowTarget = new Color(0x719e94);
  private glowPower = 1;
  readonly key: SpotLight;
  private halo: PointLight;
  private window: DirectionalLight;
  private rim: DirectionalLight;
  private fill: DirectionalLight;
  private hemi: HemisphereLight;
  /** 0 normal, -1 dimmed for a dramatic moment, +1 bright (victory). */
  private moodTarget = 0;
  private mood = 0;
  private oldCity: Object3D[] = [];
  private atmosphere = new LoungeAtmosphere();
  private interior = new InteriorDetails(false);

  constructor() {
    this.root.name = 'Lounge';
    // lighting
    this.hemi = new HemisphereLight(0x9bbbd6, 0x241a14, 0.2);
    this.root.add(this.hemi);
    this.key = new SpotLight(0xffe8cf, 9.5, 6, Math.PI / 3.4, 1, 2);
    this.key.position.set(-1.05, 2.65, 0.35);
    this.key.target.position.set(0, TABLE_Y, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.00012;
    this.key.shadow.normalBias = 0.0015;
    this.key.shadow.radius = 3;
    this.key.shadow.camera.near = 1.0;
    this.key.shadow.camera.far = 4;
    this.root.add(this.key, this.key.target);
    this.halo = new PointLight(0xffd3a3, 1.1, 5.5, 2);
    this.halo.position.set(0, 2.9, 0);
    this.root.add(this.halo);
    // neon from behind the far seats: a pink and a blue edge on everyone's shoulders and hair
    this.window = new DirectionalLight(0xb4cee9, 0.75);
    this.window.position.set(-3.6, 2.7, -4.4);
    this.rim = new DirectionalLight(0x85b3d5, 0.5);
    this.rim.position.set(3.6, 2.7, -4.4);
    // and a soft warm light from your side of the room, so faces are never lost
    this.fill = new DirectionalLight(0xffdfbd, 0.4);
    this.fill.position.set(0.5, 1.9, 3.5);
    this.root.add(this.window, this.rim, this.fill);
    this.buildNeon();
    this.buildProps();
    this.decor.add(this.atmosphere.group);
    this.decor.add(this.interior.group);
  }

  /** Things people leave on a card table: a coffee mug and a tumbler, out of the way of the cards. */
  private buildProps(): void {
    const props = new Group();
    props.name = 'TableProps';
    const ceramic = new MeshStandardMaterial({ color: 0x15151b, roughness: 0.22, metalness: 0.05, side: DoubleSide });
    const mug = new Group();
    const wall = new Mesh(new CylinderGeometry(0.04, 0.037, 0.092, 40, 1, true), ceramic);
    wall.position.y = 0.046;
    const base = new Mesh(new CylinderGeometry(0.037, 0.037, 0.006, 40), ceramic);
    base.position.y = 0.003;
    const lip = new Mesh(new TorusGeometry(0.04, 0.0028, 8, 48), ceramic);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.092;
    const handle = new Mesh(new TorusGeometry(0.026, 0.006, 10, 28, Math.PI), ceramic);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(0.04, 0.048, 0);
    const coffee = new Mesh(new CylinderGeometry(0.0375, 0.0375, 0.002, 32), new MeshStandardMaterial({ color: 0x2a140a, roughness: 0.12 }));
    coffee.position.y = 0.078;
    mug.add(wall, base, lip, handle, coffee);
    mug.position.set(0.5, TABLE_Y, -0.2);
    mug.rotation.y = 0.7;
    // a short glass with an amber drink
    const glassMat = new MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false, side: DoubleSide, envMapIntensity: 1.6 });
    const tumbler = new Group();
    const g = new Mesh(new CylinderGeometry(0.036, 0.031, 0.085, 36, 1, true), glassMat);
    g.position.y = 0.0425;
    const drink = new Mesh(new CylinderGeometry(0.0335, 0.0305, 0.04, 32), new MeshStandardMaterial({ color: 0xd9822b, roughness: 0.1, transparent: true, opacity: 0.82 }));
    drink.position.y = 0.024;
    const foot = new Mesh(new CylinderGeometry(0.031, 0.031, 0.005, 32), glassMat);
    foot.position.y = 0.0025;
    tumbler.add(drink, g, foot);
    tumbler.position.set(-0.3, TABLE_Y, -0.52);
    props.add(mug, tumbler);
    props.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      m.raycast = () => {};
      m.castShadow = m.material !== glassMat;
      m.receiveShadow = true;
    });
    this.root.add(props);
  }

  // ------------------------------------------------------------ neon (no lights: emissive tubes + soft additive glow, cheap on Quest)

  private neon: { mat: MeshBasicMaterial; glow: boolean; k: number }[] = [];
  /** Wall-mounted decor (strips, lamps, poster, sign): part of the virtual room, hidden in MR. */
  readonly decor = new Group();
  /** Glow sprites that turn to face the viewer. */
  private billboards: Mesh[] = [];
  /** Where the viewer's head is, in table space (set by the app each frame). */
  readonly viewer = new Vector3(0, 1.2, 1);

  private buildNeon(): void {
    const tube = (r: number, t: number, y: number, k = 1) => {
      const mat = new MeshBasicMaterial({ color: this.glowColor.clone(), toneMapped: false });
      const m = new Mesh(new TorusGeometry(r, t, 10, 192), mat);
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      this.neon.push({ mat, glow: false, k });
      return m;
    };
    const glowMat = (tex: CanvasTexture, opacity: number, k = 1) => {
      const mat = new MeshBasicMaterial({ map: tex, color: this.glowColor.clone(), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
      this.neon.push({ mat, glow: true, k });
      return mat;
    };
    const vband = bandTexture(false);
    const rband = bandTexture(true);
    const g = new Group();
    g.name = 'TableNeon';
    // the bright rim around the marble, with a soft halo above and below it
    g.add(tube(TABLE_R - 0.012, 0.0015, TABLE_Y - 0.048, 0.28));
    const halo = new Mesh(new CylinderGeometry(TABLE_R - 0.007, TABLE_R - 0.007, 0.035, 96, 1, true), glowMat(vband, 0.13, 0.35));
    halo.position.y = TABLE_Y - 0.05;
    halo.renderOrder = 5;
    g.add(halo);
    // light spilling onto the floor under the table
    const floor = new Mesh(new RingGeometry(0.35, 0.9, 64, 1), glowMat(rband, 0.06, 0.25));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.012;
    g.add(floor);
    for (const c of g.children) (c as Mesh).raycast = () => {};
    this.root.add(g);

    this.root.add(this.decor);
  }

  /** Hand-built decor for the older real-time-lit lounge (used only if the baked room is missing). */
  private buildLegacyDecor(): void {
    const vband = bandTexture(false);
    const rband = bandTexture(true);
    // the floating halo light above the table
    const warm = new MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false });
    const ring = new Mesh(new TorusGeometry(0.78, 0.016, 12, 160), warm);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.38;
    const ringGlow = new Mesh(
      new RingGeometry(0.62, 0.95, 160, 1),
      new MeshBasicMaterial({ map: rband, color: 0xffd9a0, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
    );
    ringGlow.rotation.x = Math.PI / 2;
    ringGlow.position.y = 2.38;
    const wire = new Mesh(new CylinderGeometry(0.003, 0.003, 0.7, 6), new MeshStandardMaterial({ color: 0x222226, metalness: 1, roughness: 0.4 }));
    wire.position.y = 2.38 + 0.35;
    for (const m of [ring, ringGlow, wire]) {
      m.raycast = () => {};
      this.decor.add(m);
    }

    // neon strips along the window: violet along the floor, pink along the ceiling line
    const strip = (x0: number, x1: number, y: number, z: number, hex: number, glowOpacity: number) => {
      const len = x1 - x0;
      const core = new Mesh(new CylinderGeometry(0.008, 0.008, len, 8), new MeshBasicMaterial({ color: new Color(hex).lerp(WHITE, 0.3), toneMapped: false }));
      core.rotation.z = Math.PI / 2;
      core.position.set((x0 + x1) / 2, y, z);
      const glow = new Mesh(new PlaneGeometry(len, 0.22), new MeshBasicMaterial({ map: vband, color: hex, transparent: true, opacity: glowOpacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide }));
      glow.position.set((x0 + x1) / 2, y, z + 0.02);
      for (const m of [core, glow]) {
        m.raycast = () => {};
        this.decor.add(m);
      }
    };
    strip(-4.4, 4.4, 0.06, -4.86, 0x8b5cf6, 0.9);
    strip(-4.4, 4.4, 3.08, -4.86, 0xff4fd8, 0.7);
    // warm globe lamps either side of the view, like the practical lights in a lounge
    const globeMat = new MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
    const lampGlow = new MeshBasicMaterial({ map: radialTexture(), color: 0xffb867, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const stand = new MeshStandardMaterial({ color: 0x8a6a3a, metalness: 1, roughness: 0.35 });
    for (const [x, z] of [[-2.35, -3.7], [2.45, -3.5], [-3.6, 1.6]] as const) {
      const pole = new Mesh(new CylinderGeometry(0.012, 0.018, 1.25, 10), stand);
      pole.position.set(x, 0.625, z);
      const foot = new Mesh(new CylinderGeometry(0.14, 0.16, 0.025, 24), stand);
      foot.position.set(x, 0.0125, z);
      const globe = new Mesh(new SphereGeometry(0.13, 24, 16), globeMat);
      globe.position.set(x, 1.36, z);
      const glow = new Mesh(new PlaneGeometry(1.1, 1.1), lampGlow);
      glow.position.copy(globe.position);
      glow.userData.billboard = true;
      this.billboards.push(glow);
      for (const m of [pole, foot, globe, glow]) {
        m.raycast = () => {};
        this.decor.add(m);
      }
    }

    // a framed giant card on the left wall, with a neon frame
    {
      const c = document.createElement('canvas');
      c.width = 448;
      c.height = 672;
      const ctx = c.getContext('2d')!;
      drawCardTo(ctx, { color: -1, kind: 'wild4', value: -1 }, 0, 0, 448);
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const poster = new Group();
      const art = new Mesh(new PlaneGeometry(0.8, 1.2), new MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
      const back = new Mesh(new PlaneGeometry(1.0, 1.4), new MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.5 }));
      back.position.z = -0.01;
      const frameMat = new MeshBasicMaterial({ color: 0xff5ad6, toneMapped: false });
      for (const [w, h, x, y] of [[1.02, 0.014, 0, 0.7], [1.02, 0.014, 0, -0.7], [0.014, 1.42, 0.51, 0], [0.014, 1.42, -0.51, 0]] as const) {
        const bar = new Mesh(new PlaneGeometry(w, h), frameMat);
        bar.position.set(x, y, 0.004);
        poster.add(bar);
      }
      const glow = new Mesh(new PlaneGeometry(1.5, 1.9), new MeshBasicMaterial({ map: radialTexture(), color: 0xc026d3, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.position.z = -0.005;
      poster.add(glow, back, art);
      poster.position.set(-4.4, 1.6, -2.55);
      poster.rotation.y = Math.PI / 2;
      poster.traverse((o) => ((o as Mesh).raycast = () => {}));
      this.decor.add(poster);
    }

    // the game's neon sign
    const sign = new Mesh(new PlaneGeometry(1.6, 0.52), new MeshBasicMaterial({ map: neonSignTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    // hanging just inside the window, up and to the left of the view across the table
    sign.position.set(-1.45, 1.78, -4.75);
    sign.raycast = () => {};
    this.decor.add(sign);
  }

  /** Load the Blender models. Resolves when the room is ready (or stand-ins are in place). */
  async load(onProgress?: (k: number) => void): Promise<void> {
    // The baked lounge (Blender, Cycles light bake). If it can't be loaded, fall back to the older real-time-lit room.
    let baked = false;
    try {
      const [gltf, lightmap] = await Promise.all([
        AssetManager.loadGLTF(base('models/lounge-premium.glb'), 'lounge-premium')
          .catch(() => AssetManager.loadGLTF(base('models/lounge2.glb'), 'lounge2')),
        new TextureLoader().loadAsync(base('textures/room_lightmap.jpg')),
      ]);
      this.useBakedRoom(gltf.scene, lightmap);
      baked = true;
    } catch (err) {
      console.warn('[chaos] baked lounge unavailable, using the real-time one', err);
    }
    onProgress?.(0.5);
    const parts: [string, (o: Object3D) => void][] = baked
      ? [['models/table-premium-marble.glb', (o) => this.useTable(o)]]
      : [
          ['models/lounge.glb', (o) => this.useLounge(o)],
          ['models/table-premium-marble.glb', (o) => this.useTable(o)],
          ['models/chair.glb', (o) => this.useChair(o)],
          ['models/lounge_extras.glb', (o) => this.useExtras(o)],
        ];
    if (!baked) this.buildLegacyDecor();
    parts.push(['models/penthouse-backdrop-v1.glb', (o) => this.usePenthouse(o)]);
    let done = 0;
    await Promise.all(
      parts.map(async ([url, use]) => {
        try {
          const gltf = await AssetManager.loadGLTF(base(url), url);
          use(gltf.scene);
        } catch (err) {
          console.warn('[chaos] could not load', url, err);
          if (url.includes('penthouse-backdrop')) {
            try {
              const fallback = await AssetManager.loadGLTF(base('models/city-view.glb'), 'city-view-fallback');
              this.useCityView(fallback.scene);
            } catch { /* The original room remains available. */ }
          } else if (!url.includes('extras') && !url.includes('city-view')) use(this.standIn(url));
        }
        onProgress?.(0.5 + (0.5 * ++done) / parts.length);
      }),
    );
  }

  /** Light-map scale: the JPEG stores irradiance / LM_SCALE (see chaos-tools/encode_lightmap.py). */
  static readonly LM_SCALE = 2.4;
  /** Overall brightness of the baked room relative to Blender's render. */
  lmExposure = 1.05;
  private bakedMats: MeshBasicMaterial[] = [];
  private bakedPbr: MeshStandardMaterial[] = [];

  /** Distant matte behind the real window frames; no interactive geometry. */
  private useCityView(o: Object3D): void {
    o.name = 'City_Window_View';
    o.position.set(0, 4, -20);
    o.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.raycast = () => {};
      mesh.castShadow = mesh.receiveShadow = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.toneMapped = false;
    });
    this.decor.add(o);
    for (const mesh of this.oldCity) mesh.visible = false;
  }

  /** Photographic far architecture; furniture, floor, cards and people stay 3D. */
  private usePenthouse(o: Object3D): void {
    this.useCityView(o);
    o.position.set(0, 0.5, -6.5);
    this.room?.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      let chair = false;
      for (let parent: Object3D | null = mesh; parent && parent !== this.room; parent = parent.parent) {
        if (/^Chair/.test(parent.name)) { chair = true; break; }
      }
      const material = mesh.material as MeshStandardMaterial;
      mesh.visible = chair || material.name === 'R2_Floor' || /^R2_Rug/.test(mesh.name);
    });
  }

  /**
   * The baked room: every surface with a second UV set gets the Cycles light map
   * (soft bounce light, neon spill, contact shadows) on an unlit material, so the
   * whole room costs almost nothing per frame on Quest. Neon tubes, LEDs and
   * lamp shades become bright unlit glow; the window glass reflects the room.
   */
  private useBakedRoom(o: Object3D, lightmap: Texture): void {
    lightmap.flipY = false;
    lightmap.channel = 1;
    lightmap.colorSpace = SRGBColorSpace;
    lightmap.anisotropy = 4;
    lightmap.needsUpdate = true;
    const intensity = Lounge.LM_SCALE * Math.PI * this.lmExposure;
    const fixtures: [Mesh, Color][] = [];
    o.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      m.raycast = () => {};
      m.castShadow = false;
      m.receiveShadow = false;
      const src = m.material as MeshStandardMaterial;
      const name = src?.name ?? '';
      // Keep the city view clear; the old oversized neon wordmark is retired.
      if (/^R2E_SignChaos|^R2E_SignTable|^R2E_Petal|^R2E_Pad|^R2E_Halo$|^R2_HaloWires$|Controller|Gamepad/.test(m.name)) {
        m.visible = false;
        return;
      }
      if (name === 'R2_PosterArt') {
        src.map = new CanvasTexture(makePosterCanvas());
        src.map.colorSpace = SRGBColorSpace;
      }
      if (/^Lounge_(City|Towers)/.test(m.name)) this.oldCity.push(m);
      if (name.startsWith('R2E')) {
        // light sources: bright, unlit, never tone-mapped down to grey
        const k = Math.min(1.8, (src.emissiveIntensity || 1) * 0.18);
        m.material = new MeshBasicMaterial({ color: src.emissive.clone().multiplyScalar(k), toneMapped: false });
        if (/Halo/.test(m.name) || /Halo/.test(name)) this.haloMesh = m;
        fixtures.push([m, src.emissive.clone()]);
        return;
      }
      if (name === 'R2_Glass') {
        m.material = new MeshStandardMaterial({ color: 0x070e18, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 0.65 });
        m.renderOrder = 2;
        return;
      }
      if (m.geometry.getAttribute('uv1')) {
        // Keep the baked contact/bounce light, and restore actual reflection,
        // grain and roughness on the materials close enough to touch.
        if (/R2_(WalnutSlat|LeatherTan|Marble|Brass|Gold|Ceramic|Floor)|Leather_Cognac|Walnut_Veneer|^velvet|^golden|^outside/.test(name)) {
          const mat = src.clone();
          mat.name = name;
          mat.lightMap = lightmap;
          mat.lightMapIntensity = Lounge.LM_SCALE * this.lmExposure * 0.62;
          mat.envMapIntensity = /Brass|Gold/.test(name) ? 0.9 : 0.55;
          if (/Walnut/.test(name)) {
            mat.roughness = 0.72;
            mat.color.multiplyScalar(0.43);
            (mat as MeshPhysicalMaterial).clearcoat = 0.06;
          }
          if (/Floor/.test(name)) {
            mat.color.setRGB(0.34, 0.39, 0.45);
            mat.roughness = 0.42;
            mat.envMapIntensity = 0.65;
            mat.userData.bakeScale = 0.38;
            mat.lightMapIntensity = Lounge.LM_SCALE * this.lmExposure * 0.38;
            (mat as MeshPhysicalMaterial).clearcoat = 0;
          }
          if (/Leather/.test(name)) {
            mat.roughness = 0.46;
            mat.normalScale.setScalar(0.65);
          }
          if (/velvet|outside/.test(name)) mat.roughness = 0.9;
          if (mat.map) mat.map.anisotropy = 8;
          m.material = mat;
          m.receiveShadow = /Floor|Leather|Marble/.test(name);
          this.bakedPbr.push(mat);
          return;
        }
        const mat = new MeshBasicMaterial({ map: src.map ?? null, color: src.color?.clone() ?? new Color(1, 1, 1), lightMap: lightmap, lightMapIntensity: intensity });
        if (/Leaf/.test(name)) {
          mat.alphaTest = 0.5;
          mat.side = DoubleSide;
        }
        if (mat.map) mat.map.anisotropy = 8;
        // the plaster walls: the exported texture is near-black, so set the
        // charcoal plaster they have in Cycles (linear albedo about 0.06)
        if (name === 'R2_WallDark') mat.color.setRGB(2.9, 2.6, 2.5);
        const bookColors: Record<string, number> = { R2_BookRed: 0x744a42, R2_BookNavy: 0x293843, R2_BookOchre: 0x857156, R2_BookCream: 0xaaa18a, R2_BookGreen: 0x3a5145 };
        if (name in bookColors) mat.color.setHex(bookColors[name]);
        mat.name = name;
        this.bakedMats.push(mat);
        m.material = mat;
        return;
      }
      // scanned plants (Poly Haven) keep real PBR shading, lit by the room's own panorama
      if (/^R2P_/.test(m.name) || /potted_plant/.test(name)) {
        // (a material can be shared by several plants: adjust it once)
        if (src?.isMeshStandardMaterial && !src.userData.lit) {
          src.userData.lit = true;
          if (/leaves/.test(name)) {
            src.transparent = false;
            src.alphaTest = 0.5;
            src.depthWrite = true;
            src.side = DoubleSide;
          }
          src.envMapIntensity = /leaves/.test(name) ? 1.5 : 1.1;
          src.userData.env = src.envMapIntensity;
          this.litMats.push(src);
        }
        return;
      }
      // the city outside keeps its own emissive look
      if (src?.isMeshStandardMaterial && src.emissiveIntensity > 1) src.emissiveIntensity = Math.min(src.emissiveIntensity, 2.2);
    });
    this.room = o;
    o.visible = !this.mr;
    this.root.add(o);
    this.fixtureGlows(o, fixtures);
  }

  /**
   * A soft additive halo around every lamp and neon tube in the baked room: the
   * look of bloom, without a post-processing pass (too costly on a headset).
   */
  private fixtureGlows(room: Object3D, fixtures: [Mesh, Color][]): void {
    room.updateWorldMatrix(true, true);
    const tex = radialTexture();
    const box = new Box3();
    const size = new Vector3();
    for (const [m, color] of fixtures) {
      const n = m.name;
      box.setFromObject(m);
      box.getSize(size);
      let w = 0;
      let h = 0;
      let k = 0.5;
      let turn = false;
      if (/Globe|LampShade/.test(n)) {
        w = h = Math.max(size.x, size.y, size.z) * 4.2;
        k = 0.5;
        turn = true;
      } else if (/Sign|Pad|Petal/.test(n)) {
        w = size.x * 1.35 + 0.5;
        h = size.y * 2.4 + 0.5;
        k = /Petal/.test(n) ? 0.1 : 0.16;
      } else continue;
      const mat = new MeshBasicMaterial({ map: tex, color: color.clone().multiplyScalar(k), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      const g = new Mesh(new PlaneGeometry(w, h), mat);
      g.raycast = () => {};
      g.renderOrder = 3;
      room.worldToLocal(box.getCenter(g.position));
      if (!turn) g.position.z += 0.03;
      room.add(g);
      if (turn) this.billboards.push(g);
    }
  }

  /** The baked halo ring (pulses gently with the table glow). */
  private haloMesh: Mesh | null = null;

  /** Brighten or dim the whole baked room (used for the Draw Four "lights down" moment). */
  private applyRoomLight(k: number): void {
    const intensity = Lounge.LM_SCALE * Math.PI * this.lmExposure * k;
    for (const m of this.bakedMats) m.lightMapIntensity = intensity;
    for (const m of this.bakedPbr) m.lightMapIntensity = Lounge.LM_SCALE * this.lmExposure * (m.userData.bakeScale ?? 0.62) * k;
    for (const m of this.litMats) m.envMapIntensity = (m.userData.env ?? 1.1) * k;
  }

  /** Real-time lit pieces inside the baked room (the scanned plants). */
  private litMats: MeshStandardMaterial[] = [];

  private prep(o: Object3D, shadows: boolean): void {
    o.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows;
      m.receiveShadow = true;
      const mat = m.material as MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.envMapIntensity = 0.9;
        // the exporter's emissive strength reads very hot under ACES; tame it
        if (mat.emissiveIntensity > 1) mat.emissiveIntensity = Math.min(mat.emissiveIntensity, 2.2);
      }
      // static scenery never takes rays or pointer events
      m.raycast = () => {};
    });
  }

  /** The room shell (walls, window, city, furniture), hidden in mixed reality. */
  room: Object3D | null = null;
  private mr = false;

  /** Mixed reality: keep the table, chairs and lights; let passthrough show your real room. */
  setMixedReality(on: boolean): void {
    this.mr = on;
    if (this.room) this.room.visible = !on;
    this.decor.visible = !on;
    // you sit on your own chair in MR
    if (this.chairs[0]) this.chairs[0].visible = !on;
    this.window.visible = !on;
  }

  private useLounge(o: Object3D): void {
    this.room = o;
    o.visible = !this.mr;
    this.prep(o, false);
    o.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      const mat = m.material as MeshStandardMaterial;
      // the city is lit only by its own windows
      if (/Towers|City/.test(m.name) || /Towers/.test(mat?.name ?? '')) {
        mat.envMapIntensity = 0;
        m.receiveShadow = false;
      }
      if (/Rug/.test(m.name)) {
        m.receiveShadow = true;
        this.swapMap(mat, 'textures/rug_round_albedo.jpg', 0.95);
      }
      if (/Floor/.test(m.name)) this.swapMap(mat, 'textures/floor_planks_albedo.jpg', 0.42);
    });
    this.root.add(o);
  }

  /** Shelving with warm LED strips, books and vases, and a velvet bean bag (Blender). */
  private useExtras(o: Object3D): void {
    this.prep(o, false);
    this.decor.add(o);
  }

  private swapMap(mat: MeshStandardMaterial, file: string, rough: number, repeat = 1): void {
    new TextureLoader().load(base(file), (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.anisotropy = 8;
      if (mat.map) {
        tex.repeat.copy(mat.map.repeat).multiplyScalar(repeat);
        tex.offset.copy(mat.map.offset);
        tex.channel = mat.map.channel;
      }
      mat.map = tex;
      // these surfaces are polished or soft: the old maps' grain would fight the new pattern
      mat.roughnessMap = null;
      mat.normalMap = null;
      mat.roughness = rough;
      mat.color.setRGB(1, 1, 1);
      mat.needsUpdate = true;
    });
  }

  private useTable(o: Object3D): void {
    this.prep(o, true);
    o.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      if (/Felt|Walnut|Brass/.test(m.name)) {
        const mat = m.material as MeshStandardMaterial;
        mat.envMapIntensity = /Brass/.test(m.name) ? 0.8 : 0.45;
        if (mat.map) mat.map.anisotropy = 8;
        m.castShadow = !/Felt|Surface/.test(m.name);
        if (/Walnut_Surface/.test(m.name)) {
          const marble = /Marble|marble/.test(mat.name);
          mat.color.multiplyScalar(marble ? 0.9 : 0.32);
          mat.roughness = marble ? 0.22 : 0.3;
          mat.envMapIntensity = 1.1;
          (mat as MeshPhysicalMaterial).clearcoat = 0.65;
          (mat as MeshPhysicalMaterial).clearcoatRoughness = 0.16;
        }
      }
      if (/Glow/.test(m.name)) {
        const mat = (m.material as MeshStandardMaterial).clone();
        mat.color.set(0x000000);
        mat.emissive.copy(this.glowColor);
        mat.emissiveIntensity = 2.0;
        mat.toneMapped = false;
        m.material = mat;
        m.castShadow = false;
        this.glowMats.push(mat);
      }
      if (/Top/.test(m.name)) {
        const mat = m.material as MeshStandardMaterial;
        mat.envMapIntensity = 1.0;
        m.castShadow = false;
        // a calmer, darker Nero Marquina: polished, so the neon reflects in it and cards read clearly on it
        mat.color.setScalar(0.42);
        this.swapMap(mat, 'textures/marble_soft_albedo.jpg', 0.2, 1.5);
      }
    });
    this.root.add(o);
  }

  private useChair(o: Object3D): void {
    this.prep(o, false);
    for (let i = 0; i < 4; i++) {
      const c = i === 0 ? o : o.clone();
      const a = seatAngle(i);
      c.position.set(Math.sin(a) * SEAT_R, 0, Math.cos(a) * SEAT_R);
      // the model's front is +Z; turn it to face the table centre
      c.rotation.y = a + Math.PI;
      this.chairs.push(c);
      this.root.add(c);
    }
    if (this.mr) this.chairs[0].visible = false;
  }

  /** Plain stand-ins so the game never depends on a model download. */
  private standIn(url: string): Object3D {
    const g = new Group();
    if (url.includes('table')) {
      const top = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R, 0.04, 64), new MeshStandardMaterial({ color: 0x111114, roughness: 0.15 }));
      top.position.y = TABLE_Y - 0.02;
      top.name = 'Table_Top';
      const ring = new Mesh(new TorusGeometry(TABLE_R + 0.005, 0.006, 8, 96), new MeshStandardMaterial({ color: 0x000000 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = TABLE_Y - 0.05;
      ring.name = 'Table_Glow';
      const col = new Mesh(new CylinderGeometry(0.1, 0.4, TABLE_Y - 0.05, 32), new MeshStandardMaterial({ color: 0x18181c, metalness: 1, roughness: 0.3 }));
      col.position.y = (TABLE_Y - 0.05) / 2;
      g.add(top, ring, col);
    } else if (url.includes('chair')) {
      const seat = new Mesh(new CylinderGeometry(0.34, 0.34, 0.45, 24), new MeshStandardMaterial({ color: 0x5a2f1a, roughness: 0.6 }));
      seat.position.y = 0.225;
      g.add(seat);
    }
    return g;
  }

  /** Recolour the table's LED ring (the current colour to match). */
  setGlow(hex: number, power = 1): void {
    this.glowTarget.setHex(hex);
    this.glowPower = power;
  }

  /** Dim the room for a dramatic moment (-1), restore (0), or brighten (1). */
  setMood(m: -1 | 0 | 1): void {
    this.moodTarget = m;
  }

  setReducedMotion(on: boolean): void {
    this.atmosphere.setReducedMotion(on);
    this.interior.setReducedMotion(on);
  }

  update(dt: number, t: number): void {
    this.atmosphere.update(t);
    this.interior.update(t, this.viewer);
    const k = 1 - Math.exp(-dt * 4);
    this.glowColor.lerp(this.glowTarget, k);
    const pulse = 0.98 + 0.02 * Math.sin(t * 1.2);
    for (const m of this.glowMats) {
      m.emissive.copy(this.glowColor);
      m.emissiveIntensity = 0.6 * this.glowPower * pulse;
    }
    for (const b of this.billboards) faceTablePoint(b, this.viewer);
    for (const n of this.neon) {
      // tubes are near-white hot at the core, glows carry the colour
      if (n.glow) n.mat.color.copy(this.glowColor).multiplyScalar(n.k * pulse * Math.min(1.6, this.glowPower));
      else n.mat.color.copy(this.glowColor).lerp(WHITE, 0.35).multiplyScalar(n.k * (0.9 + 0.1 * pulse) * Math.min(1.4, this.glowPower));
    }
    this.mood += (this.moodTarget - this.mood) * (1 - Math.exp(-dt * 3));
    const dim = this.mood < 0 ? 1 + this.mood * 0.55 : 1 + this.mood * 0.35;
    this.hemi.intensity = 0.2 * dim;
    this.halo.intensity = 1.1 * dim;
    this.window.intensity = 0.75 * dim;
    this.key.intensity = 9.5 * (this.mood > 0 ? 1 + this.mood * 0.18 : 1 + this.mood * 0.15);
    this.key.color.setRGB(1, 0.86 - Math.max(0, this.mood) * 0.04, 0.7 - Math.max(0, this.mood) * 0.1);
    // the baked room dims with the mood too (Draw Four), and warms up for a win
    if (this.bakedMats.length && Math.abs(this.mood - this.lastRoomMood) > 0.005) {
      this.lastRoomMood = this.mood;
      this.applyRoomLight(this.mood < 0 ? 1 + this.mood * 0.6 : 1 + this.mood * 0.15);
    }
  }
  private lastRoomMood = 0;
}

/**
 * Seat angles around the table, in table space. Seat slot 0 (you) is south
 * (+Z), then clockwise seen from above: west, north, east.
 */
export function seatAngle(slot: number): number {
  return SEAT_ANGLES[slot];
}
/**
 * You sit on one side; the other three share the far arc, so everyone is in
 * front of you (in view on a headset without turning, and on a flat screen).
 */
const SIDE = (115 * Math.PI) / 180;
const SEAT_ANGLES = [0, -SIDE, Math.PI, SIDE];

/** A point at `r` from the table centre in the direction of seat slot `slot`, at height y. */
export function seatPoint(slot: number, r: number, y: number, out = new Vector3()): Vector3 {
  const a = seatAngle(slot);
  return out.set(Math.sin(a) * r, y, Math.cos(a) * r);
}

const WHITE = new Color(1, 1, 1);

/** Soft glow falloff: across the texture's height (vertical band) or its width (radial ring). */
function bandTexture(radial: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = radial ? 256 : 4;
  c.height = radial ? 4 : 256;
  const ctx = c.getContext('2d')!;
  const n = radial ? c.width : c.height;
  const g = radial ? ctx.createLinearGradient(0, 0, n, 0) : ctx.createLinearGradient(0, 0, 0, n);
  for (let i = 0; i <= 16; i++) {
    const x = i / 16;
    const d = (x - 0.5) / 0.5;
    const a = Math.exp(-d * d * 7) * 0.9 + Math.exp(-d * d * 60) * 0.6;
    g.addColorStop(x, `rgba(255,255,255,${Math.min(1, a).toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The CHAOS TABLE neon sign: glass tubes with a soft bloom, drawn once into a texture. */
function neonSignTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1536;
  c.height = 500;
  const ctx = c.getContext('2d')!;
  const font = '"Avenir Next", "Segoe UI", Roboto, system-ui, sans-serif';
  const tube = (text: string, x: number, y: number, size: number, color: string, weight = 900) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const [blur, alpha, w] of [[60, 0.55, size * 0.1], [22, 0.85, size * 0.07]] as const) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = w;
      ctx.strokeText(text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 8;
    ctx.lineWidth = size * 0.025;
    ctx.strokeStyle = '#fff6fb';
    ctx.strokeText(text, x, y);
  };
  tube('AFTERHOURS', 760, 210, 160, '#d5bd86', 500);
  tube('CARD LOUNGE', 760, 380, 55, '#a2b9d0', 500);
  // the pinwheel emblem in neon outline
  const cols = ['#ff3b3b', '#ffc21a', '#2bd36b', '#3d8bff'];
  ctx.save();
  ctx.translate(1280, 140);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
    ctx.strokeStyle = cols[i];
    ctx.shadowColor = cols[i];
    ctx.shadowBlur = 30;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(70, -45, 74, 3);
    ctx.quadraticCurveTo(42, 17, 0, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Round soft glow for lamp halos. */
function radialTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
