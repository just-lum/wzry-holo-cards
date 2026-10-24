const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../viewer/renderer.js'), 'utf8');

// A controllable browser boundary: images resolve in any order and GL owns real
// resource identities, so tests can detect stale cards and leaked replacements.
function browser({ failCompile = false, failLink = false, maxSize = 4096 } = {}) {
  let next = 0;
  const live = new Set();
  const requests = [];
  const uniforms = new Map();
  const bindings = new Map();
  const listeners = new Map();
  const calls = { contexts: 0, programs: 0, draws: [], options: null };
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  let unit = 0;
  let framebuffer = null;
  let lost = false;
  let glError = 0;
  const gl = {
    ARRAY_BUFFER: 1, STATIC_DRAW: 2, VERTEX_SHADER: 3, FRAGMENT_SHADER: 4,
    COMPILE_STATUS: 5, LINK_STATUS: 6, FLOAT: 7, TEXTURE_2D: 8,
    TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, TEXTURE_WRAP_S: 11,
    TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, LINEAR: 14, NEAREST: 15,
    UNPACK_FLIP_Y_WEBGL: 16, RGBA: 17, UNSIGNED_BYTE: 18,
    FRAMEBUFFER: 19, COLOR_ATTACHMENT0: 20, FRAMEBUFFER_COMPLETE: 21,
    TEXTURE0: 100, TRIANGLES: 22, MAX_TEXTURE_SIZE: 23,
    MAX_RENDERBUFFER_SIZE: 24, NO_ERROR: 0, OUT_OF_MEMORY: 1285,
    failUpload: null, failFramebuffer: false,
    createBuffer: () => allocate('buffer'),
    createShader: () => allocate('shader'),
    createProgram: () => { calls.programs++; return allocate('program'); },
    createTexture: () => allocate('texture'),
    createFramebuffer: () => allocate('framebuffer'),
    deleteBuffer: release, deleteShader: release, deleteProgram: release,
    deleteTexture: release, deleteFramebuffer: release,
    bindBuffer() {}, bufferData() {}, shaderSource() {}, compileShader() {},
    attachShader() {}, linkProgram() {}, useProgram() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    failTextureSetup: false,
    texParameteri() { if (gl.failTextureSetup) throw new Error('texture setup failed'); },
    pixelStorei() {}, viewport() {},
    getShaderParameter: () => !failCompile,
    getShaderInfoLog: () => 'compile failed',
    getProgramParameter: () => !failLink,
    getProgramInfoLog: () => 'link failed',
    getAttribLocation: () => 0,
    getUniformLocation: (_, name) => name,
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform1i: (name, value) => uniforms.set(name, value),
    uniform2f: (name, x, y) => uniforms.set(name, [x, y]),
    activeTexture: (value) => { unit = value - gl.TEXTURE0; },
    bindTexture: (_, value) => bindings.set(unit, value),
    bindFramebuffer: (_, value) => { framebuffer = value; },
    framebufferTexture2D() {},
    checkFramebufferStatus: () => gl.failFramebuffer ? 0 : gl.FRAMEBUFFER_COMPLETE,
    getParameter: () => maxSize,
    getError: () => { const value = glError; glError = 0; return value; },
    isContextLost: () => lost,
    texImage2D(...args) {
      const image = args.length === 6 ? args[5] : null;
      if (image && gl.failUpload === image.src) {
        glError = gl.OUT_OF_MEMORY;
      } else if (image) {
        bindings.get(unit).image = image.src;
      }
    },
    drawArrays() {
      if (lost) throw new Error('draw called on lost context');
      calls.draws.push({ framebuffer, art: bindings.get(0)?.image, uniforms: new Map(uniforms) });
    },
  };
  function allocate(type) { const item = { type, id: ++next }; live.add(item); return item; }
  function release(item) { if (item) live.delete(item); }
  class Image {
    constructor() { this.width = 1000; this.height = 1486; this.onload = null; this.onerror = null; this._src = ''; }
    set src(value) { this._src = value; if (value) requests.push(this); }
    get src() { return this._src; }
  }
  const canvas = {
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    getContext(type, options) { assert.equal(type, 'webgl'); calls.contexts++; calls.options = options; return gl; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const context = vm.createContext({
    Image, DOMException, AbortController, console,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, at: clock + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    window: { innerWidth: 1200, devicePixelRatio: 1 },
    devicePixelRatio: 1, navigator: {},
  });
  vm.runInContext(source, context);
  const assets = (name) => ({ character: `${name}/character`, background: 'shared/background', ui: `${name}/ui`, structure: `${name}/structure` });
  function resolve(url) {
    for (const image of requests.filter((item) => item.src === url)) image.onload?.();
  }
  function resolveAll() { for (const image of [...requests]) if (image.src) image.onload?.(); }
  function reject(url) { requests.find((item) => item.src === url)?.onerror?.(); }
  async function create(initial, options) {
    const pending = context.HOLO_CREATE_RENDERER(canvas, initial, options);
    resolveAll();
    return pending;
  }
  async function apply(renderer, name) {
    const pending = renderer.setAssets(assets(name));
    resolveAll();
    return pending;
  }
  return {
    gl, canvas, live, requests, calls, context, assets, resolve, resolveAll, reject, create, apply, timers,
    advanceTime(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= clock && timers.delete(id)) timer.callback();
      }
    },
    shownArt() { return calls.draws.at(-1)?.art; },
    lose() { lost = true; listeners.get('webglcontextlost')?.({ preventDefault() {} }); },
    listeners,
  };
}

