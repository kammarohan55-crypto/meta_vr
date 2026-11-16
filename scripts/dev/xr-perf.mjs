// Dev-only: what a frame costs inside an immersive (VR) session, where the scene is drawn once
// per eye. THROTTLE slows the CPU (4 stands in for a Quest 2-class chip against this laptop,
// 3 for a Quest 3). Times the whole frame callback (every IWSDK system plus the draw submit),
// the game's own update and the renderer, and reads draw calls and triangles per frame.
//   SOLO=3  start a solo game with that many computer players first (state set-up, not input proof)
//   FRAMES  frames to sample (default 240)
export default async function run({ frame, cdp }) {
  const rate = Number(process.env.THROTTLE ?? 1);
  const solo = process.env.SOLO ? Number(process.env.SOLO) : 0;
  if (solo) {
    await frame.evaluate(async (n) => {
      const app = window.chaos;
      if (app.screen !== 'game') {
        app.solo.opponents = n;
        app.settings.tutorial = false;
        app.startSolo();
      }
      // let the deal and the first turns settle
      await new Promise((r) => setTimeout(r, 6000));
    }, solo);
  }
  if (cdp && rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  try {
    return await frame.evaluate(async (frames) => {
      const app = window.chaos;
      const renderer = app.warmup.renderer;
      const xr = renderer.xr;
      const session = xr.getSession?.() ?? null;
      const target = session ?? window;
      const whole = [];
      const stamps = [];
      const renderMs = [];
      const updateMs = [];
      const callsSeen = [];
      const trisSeen = [];
      let inFrame = 0;
      let renderAcc = 0;
      let callAcc = 0;
      let triAcc = 0;

      const origRaf = target.requestAnimationFrame;
      target.requestAnimationFrame = function (cb) {
        return origRaf.call(target, (t, f) => {
          const t0 = performance.now();
          stamps.push(t0);
          renderAcc = 0;
          callAcc = 0;
          triAcc = 0;
          inFrame++;
          try {
            return cb(t, f);
          } finally {
            whole.push(performance.now() - t0);
            renderMs.push(renderAcc);
            callsSeen.push(callAcc);
            trisSeen.push(triAcc);
          }
        });
      };
      const origRender = renderer.render;
      renderer.render = function (...a) {
        const t0 = performance.now();
        try {
          return origRender.apply(this, a);
        } finally {
          renderAcc += performance.now() - t0;
          callAcc += renderer.info.render.calls;
          triAcc += renderer.info.render.triangles;
        }
      };
      const origUpdate = app.update;
      app.update = function (...a) {
        const t0 = performance.now();
        try {
          return origUpdate.apply(this, a);
        } finally {
          updateMs.push(performance.now() - t0);
        }
      };

      const t0 = performance.now();
      while (whole.length < frames + 5 && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
      target.requestAnimationFrame = origRaf;
      renderer.render = origRender;
      app.update = origUpdate;

      const stat = (a) => {
        if (!a.length) return null;
        const s = [...a].sort((x, y) => x - y);
        const avg = s.reduce((x, y) => x + y, 0) / s.length;
        return { avg: +avg.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length };
      };
      const gaps = [];
      for (let i = 6; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
      const cam = xr.isPresenting ? xr.getCamera() : null;
      const cv = renderer.domElement;
      const size = { x: cv.width, y: cv.height };
      const layer = session?.renderState?.baseLayer;
      let scene = app.root;
      while (scene.parent) scene = scene.parent;
      let lights = 0;
      let shadowLights = 0;
      const maps = [];
      scene.traverse((o) => {
        if (o.isLight && o.visible && !o.isAmbientLight && !o.isHemisphereLight) {
          lights++;
          if (o.castShadow) {
            shadowLights++;
            maps.push(`${o.type} ${o.shadow.mapSize.x}x${o.shadow.mapSize.y}`);
          }
        }
      });
      return {
        screen: app.screen,
        presenting: xr.isPresenting,
        eyes: cam?.cameras?.length ?? 1,
        frameRate: session?.frameRate ?? null,
        supportedFrameRates: session?.supportedFrameRates ? [...session.supportedFrameRates] : null,
        eyeBuffer: layer ? [layer.framebufferWidth, layer.framebufferHeight] : null,
        drawingBuffer: [size.x, size.y],
        pixelRatio: renderer.getPixelRatio(),
        foveation: xr.getFoveation?.() ?? null,
        shadows: { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, auto: renderer.shadowMap.autoUpdate, lights: shadowLights, maps },
        lights,
        frameInterval: stat(gaps),
        wholeFrameCpu: stat(whole.slice(5)),
        gameUpdate: stat(updateMs.slice(5)),
        renderSubmit: stat(renderMs.slice(5)),
        drawCalls: Math.max(...callsSeen.slice(5)),
        triangles: Math.max(...trisSeen.slice(5)),
        programs: renderer.info.programs.length,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
      };
    }, Number(process.env.FRAMES ?? 240));
  } finally {
    if (cdp && rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
