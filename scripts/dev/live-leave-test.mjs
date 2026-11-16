// Dev-only: on the live (or any) deployment, join a Quick match table, then press "Leave room"
// with a real mouse click at the button's on-screen position, and check the player is back at the
// title with no connection (the public table must not deal for them afterwards).
export default async function run({ context }) {
  const url = process.env.URL ?? 'https://afterhours.chaos-table.workers.dev/';
  const page = await context.newPage();
  const out = [];
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url, { waitUntil: 'load' });
    for (let i = 0; i < 80 && !(await page.evaluate(() => !!window.chaos).catch(() => false)); i++) await page.waitForTimeout(250);
    await page.evaluate(() => void window.chaos.quickMatch());
    for (let i = 0; i < 80 && !(await page.evaluate(() => window.chaos.screen === 'lobby' && !!window.chaos.lobby?.quick)); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(1500); // the panel's intro settles
    const pos = await page.evaluate(() => {
      const app = window.chaos;
      const p = app.panel;
      const b = p.buttons.find((x) => x.id === 'leave');
      if (!b) return null;
      const geo = p.mesh.geometry.parameters;
      let scene = app.root;
      while (scene.parent) scene = scene.parent;
      const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
      const pt = p.mesh.position.clone().set(((b.x + b.w / 2) / p.W - 0.5) * geo.width, (0.5 - (b.y + b.h / 2) / p.H) * geo.height, 0);
      p.mesh.updateWorldMatrix(true, false);
      p.mesh.localToWorld(pt);
      pt.project(camera);
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { x: r.left + ((pt.x + 1) / 2) * r.width, y: r.top + ((1 - pt.y) / 2) * r.height, code: app.lobby.code };
    });
    out.push(`at public table ${pos?.code}; Leave room at ${Math.round(pos?.x)},${Math.round(pos?.y)}`);
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ screen: window.chaos.screen, connected: !!window.chaos.conn, lobby: !!window.chaos.lobby }));
    out.push(`after the click: ${JSON.stringify(after)}`);
    await page.waitForTimeout(3000);
    const later = await page.evaluate(() => ({ screen: window.chaos.screen, view: !!window.chaos.view }));
    out.push(`3 s later: ${JSON.stringify(later)}`);
  } catch (e) {
    out.push(`FAILED: ${e.message}`);
  } finally {
    await page.evaluate(() => window.chaos?.leaveTable()).catch(() => {});
    await page.close().catch(() => {});
  }
  return out;
}