test('can create one persistent renderer before assets or layout are available', async () => {
  const b = browser();
  const r = await b.create();
  assert.equal(typeof r.setAssets, 'function');
  assert.equal(typeof r.resize, 'function');
  assert.equal(r.draw(0, 0, 1), false);
  assert.equal(b.requests.length, 0);
  assert.equal(b.calls.contexts, 1);
  assert.equal(b.calls.options.preserveDrawingBuffer, true);
  assert.equal(await b.apply(r, 'first'), true);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  assert.ok(b.canvas.width > 0 && b.canvas.height > 0);
  r.dispose();
});

test('legacy initial-assets factory retains draw and releases all resources', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  r.draw(-5, -12, 1, 2, 0.5);
  assert.equal(b.shownArt(), 'first/character');
  assert.equal(b.calls.draws.length, 6);
  assert.equal(b.calls.draws.at(-1).uniforms.get('depth'), 2);
  r.dispose();
  r.dispose();
  assert.equal(b.live.size, 0);
});

test('keeps the previous card until an entire replacement is committed', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const programs = b.calls.programs;
  const liveCount = b.live.size;
  const pending = r.setAssets(b.assets('second'));
  b.resolve('second/character');
  b.resolve('second/ui');
  await Promise.resolve();
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  b.resolveAll();
  assert.equal(await pending, true);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'second/character');
  assert.equal(b.calls.contexts, 1);
  assert.equal(b.calls.programs, programs);
  assert.equal(b.requests.filter((image) => image.src === 'shared/background').length, 1);
  assert.equal(b.live.size, liveCount);
  r.dispose();
});

test('superseded requests resolve false and cannot overwrite a newer card', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const stale = r.setAssets(b.assets('second'));
  const oldImage = b.requests.find((image) => image.src === 'second/character');
  const oldOnload = oldImage.onload;
  const fresh = r.setAssets(b.assets('third'));
  assert.equal(await stale, false);
  assert.equal(oldImage.src, '');
  b.resolveAll();
  assert.equal(await fresh, true);
  oldOnload?.();
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'third/character');
  r.dispose();
});

