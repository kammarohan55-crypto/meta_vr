// Dev-only: where things are for an emulated hand, in XR-origin metres (the frame the emulator's
// hand and headset commands use): every button on the open menu and action bar, your cards,
// the deck, the pile and the colour picker. Also the head pose and the angles each sits at from
// straight ahead, to check a narrow field of view (Meta VR Glasses: 37 deg left/right, 25 up, 43 down).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const renderer = app.warmup.renderer;
    const camera = app.warmup.camera;
    const origin = camera.parent; // the XR origin (player rig)
    origin?.updateWorldMatrix(true, false);
    const V = app.root.position.constructor;
    const toOrigin = (w) => {
      const p = w.clone();
      if (origin) origin.worldToLocal(p);
      return p;
    };
    const r3 = (p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });
    const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const head = new V();
    xrCam.getWorldPosition(head);
    const headO = toOrigin(head);
    // angles from the head looking straight down -Z of the table (the seat's forward)
    const fwd = new V(0, 0, -1).transformDirection(app.root.matrixWorld);
    const right = new V(1, 0, 0).transformDirection(app.root.matrixWorld);
    const up = new V(0, 1, 0);
    const angles = (w) => {
      const d = w.clone().sub(head);
      const f = d.dot(fwd);
      return { h: +((Math.atan2(d.dot(right), f) * 180) / Math.PI).toFixed(1), v: +((Math.atan2(d.dot(up), f) * 180) / Math.PI).toFixed(1), dist: +d.length().toFixed(2) };
    };
    const panelButtons = (p) => {
      const out = {};
      if (!p.visible) return out;
      const geo = p.mesh.geometry.parameters;
      p.mesh.updateWorldMatrix(true, false);
      for (const b of p.buttons) {
        const pt = new V(((b.x + b.w / 2) / p.W - 0.5) * geo.width, (0.5 - (b.y + b.h / 2) / p.H) * geo.height, 0);
        p.mesh.localToWorld(pt);
        out[b.id] = { ...r3(toOrigin(pt)), a: angles(pt), disabled: !!b.disabled };
      }
      return out;
    };
    const panelCorners = (p) => {
      if (!p.visible) return null;
      const geo = p.mesh.geometry.parameters;
      p.mesh.updateWorldMatrix(true, false);
      const c = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => angles(p.mesh.localToWorld(new V((sx * geo.width) / 2, (sy * geo.height) / 2, 0))));
      return { size: [+geo.width.toFixed(2), +geo.height.toFixed(2)], h: [Math.min(...c.map((a) => a.h)), Math.max(...c.map((a) => a.h))], v: [Math.min(...c.map((a) => a.v)), Math.max(...c.map((a) => a.v))] };
    };
    const wp = (o) => o.getWorldPosition(new V());
    const v = app.view;
    const cards = [];
    for (const hc of app.table.hand.values()) {
      const w = wp(hc.root);
      cards.push({ id: hc.card.id, kind: hc.card.kind, color: hc.card.color, value: hc.card.value, playable: !!v?.playable.includes(hc.card.id), ...r3(toOrigin(w)), a: angles(w) });
    }
    const pile = app.table.pileTop(new V());
    app.table.group.localToWorld(pile);
    const deck = wp(app.table.drawHit);
    const petals = app.picker.group.visible ? app.picker.petals.map((p) => ({ color: p.userData.color, ...r3(toOrigin(wp(p))) })) : [];
    const seats = [];
    for (const [seat] of app.cast.all()) {
      const w = app.seatHead(seat, new V());
      app.root.localToWorld(w);
      seats.push({ seat, ...r3(toOrigin(w)), a: angles(w) });
    }
    return {
      screen: app.screen,
      // false while the table is still animating moves the host has already made (the view is older than the game)
      settled: app.queue.length === 0 && !app.pendingView,
      immersive: app.immersive,
      head: r3(headO),
      tableRoot: r3(toOrigin(app.root.getWorldPosition(new V()))),
      panel: { shape: panelCorners(app.panel), buttons: panelButtons(app.panel) },
      dock: { shape: panelCorners(app.dock), buttons: panelButtons(app.dock) },
      hint: { shape: panelCorners(app.hint), text: app.hint.visible ? app.hintText : '' },
      cards,
      fan: cards.length ? { h: [Math.min(...cards.map((c) => c.a.h)), Math.max(...cards.map((c) => c.a.h))], v: [Math.min(...cards.map((c) => c.a.v)), Math.max(...cards.map((c) => c.a.v))] } : null,
      pile: { ...r3(toOrigin(pile)), a: angles(pile) },
      deck: { ...r3(toOrigin(deck)), a: angles(deck) },
      petals,
      seats,
      view: v ? { phase: v.phase, myTurn: v.current === v.seat, hand: v.hand.length, playable: v.playable.length, hasDrawn: v.hasDrawn, pending: v.pending, top: v.top, color: v.color } : null,
    };
  });
}
