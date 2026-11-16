/**
 * GPU warm-up. The first time a material is drawn, WebGL compiles and links its shader, and the
 * first time a texture is drawn it is uploaded; done mid-game, either one freezes a frame (a world
 * switch measured 250–300 ms). This compiles every material in the scene, hidden ones included,
 * in the background (KHR_parallel_shader_compile where the browser has it) and uploads textures a
 * couple per frame, so effects, toys and worlds are ready before they are first seen.
 */
import type { Camera, Material, Mesh, Object3D, Scene, Texture, WebGLRenderer } from '@iwsdk/core';

export class Warmup {
  private queue: Texture[] = [];
  private queued = new Set<Texture>();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  /**
   * Compile every material in the scene against its current lights and fog. Resolves when all
   * shaders are ready, or after `maxMs` (a slow driver never holds anything up for long).
   */
  compile(maxMs = 4000): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      setTimeout(finish, maxMs);
      try {
        this.renderer.compileAsync(this.scene, this.camera).then(finish, finish);
      } catch {
        finish();
      }
    });
  }

  /** Queue every texture used under `root` for upload. */
  textures(root: Object3D): void {
    root.traverse((o) => {
      const mat = (o as Mesh).material as Material | Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        for (const v of Object.values(m)) this.offer(v);
        const uniforms = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
        if (uniforms) for (const u of Object.values(uniforms)) this.offer(u?.value);
      }
    });
  }

  private offer(v: unknown): void {
    const t = v as (Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean }) | null;
    // re-offering is fine: a texture already on the GPU and unchanged costs nothing to upload
    if (!t || !t.isTexture || t.isRenderTargetTexture || t.isVideoTexture || this.queued.has(t)) return;
    this.queued.add(t);
    this.queue.push(t);
  }

  /** Upload up to `n` queued textures now (call once a frame). */
  step(n = 2): void {
    for (let i = 0; i < n && this.queue.length; i++) {
      const t = this.queue.shift()!;
      this.queued.delete(t);
      const img = t.image as { complete?: boolean; width?: number; data?: unknown } | null;
      // only textures whose pixels are here; an image still loading uploads itself later
      if (!img || img.complete === false || (!img.width && !img.data) || t.version === 0) continue;
      try {
        this.renderer.initTexture(t);
      } catch {
        /* drawn normally later */
      }
    }
  }

  /** Upload everything queued now (while the screen is covered). */
  flush(): void {
    this.step(this.queue.length);
  }

  get pending(): number {
    return this.queue.length;
  }
}
