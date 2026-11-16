/**
 * The bridge between IWSDK and the game: places the table around the seated
 * player, reads head and hand tracking every frame (pinch point, pinch state,
 * wrist and fingertips), registers the menus and cards as ray/poke targets,
 * and launches VR or mixed reality.
 */
import { Matrix4, Object3D, PokeInteractable, Quaternion, RayInteractable, SessionMode, Vector3, createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { ChaosApp } from './game/app.js';
import type { FrameInput } from './game/app.js';
import { Warmup } from './game/warmup.js';

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];
const TIPS: XRHandJoint[] = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];

/** Where your head sits relative to the table centre when you are seated at it (table space). */
const SEAT_HEAD = new Vector3(0, 1.14, 0.98);
const UP = new Vector3(0, 1, 0);
/** A view narrower than this to each side (Meta VR Glasses show 37 degrees) gets the compact layout. */
const NARROW_HALF_FOV = (42 * Math.PI) / 180;
/** Your head this far above or below the seat for a couple of seconds means you stood up or sat down. */
const SEAT_HEIGHT_SLACK = 0.28;

/** An immersive session with the display-rate controls (WebXR "nominal frame rate"; Quest Browser has them). */
type PacedSession = XRSession & {
  frameRate?: number;
  supportedFrameRates?: Float32Array;
  updateTargetFrameRate?: (rate: number) => Promise<void>;
};

const _m = new Matrix4();
const _inv = new Matrix4();
const _p = new Vector3();
const _p2 = new Vector3();
const _q = new Quaternion();
const _rootQInv = new Quaternion();
const _wq = new Quaternion();

export class ChaosSystem extends createSystem({}) {
  app!: ChaosApp;
  private rootEntity!: Entity;
  private wired = new WeakSet<Object3D>();
  private placed = false;
  private sessionTime = 0;
  private wasImmersive = false;
  private offSeat = 0;
  /** Seconds your head has been well above or below the seat, and the table height being eased to. */
  private offHeight = 0;
  private seatY: number | null = null;
  private fovClock = 0;
  private xrHidden = false;
  private fwdV = new Vector3();
  private seatV = new Vector3();
  private desktopFov = 68;
  private framingAspect = -1;
  private framingImmersive = false;
  private input_: FrameInput = {
    head: new Vector3(),
    headQ: new Quaternion(),
    hands: {
      left: { pos: null, pinching: false, started: false, ended: false, joints: null },
      right: { pos: null, pinching: false, started: false, ended: false, joints: null },
    },
    immersive: false,
  };
  private handPos: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  private joints: Record<Side, number[]> = { left: [], right: [] };

  init(): void {
    this.desktopFov = this.camera.fov;
    const app = new ChaosApp();
    this.app = app;
    this.rootEntity = this.world.createTransformEntity(app.root);
    // the menus take rays and finger pokes
    for (const obj of [app.panel.group, app.dock.group, app.picker.group]) {
      const e = this.world.createTransformEntity(obj, { parent: this.rootEntity });
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
    }
    // Your cards and the deck take rays and gaze (point or look, then pinch). No poke: brushing
    // a card mustn't play it. Each is a small target of its own, not the table as a whole: a
    // gaze picks among targets by their bounding boxes, and one box round the entire table
    // stopped it finding the cards in front of you once the table had filled up.
    const tableEnt = this.world.createTransformEntity(app.table.group, { parent: this.rootEntity });
    for (const obj of [app.table.handGroup, app.table.drawHit]) {
      const e = this.world.createTransformEntity(obj, { parent: tableEnt });
      e.addComponent(RayInteractable);
    }

    app.onEnterXR = (mr) => this.enter(mr);
    app.onRecenter = () => this.recenter();
    // Pause solo games when the headset is taken off or the system menu opens, and fall silent
    // while nobody is there to hear it (headset off, or the browser tab hidden).
    const away = () => app.setAway(this.xrHidden || document.hidden);
    this.cleanupFuncs.push(
      this.visibilityState.subscribe((v) => {
        if (v !== 'visible' && app.screen === 'game' && app.conn && !app.conn.online) app.show('pause');
        this.xrHidden = v === 'hidden';
        away();
      }),
    );
    document.addEventListener('visibilitychange', away);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', away));
    // Pointing at something lifts it, so a hand ray or a gaze (the glasses draw no cursor) always
    // shows what a pinch will pick: the deck here, each card as it is dealt (wireCards), the colours.
    const hover = (obj: Object3D, set: (on: boolean) => void) => {
      const o = obj as unknown as { addEventListener(t: string, f: () => void): void };
      o.addEventListener('pointerenter', () => set(true));
      o.addEventListener('pointerleave', () => set(false));
      o.addEventListener('pointercancel', () => set(false));
    };
    this.hover = hover;
    hover(app.table.drawHit, (on) => app.table.pointAtDeck(on));
    for (const p of app.picker.petals) hover(p, (on) => app.pointAtColor(p.userData.color as number, on));
    // shaders and textures are prepared in the background so nothing stalls a frame on first use
    app.warmup = new Warmup(this.renderer, this.scene, this.camera);
    void app.lounge
      .load((k) => {
        const el = document.getElementById('loading');
        if (el) el.textContent = k < 1 ? `Setting the table… ${Math.round(k * 100)}%` : '';
        if (k >= 1) el?.remove();
      })
      .then(() => app.prewarm());
    (window as unknown as { chaos: ChaosApp }).chaos = app;
  }