test('external abort rejects AbortError, cancels sibling images and retains the card', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const controller = new AbortController();
  const pending = r.setAssets(b.assets('second'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(b.requests.filter((image) => image.src.startsWith('second/')).length === 0);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  r.dispose();
});

test('an already aborted selection does not cancel the current in-flight request', async () => {
  const b = browser();
  const r = await b.create();
  const current = r.setAssets(b.assets('first'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(r.setAssets(b.assets('second'), { signal: controller.signal }), { name: 'AbortError' });
  b.resolveAll();
  assert.equal(await current, true);
  r.dispose();
});

test('failed image identifies its layer, cancels siblings and leaves the last card intact', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const count = b.live.size;
  const pending = r.setAssets(b.assets('second'));
  b.reject('second/structure');
  await assert.rejects(pending, /structure/i);
  assert.equal(b.requests.filter((image) => image.src.startsWith('second/')).length, 0);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  assert.equal(b.live.size, count);
  r.dispose();
});

test('selection deadline names the hung layer, cancels siblings and retains the previous GPU card', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'), { loadTimeoutMs: 25 });
  const resources = b.live.size;
  const pending = r.setAssets(b.assets('second'));
  assert.equal(b.timers.size, 1, 'image selection must have a bounded deadline');
  b.resolve('second/character');
  b.resolve('second/ui');
  b.advanceTime(24);
  assert.ok(b.requests.some((image) => image.src === 'second/structure'));
  b.advanceTime(1);
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'TimeoutError');
    assert.match(error.message, /structure/i);
    assert.match(error.message, /25/);
    assert.doesNotMatch(error.message, /character|background|ui/);
    return true;
  });
  assert.equal(b.requests.filter((image) => image.src.startsWith('second/')).length, 0);
  assert.equal(b.timers.size, 0);
  assert.equal(b.live.size, resources);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  assert.equal(await b.apply(r, 'third'), true);
  r.dispose();
});

test('default deadline is fifteen seconds and initial timeout cleans factory resources', async () => {
  const b = browser();
  const pending = b.context.HOLO_CREATE_RENDERER(b.canvas, b.assets('first'));
  assert.equal([...b.timers.values()][0]?.at, 15000);
  b.advanceTime(15000);
  await assert.rejects(pending, { name: 'TimeoutError' });
  assert.equal(b.live.size, 0);
  assert.equal(b.timers.size, 0);
});

test('supersede and external abort clear their deadlines and retain their existing outcomes', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'), { loadTimeoutMs: 25 });
  const stale = r.setAssets(b.assets('second'));
  b.advanceTime(10);
  const controller = new AbortController();
  const current = r.setAssets(b.assets('third'), { signal: controller.signal });
  assert.equal(await stale, false);
  assert.equal(b.timers.size, 1);
  controller.abort();
  await assert.rejects(current, { name: 'AbortError' });
  assert.equal(b.timers.size, 0);
  b.advanceTime(100);
  assert.equal(await b.apply(r, 'fourth'), true);
  r.dispose();
});

test('loadTimeoutMs accepts only a positive finite duration', async () => {
  for (const value of [0, -1, Infinity, NaN, '25', null]) {
    const b = browser();
    await assert.rejects(b.create(undefined, { loadTimeoutMs: value }), /loadTimeoutMs/i);
    assert.equal(b.live.size, 0);
  }
});

test('partial GPU upload failure rolls back without leaking or deleting the previous card', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const count = b.live.size;
  b.gl.failUpload = 'second/ui';
  const pending = r.setAssets(b.assets('second'));
  b.resolveAll();
  await assert.rejects(pending, /ui|texture/i);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  assert.equal(b.live.size, count);
  r.dispose();
});

test('texture setup exceptions release their allocation before rolling back a selection', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const count = b.live.size;
  b.gl.failTextureSetup = true;
  const pending = r.setAssets(b.assets('second'));
  b.resolveAll();
  await assert.rejects(pending, /texture setup/i);
  assert.equal(b.live.size, count);
  b.gl.failTextureSetup = false;
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  r.dispose();
});

test('a stale image failure racing a newer request resolves false instead of reporting an old error', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const stale = r.setAssets(b.assets('second'));
  b.reject('second/character');
  const current = r.setAssets(b.assets('third'));
  assert.equal(await stale, false);
  b.resolveAll();
  assert.equal(await current, true);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'third/character');
  r.dispose();
});

test('failed initial image loading cleans the complete factory allocation', async () => {
  const b = browser();
  const pending = b.context.HOLO_CREATE_RENDERER(b.canvas, b.assets('first'));
  b.reject('first/character');
  await assert.rejects(pending, /character/i);
  assert.equal(b.live.size, 0);
});

for (const mode of ['failCompile', 'failLink']) {
  test(`${mode} cleans partially allocated shaders, programs and buffers`, async () => {
    const b = browser({ [mode]: true });
    await assert.rejects(b.create(), /compile|link|shader/i);
    assert.equal(b.live.size, 0);
  });
}

