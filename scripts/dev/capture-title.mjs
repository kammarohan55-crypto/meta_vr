// Dev-only: seats a solo table and hides every panel, hint and your own fan so the
// running Frostpeak scene can be captured as menu art (an actual in-game frame).
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    app.startSolo();
    await new Promise((r) => setTimeout(r, 3500));
    for (const g of [app.panel.group, app.dock.group, app.hint.group, app.table.group, app.picker.group]) g.visible = false;
    app.hint.group.scale.setScalar(0);
    for (const [, av] of app.cast.all()) av.plate.mesh.visible = false;
    await new Promise((r) => setTimeout(r, 600));
    return 'ready for capture';
  });
}