  enter(mr: boolean): void {
    this.app.mixedReality = mr;
    this.app.lounge.setMixedReality(mr);
    this.world.launchXR(mr ? { sessionMode: SessionMode.ImmersiveAR } : {});
  }

  private hover!: (obj: Object3D, set: (on: boolean) => void) => void;

  /**
   * Put the table in front of the player so their seat is where they are sitting, at their
   * height: on a sofa, a bed, a bar stool or standing, your eyes are always the same 40 cm
   * above the table top, with your cards, the pile and the menus where a seated player has
   * them. (A table fixed to the floor left a standing player's cards 60 degrees below their
   * view.) In mixed reality the table stands on the real floor instead.
   */
  private place(head: Vector3, headQ: Quaternion): void {
    // (own vectors: callers pass the shared scratch vectors in)
    const fwd = this.fwdV.set(0, 0, -1).applyQuaternion(headQ);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const root = this.app.root;
    root.rotation.set(0, yaw, 0);
    const seat = this.seatV.set(SEAT_HEAD.x, 0, SEAT_HEAD.z).applyAxisAngle(UP, yaw);
    root.position.set(head.x - seat.x, this.app.mixedReality ? 0 : head.y - SEAT_HEAD.y, head.z - seat.z);
    root.updateMatrixWorld(true);
    this.placed = true;
    this.seatY = null;
    this.offHeight = 0;
  }

  /** Re-seat the player (from the pause menu, or after the headset recenters). */
  recenter(): void {
    this.placed = false;
  }

