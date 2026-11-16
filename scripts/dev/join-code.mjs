// Dev-only: start joining CODE (default a code nobody hosts) through the app, without waiting.
export default async function run({ frame }) {
  return frame.evaluate((code) => {
    void window.chaos.joinOnline(code);
    return { screen: window.chaos.screen, status: window.chaos.status };
  }, process.env.CODE ?? 'ZZZZQ');
}
