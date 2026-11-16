/**
 * Draw-call tuning found by profiling (scripts/dev/program-churn.mjs, cpu-profile.mjs).
 *
 * Shadow-pass depth materials, grouped. three draws every shadow caster with one shared depth
 * material and re-fits it to each object (skinning, side, colour map) before the draw. When
 * neighbouring casters differ (a skinned hero, a textured card, a plain chair), it switches
 * shader programs and re-derives their parameters on nearly every draw: in this game that was
 * most of the renderer's program bookkeeping. Casters that need the same depth shader now share
 * a dedicated depth material instead (three still copies side and map onto it, which no longer
 * changes the program).
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshDepthMaterial, MeshStandardMaterial } from '@iwsdk/core';
import type { Material, Object3D } from '@iwsdk/core';

const shared = new Map<string, MeshDepthMaterial>();

/** Give every shadow-casting mesh under `root` the shared depth material for its variant. */
export function shareDepthMaterials(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
    if (!mesh.isMesh || !mesh.castShadow || mesh.customDepthMaterial) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | (Material & { map?: unknown; alphaMap?: unknown; displacementMap?: unknown })
      | undefined;
    if (!mat) return;
    const key = [
      mesh.isSkinnedMesh ? 'skin' : '',
      mesh.isInstancedMesh ? 'inst' : '',
      mesh.morphTargetInfluences ? 'morph' : '',
      String(mat.shadowSide ?? mat.side),
      mat.map ? 'map' : '',
      mat.alphaMap ? 'alpha' : '',
      mat.alphaTest > 0 ? 'test' : '',
      mat.displacementMap ? 'disp' : '',
    ].join('|');
    let depth = shared.get(key);
    if (!depth) {
      depth = new MeshDepthMaterial();
      shared.set(key, depth);
    }
    mesh.customDepthMaterial = depth;
  });
}

/**
 * A transparent, double-sided material is drawn in two passes (back faces, then front faces),
 * and three marks it changed before each, so its shader program is re-derived twice a frame and
 * it costs two draw calls. Every such material here is a flat panel, plane or additive glow,
 * where one pass looks the same; draw them once.
 */
export function singlePassTransparent(root: Object3D): void {
  root.traverse((o) => {
    for (const m of ([] as Material[]).concat((o as Mesh).material ?? [])) {
      if (m.transparent && m.side === DoubleSide) m.forceSinglePass = true;
    }
  });
}

const _rel = new Matrix4();
const _inv = new Matrix4();
const _tint = new Color();

/** Join geometries that all carry the same attributes into one indexed geometry. */
function joinGeometries(geos: BufferGeometry[]): BufferGeometry {
  const out = new BufferGeometry();
  const counts = geos.map((g) => g.getAttribute('position').count);
  const vertices = counts.reduce((a, b) => a + b, 0);
  for (const name of Object.keys(geos[0].attributes)) {
    const size = geos[0].getAttribute(name).itemSize;
    const data = new Float32Array(vertices * size);
    let base = 0;
    geos.forEach((g, gi) => {
      const a = g.getAttribute(name);
      for (let v = 0; v < counts[gi]; v++) for (let c = 0; c < size; c++) data[(base + v) * size + c] = a.getComponent(v, c);
      base += counts[gi];
    });
    out.setAttribute(name, new BufferAttribute(data, size));
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

/**
 * Fold the plain meshes under `root` that never move relative to it into one mesh per material:
 * a prop built from a dozen primitives is a dozen draw calls (and as many again in the shadow
 * pass), and a Quest's CPU pays for each one.
 *
 * - Meshes keep their look: only meshes sharing a material (and shadow flags) are joined.
 * - `paint` also joins untextured standard materials of different colours into one material,
 *   carrying each part's colour in vertex colours (their roughness evens out; use it for small
 *   props where that cannot be seen).
 * - `stop` names sub-groups that animate on their own; they are left whole (merge them separately).
 * Skinned, instanced and multi-material meshes, sprites and hidden meshes are left alone.
 * Returns the number of draw calls removed.
 */
export function mergeStatic(root: Object3D, opts: { paint?: boolean; stop?: (o: Object3D) => boolean } = {}): number {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const buckets = new Map<string, { painted: boolean; meshes: Mesh[] }>();
  const visit = (o: Object3D): void => {
    if (o !== root && opts.stop?.(o)) return;
    const m = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
    if (m.isMesh && !m.isSkinnedMesh && !m.isInstancedMesh && !Array.isArray(m.material) && m.visible && m.children.length === 0 && !m.userData.keepWhole) {
      const mat = m.material as Material & { map?: unknown; isMeshStandardMaterial?: boolean };
      const painted = !!opts.paint && !!mat.isMeshStandardMaterial && !mat.map && !mat.transparent;
      const key = `${painted ? 'paint' : mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { painted, meshes: [] }));
      b.meshes.push(m);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  let saved = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const withUv = b.meshes.every((m) => !!m.geometry.getAttribute('uv'));
    // parts already coloured per vertex (chairs, rocks) keep those colours
    const withColor = !b.painted && b.meshes.every((m) => !!m.geometry.getAttribute('color'));
    const geos = b.meshes.map((m) => {
      const src = m.geometry;
      const g = new BufferGeometry();
      g.setAttribute('position', src.getAttribute('position').clone());
      if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
      if (withUv) g.setAttribute('uv', src.getAttribute('uv').clone());
      if (withColor) g.setAttribute('color', src.getAttribute('color').clone());
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(_rel.multiplyMatrices(_inv, m.matrixWorld));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (b.painted) {
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3);
        _tint.copy((m.material as MeshStandardMaterial).color);
        for (let i = 0; i < n; i++) col.set([_tint.r, _tint.g, _tint.b], i * 3);
        g.setAttribute('color', new BufferAttribute(col, 3));
      }
      return g;
    });
    const first = b.meshes[0];
    let material = first.material as Material;
    if (b.painted) {
      const src = first.material as MeshStandardMaterial;
      material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: src.roughness, metalness: 0, envMapIntensity: src.envMapIntensity });
    }
    const merged = new Mesh(joinGeometries(geos), material);
    for (const g of geos) g.dispose();
    merged.name = first.name ? `${first.name}_merged` : `${root.name || 'static'}_merged`;
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.renderOrder = first.renderOrder;
    merged.raycast = first.raycast;
    for (const m of b.meshes) m.removeFromParent();
    root.add(merged);
    saved += b.meshes.length - 1;
  }
  return saved;
}