test('resize uses explicit layout pixels, quality and DPR with bounded targets', async () => {
  let invalidations = 0;
  const b = browser({ maxSize: 1200 });
  const r = await b.create(b.assets('first'), { onInvalidate: () => invalidations++ });
  const count = b.live.size;
  assert.equal(r.resize({ cssWidth: 400, cssHeight: 600, dpr: 2, quality: 'high' }), true);
  assert.equal(b.canvas.width, 800);
  assert.equal(b.canvas.height, 1200);
  assert.equal(r.resize({ cssWidth: 400, cssHeight: 600, dpr: 2, quality: 'high' }), false);
  r.resize({ cssWidth: 10000, cssHeight: 15000, dpr: 10, quality: 'high' });
  assert.ok(b.canvas.width <= 1200 && b.canvas.height <= 1200);
  assert.equal(b.live.size, count);
  assert.ok(invalidations >= 2);
  r.dispose();
});

test('resize can precede assets and uses canvas client dimensions instead of transformed bounds', async () => {
  const b = browser();
  b.canvas.clientWidth = 320;
  b.canvas.clientHeight = 480;
  b.canvas.getBoundingClientRect = () => { throw new Error('transformed dimensions used'); };
  const r = await b.create();
  r.resize({ dpr: 1, quality: 'high' });
  assert.equal(b.canvas.width, 320);
  assert.equal(b.canvas.height, 480);
  assert.equal(await b.apply(r, 'first'), true);
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  r.dispose();
});

test('asset commits retain the last explicitly requested layout and DPR', async () => {
  const b = browser();
  const r = await b.create();
  r.resize({ cssWidth: 320, cssHeight: 480, dpr: 2, quality: 'high' });
  assert.equal(await b.apply(r, 'first'), true);
  assert.equal(b.canvas.width, 640);
  assert.equal(b.canvas.height, 960);
  assert.equal(await b.apply(r, 'second'), true);
  assert.equal(b.canvas.width, 640);
  assert.equal(b.canvas.height, 960);
  r.dispose();
});

test('many completed switches keep only the active artwork and shared GPU resources', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const count = b.live.size;
  for (let i = 0; i < 100; i++) {
    assert.equal(await b.apply(r, 'card-' + i), true);
    assert.equal(b.live.size, count);
  }
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'card-99/character');
  assert.equal(b.calls.contexts, 1);
  assert.equal(b.calls.programs, 2);
  r.dispose();
  assert.equal(b.live.size, 0);
});

test('failed initial framebuffer allocation also releases staged artwork', async () => {
  const b = browser();
  b.gl.failFramebuffer = true;
  await assert.rejects(b.create(b.assets('first')), /framebuffer/i);
  assert.equal(b.live.size, 0);
});

test('failed framebuffer replacement preserves dimensions, resources and the displayed card', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const [width, height, count] = [b.canvas.width, b.canvas.height, b.live.size];
  b.gl.failFramebuffer = true;
  assert.throws(() => r.resize({ cssWidth: 500, cssHeight: 750, dpr: 1 }), /framebuffer/i);
  assert.equal(b.canvas.width, width);
  assert.equal(b.canvas.height, height);
  assert.equal(b.live.size, count);
  b.gl.failFramebuffer = false;
  r.draw(0, 0, 1);
  assert.equal(b.shownArt(), 'first/character');
  r.dispose();
});

test('context loss stops drawing and invalidates pending loads until the app replaces the renderer', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const pending = r.setAssets(b.assets('second'));
  b.lose();
  assert.equal(await pending, false);
  assert.equal(r.draw(0, 0, 1), false);
  await assert.rejects(r.setAssets(b.assets('third')), /context/i);
  r.dispose();
  assert.equal(b.live.size, 0);
  assert.equal(b.listeners.size, 0);
});

test('dispose cancels in-flight work and later resolution cannot allocate or draw', async () => {
  const b = browser();
  const r = await b.create(b.assets('first'));
  const pending = r.setAssets(b.assets('second'));
  r.dispose();
  assert.equal(await pending, false);
  b.resolveAll();
  assert.equal(b.live.size, 0);
  assert.equal(r.draw(0, 0, 1), false);
  assert.equal(r.resize(), false);
  await assert.rejects(r.setAssets(b.assets('third')), { name: 'InvalidStateError' });
});