  update(dt: number): void {
    const app = this.app;
    const immersive = !!this.world.xrSession;
    this.fitDesktopFraming(immersive);
    if (immersive !== this.wasImmersive) {
      this.wasImmersive = immersive;
      const ref = this.world.xrReferenceSpace;
      ref?.addEventListener?.('reset', () => this.recenter());
      this.sessionTime = 0;
      this.placed = false;
      this.seatY = null;
      this.offHeight = 0;
      this.fovClock = 0;
      if (!immersive) {
        // back on the flat screen: the table returns to the origin, where the camera sits
        app.root.position.set(0, 0, 0);
        app.root.rotation.set(0, 0, 0);
        app.mixedReality = false;
        app.lounge.setMixedReality(false);
        app.setNarrowView(false);
      }
    }
    this.sessionTime += dt;
    if (immersive) this.fitToView(dt);
    this.govern(immersive);

    // head, in world space
    const headObj = immersive ? this.player.head : this.camera;
    headObj.updateMatrixWorld();
    headObj.getWorldPosition(_p);
    headObj.getWorldQuaternion(_q);
    // wait a moment for tracking to settle before seating the player
    if (immersive && !this.placed && this.sessionTime > 0.4) this.place(_p, _q);
    // if the headset recentred or the rig moved, the seat is no longer where you are: re-seat after a moment
    if (immersive && this.placed) {
      const local = _p2.copy(_p).applyMatrix4(_inv.copy(app.root.matrixWorld).invert());
      const off = Math.hypot(local.x - SEAT_HEAD.x, local.z - SEAT_HEAD.z);
      this.offSeat = off > 0.7 ? this.offSeat + dt : 0;
      if (this.offSeat > 1.5) {
        this.offSeat = 0;
        this.place(_p, _q);
      } else if (!app.mixedReality) {
        // You stood up or sat down: after two seconds the table glides to your new height.
        // Leaning and looking about stay well inside the slack, so the table never drifts in play.
        const dy = local.y - SEAT_HEAD.y;
        this.offHeight = Math.abs(dy) > SEAT_HEIGHT_SLACK ? this.offHeight + dt : 0;
        if (this.offHeight > 2 && this.seatY === null) this.seatY = app.root.position.y + dy;
        if (this.seatY !== null) {
          const rest = this.seatY - app.root.position.y;
          // an eased glide, never faster than 0.6 m/s
          const step = Math.sign(rest) * Math.min(Math.abs(rest), Math.min(0.6 * dt, Math.abs(rest) * (1 - Math.exp(-dt * 5)) + 0.0005));
          app.root.position.y += step;
          if (Math.abs(this.seatY - app.root.position.y) < 0.001) {
            this.seatY = null;
            this.offHeight = 0;
          }
        }
      }
    }

    const root = app.root;
    // Only the table root's own matrix is needed here. The renderer refreshes the whole scene
    // once per frame anyway; a second full pass over the table's ~460 objects cost ~1 ms of CPU.
    root.updateWorldMatrix(true, false);
    _inv.copy(root.matrixWorld).invert();
    root.getWorldQuaternion(_rootQInv).invert();
    const inp = this.input_;
    inp.immersive = immersive;
    inp.head.copy(_p).applyMatrix4(_inv);
    inp.headQ.copy(_rootQInv).multiply(_q);

    for (const side of SIDES) this.readHand(side, immersive);

    app.update(dt, inp);
    this.wireCards();
  }

  /**
   * How wide this headset sees, read from its own projection once a second. Meta VR Glasses
   * show 37 degrees to each side against a Quest's 45 to 54, so the action bar and hints move
   * to where a narrow view still holds them (see ChaosApp.setNarrowView).
   */
  private fitToView(dt: number): void {
    this.fovClock -= dt;
    if (this.fovClock > 0) return;
    this.fovClock = 1;
    // a world changed in lean mode brings a fresh shadow-casting light: put it out too
    if (this.app.quality >= 2) this.castShadows(false);
    // a gaze source means looking picks and a pinch selects, so the hints say so
    let gaze = false;
    const sources = this.world.xrSession?.inputSources;
    if (sources) for (const s of sources) if (s.targetRayMode === 'gaze') gaze = true;
    this.app.gaze = gaze;
    // The projection gives the real angle on a device. The desktop emulator draws its own wide
    // preview and masks the glasses' view over it, so there the gaze source is the telltale.
    const eye = this.renderer.xr.getCamera().cameras[0];
    const m0 = eye?.projectionMatrix.elements[0];
    const narrowLens = !!m0 && Number.isFinite(m0) && Math.atan(1 / m0) < NARROW_HALF_FOV;
    this.app.setNarrowView(gaze || narrowLens);
  }

  // frame-rate watch (immersive sessions): frames and seconds in the current window
  private watchFrames = 0;
  private watchTime = 0;
  private watchHold = 0;
  private lastFrameAt = 0;
  private frameNo = 0;
  private slowWindows = 0;
  private bestFps = 0;
  private xrWarmed = false;

