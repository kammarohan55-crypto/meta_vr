// Dev-only: MODE=start records the menu panel's pointer events (type, uv, local hit point);
// MODE=read returns them. Shows what a real click actually delivers to the panel.
export default async function run({ frame }) {
  return frame.evaluate((mode) => {
    const p = window.chaos.panel;
    if (mode === 'start') {
      window.__ptr = [];
      if (!p.__spied) {
        for (const t of ['pointerdown', 'pointerup', 'click']) {
          p.mesh.addEventListener(t, (e) => {
            const local = e.point ? p.mesh.worldToLocal(e.point.clone()) : null;
            window.__ptr?.push({
              t,
              uv: e.uv ? [+e.uv.x.toFixed(3), +e.uv.y.toFixed(3)] : null,
              local: local ? [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)] : null,
              face: e.face ? [+e.face.normal.z.toFixed(2)] : null,
            });
          });
        }
        p.__spied = true;
      }
      return 'recording';
    }
    const q = p.group.quaternion;
    return { events: window.__ptr ?? [], screen: window.chaos.screen, quat: [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(3)), buttons: p.buttons.length };
  }, process.env.MODE ?? 'read');
}
