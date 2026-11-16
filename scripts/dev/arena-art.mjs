// Dev-only: show a world with the menus hidden (for capturing title and arena-card art).
// WORLD=shrine|domain|celestial|frostpeak; HIDE=1 hides the UI, HIDE=0 restores it.
export default async function run({ frame }) {
  return frame.evaluate(([world, hide]) => {
    const app = window.chaos;
    if (world && app.settings.world !== world) app.switchWorld(world);
    const show = hide !== '1';
    app.panel.group.visible = show;
    app.dock.group.visible = show && app.screen === 'game';
    app.hint.group.visible = false;
    return { world: app.settings.world, ui: show };
  }, [process.env.WORLD ?? '', process.env.HIDE ?? '1']);
}