  /**
   * Keep a headset above the competition's 60 fps floor on hardware this was never run on.
   * In a headset the game starts at quality 1 (shadow map redrawn every other frame, which a
   * 72 Hz display cannot show as lag; your own cards cast no shadow). If the measured rate then
   * stays slow (under 57 fps) for nine seconds, it steps down to quality 2: no shadow pass at all, and
   * the world thins its mist and snow. It never steps back up in the same session, so the
   * picture does not flip back and forth. A monitor always gets full quality.
   */
  private govern(immersive: boolean): void {
    const now = performance.now();
    const real = (now - this.lastFrameAt) / 1000;
    this.lastFrameAt = now;
    const app = this.app;
    const shadows = this.renderer.shadowMap;
    if (!immersive) {
      if (app.quality !== 0) {
        app.setQuality(0);
        this.castShadows(true);
      }
      shadows.autoUpdate = true;
      return;
    }
    if (app.quality === 0) {
      app.setQuality(1);
      this.watchHold = 8;
      this.slowWindows = 0;
      this.bestFps = 0;
      this.xrWarmed = false;
      this.rateEased = false;
      this.busyFor = 0;
      app.displayRate = 0;
    }
    // A headset draws both eyes in one pass (multiview), which needs its own build of every
    // shader. The ones on screen compile as the session opens; this builds the rest (effects,
    // toys, magic circles kept hidden until used) in the background, so none stalls a frame the
    // first time it appears in VR. It must run here, inside a headset frame.
    if (!this.xrWarmed && this.sessionTime > 1) {
      this.xrWarmed = true;
      app.warmShaders(8000);
    }
    this.frameNo++;
    if (app.quality === 1) {
      shadows.autoUpdate = false;
      // (every frame while a world is being swapped in: a light that has just arrived must not
      // go a frame without its shadow map, or everything it lights fails to draw that frame)
      if (this.frameNo & 1 || app.busy) shadows.needsUpdate = true;
    } else shadows.autoUpdate = true;
    // The first seconds of a session, a world change, a hidden or blurred view and one-off
    // hitches say nothing about the steady frame rate.
    if (this.watchHold > 0) {
      this.watchHold -= Math.min(real, 0.25);
      this.watchFrames = this.watchTime = 0;
      return;
    }
    // (Busy for half a minute on end is not start-up: something never finished loading on this
    // device. The watch must not wait on it for ever.)
    const busy = app.busy && this.busyFor < 30;
    this.busyFor = app.busy ? this.busyFor + Math.min(real, 0.25) : 0;
    if (busy || this.visibilityState.peek() !== 'visible') {
      this.watchFrames = this.watchTime = 0;
      this.slowWindows = 0;
      return;
    }
    if (real > 0.1) return;
    this.watchFrames++;
    this.watchTime += real;
    if (this.watchTime < 3) return;
    const fps = this.watchFrames / this.watchTime;
    this.watchFrames = this.watchTime = 0;
    app.fps = fps;
    app.fpsLog.push(Math.round(fps));
    if (app.fpsLog.length > 40) app.fpsLog.shift();
    // A headset reports its display rate and paces frames to it, so a tenth of them missing is
    // slow. The desktop emulator reports the emulated headset's 90 while the monitor paces it at
    // 60; there, and on a device that reports nothing, slow means under 57 fps, or under four
    // fifths of the best rate measured this session if that is lower (a 60 Hz display may dip
    // to 58 without anything being wrong).
    this.bestFps = Math.max(this.bestFps, fps);
    const session = this.world.xrSession as PacedSession | undefined;
    const rate = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV ? 0 : session?.frameRate || 0;
    const slow = rate ? fps < rate * 0.9 : fps < Math.min(57, this.bestFps * 0.8);
    // three slow windows in a row (nine seconds), so a burst of shader compiles or a deal is not mistaken for a slow device
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 3) return;
    this.slowWindows = 0;
    this.watchHold = 5;
    // First the display rate (the picture stays as it is), then the picture.
    if (this.easeRate(session, fps)) return;
    if (app.quality < 2) {
      app.setQuality(app.quality + 1);
      this.castShadows(false);
      console.info(`[afterhours] ${fps.toFixed(0)} fps in the headset: drawing less (quality ${app.quality}).`);
    }
  }

  /**
   * Ask a display running faster than 72 Hz for 72 (Quest 2 and 3 open a WebXR session at 90):
   * a steady 72 is smoother than a 90 that keeps missing frames, and gives every frame 2.8 ms
   * more. Asked once a session; true if it was asked now.
   */
  private easeRate(session: PacedSession | undefined, fps: number): boolean {
    if (this.rateEased || !session?.updateTargetFrameRate || !session.supportedFrameRates) return false;
    const now = session.frameRate ?? 0;
    let want = 0;
    for (const r of session.supportedFrameRates) if (r >= 72 && r < now - 1 && (!want || r < want)) want = r;
    if (!want) return false;
    this.rateEased = true;
    this.app.displayRate = want;
    session.updateTargetFrameRate(want).catch(() => {});
    console.info(`[afterhours] ${fps.toFixed(0)} fps at ${now} Hz in the headset: asking the display for ${want} Hz.`);
    return true;
  }
  private rateEased = false;
  private busyFor = 0;

  /**
   * Turn the world's shadow-casting lights off or back on. With none, three skips the shadow
   * pass and the shaders drop their shadow lookups. Called again after a world change (the new
   * world brings its own light).
   */
  private castShadows(on: boolean): void {
    this.app.lounge.root.traverse((o) => {
      const light = o as Object3D & { isLight?: boolean; castShadow: boolean };
      if (!light.isLight) return;
      if (!on && light.castShadow) {
        light.userData.castsShadow = true;
        light.castShadow = false;
      } else if (on && light.userData.castsShadow) light.castShadow = true;
    });
  }

  /** Keep the whole table and wide launch menu in view in narrow desktop panes. */
  private fitDesktopFraming(immersive: boolean): void {
    const camera = this.camera;
    if (this.framingAspect === camera.aspect && this.framingImmersive === immersive) return;
    this.framingAspect = camera.aspect;
    this.framingImmersive = immersive;
    // Headsets use their own tracked projection; this only frames the monitor view.
    const horizontalHalfFov = 52.5 * Math.PI / 180;
    const desktopFit = 2 * Math.atan(Math.tan(horizontalHalfFov) / Math.max(0.5, camera.aspect)) * 180 / Math.PI;
    camera.fov = immersive ? this.desktopFov : Math.max(this.desktopFov, Math.min(112, desktopFit));
    camera.updateProjectionMatrix();
  }

  private readHand(side: Side, immersive: boolean): void {
    const h = this.input_.hands[side];
    h.pos = null;
    h.joints = null;
    h.started = false;
    h.ended = false;
    h.pinching = false;
    if (!immersive) return;
    const xr = this.input.xr;
    const src = xr.getPrimaryInputSource(side);
    if (!src) return;
    const sel = xr.getSelectState(side);
    h.started = sel.start;
    h.ended = sel.end;
    h.pinching = sel.active;
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    // reference-space poses -> world (through the XR origin) -> table
    this.player.updateMatrixWorld();
    _m.multiplyMatrices(_inv, this.player.matrixWorld);
    if (src.hand && frame && ref && frame.getJointPose) {
      const thumb = frame.getJointPose(src.hand.get('thumb-tip')!, ref);
      const index = frame.getJointPose(src.hand.get('index-finger-tip')!, ref);
      if (!thumb || !index) return;
      // the pinch point is between thumb and index tips
      const a = thumb.transform.position;
      const b = index.transform.position;
      h.pos = this.handPos[side].set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).applyMatrix4(_m);
      // wrist + fingertips for your avatar as others see it
      const wrist = frame.getJointPose(src.hand.get('wrist')!, ref);
      if (wrist) {
        const j = this.joints[side];
        j.length = 0;
        const w = wrist.transform;
        _p.set(w.position.x, w.position.y, w.position.z).applyMatrix4(_m);
        // table-space wrist orientation = inverse(table) * origin * joint
        this.player.getWorldQuaternion(_q);
        _q.premultiply(_rootQInv).multiply(_wq.set(w.orientation.x, w.orientation.y, w.orientation.z, w.orientation.w));
        j.push(r4(_p.x), r4(_p.y), r4(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w));
        for (const tip of TIPS) {
          const tp = frame.getJointPose(src.hand.get(tip)!, ref);
          if (!tp) {
            j.length = 0;
            break;
          }
          _p.set(tp.transform.position.x, tp.transform.position.y, tp.transform.position.z).applyMatrix4(_m);
          j.push(r4(_p.x), r4(_p.y), r4(_p.z));
        }
        h.joints = j.length === 22 ? j : null;
      }
      return;
    }
    // a controller still works: its grip is the "pinch point", the trigger is the pinch
    const grip = this.player.gripSpaces[side];
    grip.updateMatrixWorld();
    h.pos = this.handPos[side].setFromMatrixPosition(grip.matrixWorld).applyMatrix4(_inv);
  }

  /** Cards come and go: give each new one a click handler once. */
  private wireCards(): void {
    for (const { id, obj } of this.app.cardTargets()) {
      if (this.wired.has(obj)) continue;
      this.wired.add(obj);
      (obj as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('click', () => this.app.clickCard(id));
      this.hover(obj, (on) => this.app.table.pointAtCard(id, on));
    }
  }
}

function r4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}
