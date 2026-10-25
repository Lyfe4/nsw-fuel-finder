/*
 * When a wide screen's map starts by itself. It sits beside the list, so it
 * normally starts as soon as the list has rendered and the browser is idle.
 *
 * Except where WebGL is drawn in software (no GPU, or a GPU the browser has
 * blocklisted). There MapLibre's first draw, mostly compiling its shaders,
 * blocks the page for one to two seconds while the visitor is trying to read
 * the list (measured in round 11: 990 ms of blocking on PageSpeed's desktop
 * test, 0 ms with a GPU). So there the map waits to be asked for, and the
 * first press is remembered for the rest of the visit.
 *
 * This file stays in the main bundle and is tiny: deciding must not download
 * MapLibre.
 */

/**
 * The renderers browsers use when there is no usable GPU: Chrome's
 * SwiftShader, Mesa's llvmpipe and softpipe (Firefox on Linux), and Windows'
 * Basic Render Driver (WARP).
 */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

let software: boolean | undefined;
let chosen = false;

function rendererName(gl: WebGLRenderingContext): string {
  // Firefox reports the real name here; Chrome says "WebKit WebGL" and keeps
  // it behind the debug extension, which Firefox has deprecated.
  const name = String(gl.getParameter(gl.RENDERER));
  if (name !== 'WebKit WebGL') return name;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : name;
}

/**
 * Whether WebGL here is drawn in software. Asked once, with a throwaway
 * context that is released at once (browsers allow only a few at a time).
 * No WebGL at all is not "software": the map then fails as before and says
 * so. An unknown renderer counts as a GPU, so the map starts as it always did.
 */
export function drawsInSoftware(): boolean {
  if (software === undefined) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    software = gl !== null && SOFTWARE.test(rendererName(gl));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return software;
}

/** The visitor asked for the map; later searches start it without asking. */
export function chooseMap(): void {
  chosen = true;
}

export function mapChosen(): boolean {
  return chosen;
}

/**
 * Runs `callback` once the browser is idle (so the list paints first), or
 * after a second at most. Safari has no requestIdleCallback; a timeout lets
 * the current render finish there. Returns a cancel function.
 */
export function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = setTimeout(callback, 0);
  return () => {
    clearTimeout(id);
  };
}

/** For tests. */
export function resetMapStartForTests(): void {
  software = undefined;
  chosen = false;
}
