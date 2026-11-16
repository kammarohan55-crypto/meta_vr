// Dev-only: a cold start of a built copy of the game (URL=..., default the live deployment),
// with the browser cache off: how long until the title is up and usable, and what was downloaded
// to get there (bytes on the wire, largest files first). Run against `npm run cloud:dev` or the
// live address; the dev server's unbundled modules say nothing about a real start.
export default async function run({ context }) {
  const url = process.env.URL ?? 'https://afterhours.chaos-table.workers.dev/';
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const out = { url };
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const urls = new Map();
    const done = [];
    cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
    cdp.on('Network.loadingFinished', (e) => done.push({ url: urls.get(e.requestId) ?? '?', bytes: e.encodedDataLength, at: Date.now() }));
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit' });
    const mark = async (name, test, limit = 60000) => {
      const start = Date.now();
      while (Date.now() - start < limit) {
        if (await page.evaluate(test).catch(() => false)) {
          out[name] = +((Date.now() - t0) / 1000).toFixed(2);
          return;
        }
        await page.waitForTimeout(50);
      }
      out[name] = null;
    };
    await mark('appStarted', () => !!window.chaos);
    await mark('titleUp', () => !!window.chaos && !document.getElementById('loading'));
    await mark('soundsReady', () => !!window.chaos?.sound?.ready);
    const atTitle = t0 + (out.titleUp ?? 0) * 1000;
    await page.waitForTimeout(4000);
    const size = (list) => +(list.reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(2);
    const name = (u) => u.replace(new URL(url).origin, '').split('?')[0];
    out.beforeTitle = { files: done.filter((r) => r.at <= atTitle).length, MB: size(done.filter((r) => r.at <= atTitle)) };
    out.total = { files: done.length, MB: size(done) };
    out.largest = [...done].sort((a, b) => b.bytes - a.bytes).slice(0, 14).map((r) => `${(r.bytes / 1024).toFixed(0)} KB  ${((r.at - t0) / 1000).toFixed(1)} s  ${name(r.url)}`);
  } catch (e) {
    out.error = e.message;
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}
