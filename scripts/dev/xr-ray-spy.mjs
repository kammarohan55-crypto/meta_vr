// Dev-only: what a hand ray actually reaches. MODE=start records pointer events on the table
// (cards, deck), the menus and the colour picker; MODE=read returns them with each hand's ray
// (origin and direction, table space) and what a plain raycast along it hits first.
export default async function run({ frame }) {
  return frame.evaluate((mode) => {
    const app = window.chaos;
    const camera = app.warmup.camera;
    const origin = camera.parent;
    const V = app.root.position.constructor;
    if (mode === 'start') {
      window.__rays = [];
      if (!window.__raySpied) {
        const roots = { table: app.table.group, panel: app.panel.group, dock: app.dock.group, picker: app.picker.group };
        for (const [where, root] of Object.entries(roots)) {
          for (const t of ['pointerdown', 'pointerup', 'click', 'pointerenter', 'pointerleave', 'pointercancel']) {
            root.addEventListener(t, (e) => {
              const o = e.object ?? e.target;
              window.__rays?.push({ t, where, hit: o?.name || o?.parent?.name || o?.type, ptr: e.pointerType, id: e.pointerId, d: e.distance != null ? +e.distance.toFixed(3) : null });
            });
          }
        }
        window.__raySpied = true;
      }
      return 'recording';
    }
    const rays = {};
    for (const side of ['left', 'right']) {
      const space = origin?.raySpaces?.[side];
      if (!space) continue;
      space.updateWorldMatrix(true, false);
      const o = space.getWorldPosition(new V());
      const d = new V(0, 0, -1).transformDirection(space.matrixWorld);
      const ot = app.root.worldToLocal(o.clone());
      const dt = d.clone().transformDirection(app.root.matrixWorld.clone().invert());
      rays[side] = { origin: [+ot.x.toFixed(3), +ot.y.toFixed(3), +ot.z.toFixed(3)], dir: [+dt.x.toFixed(3), +dt.y.toFixed(3), +dt.z.toFixed(3)], visible: space.visible };
    }
    return { events: (window.__rays ?? []).slice(-40), rays, screen: app.screen, hint: app.hint.visible ? app.hintText : '' };
  }, process.env.MODE ?? 'read');
}
