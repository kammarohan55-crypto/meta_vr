import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Record the real managed game and exercise its visible menu with real input. */
export default async function ({ page, frame, cdp, context, workspaceRoot }) {
  const folder = join(workspaceRoot, '.tmp', 'v4-motion-frames');
  await mkdir(folder, { recursive: true });
  await frame.waitForFunction(() => window.chaos?.lounge?.room && window.chaos?.lounge?.root.getObjectByName('Table_Walnut_Surface') && window.chaos?.root.getObjectByName('City_Window_View'));
  const canvas = frame.locator('#scene-container canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas is not visible');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const state = await frame.evaluate(() => {
    const app = window.chaos;
    const prior = { effects: app.settings.reducedEffects, flashing: app.settings.reducedFlashing };
    app.leaveTable(false);
    app.settings.reducedEffects = false;
    app.settings.reducedFlashing = false;
    app.applySettings();
    app.show('title');
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const controllers = [];
    scene.traverse((object) => {
      if (/^R2E_Pad/.test(object.name) && object.visible) controllers.push(object.name);
    });
    return { prior, controllers };
  });
  if (state.controllers.length) throw new Error(`Controller decoration still visible: ${state.controllers.join(', ')}`);
  const session = cdp?.send ? cdp : await context.newCDPSession(page);
  const frames = [];
  const stages = [];
  const mark = (name) => stages.push({ name, frame: frames.length, timestamp: Date.now() / 1000 });
  const onConsole = (message) => {
    const prefix = '__AFTERHOURS_MARK__';
    const text = message.text();
    if (text.startsWith(prefix)) stages.push({ ...JSON.parse(text.slice(prefix.length)), frame: frames.length });
  };
  page.on('console', onConsole);
  await frame.evaluate(() => {
    const fx = window.chaos.fx;
    const original = fx.update;
    const seen = new Set();
    fx.__previewOriginalUpdate = original;
    fx.__previewStage = '';
    fx.update = function (...args) {
      original.apply(this, args);
      const stage = this.__previewStage;
      const word = this.holos.get(stage === 'victory' ? 'youwin' : 'youlose');
      const ready = stage === 'draw-four' ? this.orbitT > 0.35 : word?.mesh.visible && word.t > 0.45;
      const name = `${stage}-still`;
      if (stage && ready && !seen.has(name)) {
        seen.add(name);
        console.log('__AFTERHOURS_MARK__' + JSON.stringify({ name, timestamp: Date.now() / 1000 }));
      }
    };
  });
  const pendingWrites = [];
  let recording = true;
  const onFrame = ({ data, sessionId, metadata }) => {
    if (!recording) return;
    const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, timestamp: metadata.timestamp });
    pendingWrites.push(writeFile(join(folder, file), Buffer.from(data, 'base64')));
    void session.send('Page.screencastFrameAck', { sessionId });
  };
  session.on('Page.screencastFrame', onFrame);
  const pointFor = async (id) => {
    const uv = await frame.evaluate((id) => {
      const app = window.chaos;
      const panel = app.panel;
      const b = panel.buttons.find((button) => button.id === id && !button.disabled);
      if (!b) throw new Error(`Missing active menu button: ${id}`);
      let scene = app.root;
      while (scene.parent) scene = scene.parent;
      const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
      if (!camera) throw new Error('Game camera not found');
      const p = app.viewer.clone().set(
        (b.x + b.w / 2) / panel.W * panel.mesh.geometry.parameters.width - panel.mesh.geometry.parameters.width / 2,
        panel.mesh.geometry.parameters.height / 2 - (b.y + b.h / 2) / panel.H * panel.mesh.geometry.parameters.height,
        0,
      );
      panel.mesh.updateWorldMatrix(true, false);
      panel.mesh.localToWorld(p);
      camera.updateWorldMatrix(true, false);
      p.project(camera);
      return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    }, id);
    return { x: bounds.x + bounds.width * uv.x, y: bounds.y + bounds.height * uv.y };
  };
  const hover = async (id) => {
    const p = await pointFor(id);
    await page.mouse.move(p.x, p.y, { steps: 14 });
  };
  const click = async (id) => {
    const p = await pointFor(id);
    await page.mouse.click(p.x, p.y, { delay: 120 });
  };
  const clickObject = async (kind, id) => {
    const uv = await frame.evaluate(({ kind, id }) => {
      const app = window.chaos;
      let scene = app.root;
      while (scene.parent) scene = scene.parent;
      const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
      const object = kind === 'card' ? app.table.hand.get(id)?.root : app.picker.petals[id];
      if (!object) throw new Error(`Missing ${kind} ${id}`);
      const p = app.viewer.clone().set(kind === 'card' ? -0.025 : 0, kind === 'card' ? 0.035 : 0, 0.002);
      object.updateWorldMatrix(true, false);
      object.localToWorld(p);
      camera.updateWorldMatrix(true, false);
      p.project(camera);
      return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    }, { kind, id });
    await page.mouse.click(bounds.x + bounds.width * uv.x, bounds.y + bounds.height * uv.y, { delay: 100 });
  };
  // Legal prepared scenarios let the recording show rare moments without
  // changing the product, weakening rules, or inventing pre-rendered effects.
  const prepare = async (mode) => {
    const result = await frame.evaluate(async (mode) => {
      const { makeDeck } = await import('/shared/rules.ts');
      const app = window.chaos;
      const local = app.conn;
      const host = local.host;
      host.cancelTimers();
      const pool = makeDeck();
      const take = (predicate) => {
        const index = pool.findIndex(predicate);
        if (index < 0) throw new Error('Invalid effect scenario');
        return pool.splice(index, 1)[0];
      };
      const top = take((c) => c.color === 0 && c.kind === 'num' && c.value === 5);
      const special = take((c) => mode === 'wild4' ? c.kind === 'wild4' : c.color === 0 && c.kind === 'num' && c.value === 7);
      const myIndex = host.gameIndex(0);
      const opponent = (myIndex + 1) % host.order.length;
      const current = mode === 'lose' ? opponent : myIndex;
      const players = host.order.map((seat, index) => {
        if (index === current) {
          const hand = [special];
          if (mode === 'wild4') while (hand.length < 7) hand.push(take((c) => c.color > 0 && c.kind === 'num'));
          return { hand };
        }
        return { hand: Array.from({ length: 7 }, () => take(() => true)) };
      });
      host.game = { rules: host.rules, rng: 7, players, drawPile: pool, discard: [top], current, direction: 1, color: 0, phase: 'play', drawnId: -1, hasDrawn: false, winner: -1, turn: (host.game?.turn ?? 0) + 20 };
      host.phase = 'game';
      app.queue.length = 0;
      app.wait = 0;
      app.pendingView = null;
      app.view = null;
      app.fx.clearWin();
      app.lounge.setMood(0);
      app.fx.__previewStage = mode === 'wild4' ? 'draw-four' : mode === 'win' ? 'victory' : 'defeat';
      app.picker.hide();
      app.show('game');
      local.setPaused(mode !== 'lose');
      host.publishLobby();
      host.publishViews();
      if (mode === 'lose') host.armTurn();
      return { special: special.id, mode, totalCards: players.reduce((n, p) => n + p.hand.length, 0) + pool.length + 1 };
    }, mode);
    if (result.totalCards !== 108) throw new Error('Prepared scenario lost a card');
    await frame.waitForFunction(() => window.chaos.view?.phase === 'play' && window.chaos.table.hand.size > 0, undefined, { timeout: 6000 });
    await page.waitForTimeout(550);
    return result;
  };
  try {
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1800, maxHeight: 1400, everyNthFrame: 1 });
    // Restart the opening animation inside the already loaded real game.
    await frame.evaluate(() => window.chaos.show('title'));
    mark('menu');
    await page.waitForTimeout(2500);
    await hover('host');
    await page.waitForTimeout(900);
    await hover('join');
    await page.waitForTimeout(900);
    await hover('solo');
    await page.waitForTimeout(900);
    mark('menu-still');
    await click('solo');
    await frame.waitForFunction(() => window.chaos.screen === 'solo', undefined, { timeout: 6000 });
    await page.waitForTimeout(1100);
    await click('start');
    await frame.waitForFunction(() => window.chaos.screen === 'game' && window.chaos.table.hand.size > 0, undefined, { timeout: 6000 });
    mark('gameplay');
    await page.waitForTimeout(4000);
    mark('gameplay-still');
    const wild = await prepare('wild4');
    mark('draw-four');
    await clickObject('card', wild.special);
    await frame.waitForFunction(() => window.chaos.picker.group.visible, undefined, { timeout: 6000 });
    await frame.waitForFunction(() => window.chaos.picker.petals.every((petal) => petal.scale.x > 0.995), undefined, { timeout: 10000 });
    await clickObject('color', 3);
    await frame.waitForFunction(() => !window.chaos.picker.group.visible && window.chaos.conn.host.game.discard.at(-1).kind === 'wild4', undefined, { timeout: 6000 });
    await page.waitForTimeout(3600);
    const win = await prepare('win');
    mark('victory');
    await clickObject('card', win.special);
    await frame.waitForFunction(() => window.chaos.conn.host.game.phase === 'over', undefined, { timeout: 6000 });
    await page.waitForTimeout(3800);
    await prepare('lose');
    mark('defeat');
    await frame.waitForFunction(() => window.chaos.conn.host.game.phase === 'over', undefined, { timeout: 6000 });
    await page.waitForTimeout(3500);
    const proof = await frame.evaluate(() => {
      const app = window.chaos;
      const atmosphere = app.lounge.root.getObjectByName('Lounge atmosphere');
      const names = [];
      atmosphere?.traverse((o) => { if (o.visible) names.push(o.name); });
      const interior = app.lounge.root.getObjectByName('Architectural lounge details');
      return {
        screen: app.screen,
        cards: app.table.hand.size,
        visibleAtmosphere: names,
        menuPhysicalSize: [app.panel.mesh.geometry.parameters.width, app.panel.mesh.geometry.parameters.height],
        interiorDetailDrawCalls: interior?.children.filter((child) => child.isMesh).length ?? 0,
        projectedCardDepthWrite: app.fx.heroCard.material.depthWrite,
        projectedCardCastsShadow: app.fx.heroCard.castShadow,
      };
    });
    await writeFile(join(folder, 'proof.json'), JSON.stringify(proof, null, 2));
    for (const name of ['draw-four-still', 'victory-still', 'defeat-still']) {
      if (!stages.some((stage) => stage.name === name)) throw new Error(`Effect did not render: ${name}`);
    }
  } finally {
    await session.send('Page.stopScreencast');
    recording = false;
    session.off('Page.screencastFrame', onFrame);
    page.off('console', onConsole);
    await Promise.all(pendingWrites);
    await writeFile(join(folder, 'timeline.json'), JSON.stringify({ frames, bounds, viewport, stages, preparedEffectsScenarios: true }, null, 2));
    await frame.evaluate((prior) => {
      const app = window.chaos;
      app.settings.reducedEffects = prior.effects;
      app.settings.reducedFlashing = prior.flashing;
      app.applySettings();
      if (app.fx.__previewOriginalUpdate) app.fx.update = app.fx.__previewOriginalUpdate;
      delete app.fx.__previewOriginalUpdate;
      delete app.fx.__previewStage;
    }, state.prior);
  }
  return { folder, frames: frames.length, duration: frames.length > 1 ? frames.at(-1).timestamp - frames[0].timestamp : 0, visibleControllerDecorations: state.controllers };
}
