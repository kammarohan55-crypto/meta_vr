// Dev-only helper for agents: starts a solo round through the app's own action
// (the same entry the Play solo -> Deal buttons call) so the gameplay scene can be
// inspected. It is not evidence that menu input works; test real clicks separately.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    if (!app) return 'window.chaos missing';
    app.startSolo();
    await new Promise((r) => setTimeout(r, 2500));
    return 'solo started';
  });
}
