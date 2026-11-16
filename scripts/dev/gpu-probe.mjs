// Dev-only: which GPU/renderer WebGL is using in the managed browser, and the canvas size.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const c = document.querySelector('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', canvas: [c.width, c.height], dpr: devicePixelRatio };
  });
}
