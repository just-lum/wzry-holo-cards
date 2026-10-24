const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D art,bg,uiTex,bloomNear,bloomWide,structureTex; uniform float extracted, cardAspect; uniform vec2 view; uniform float depth, contourBrightness, power, glowPass, pixelWidth;
vec4 encodeHDR(vec3 c){float m=clamp(ceil(max(max(c.r,c.g),c.b)/64.*255.)/255.,1./255.,1.);return vec4(c/(64.*m),m);}
vec3 decodeHDR(vec4 c){return c.rgb*c.a*64.;}
vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+.00001)),d/(q.x+.00001),q.x);}
float ink(vec2 p){vec4 c=texture2D(art,p);vec3 h=hsv(pow(c.rgb,vec3(2.2)));return smoothstep(.035,.065,h.x)*(1.-smoothstep(.17,.21,h.x))*smoothstep(.4,.67,h.y)*smoothstep(.065,.25,h.z)*c.a;}
float structure(vec2 p){if(extracted>.5)return texture2D(structureTex,p).a;float a=ink(p);float b=min(min(ink(p+vec2(.0025,0.)),ink(p-vec2(.0025,0.))),min(ink(p+vec2(0.,.0018)),ink(p-vec2(0.,.0018))));return smoothstep(.025,.22,max(0.,a-b));}
vec3 rainbow(float t){return .52+.48*cos(6.28318*(t+vec3(0.,.33,.67)));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float band(vec2 p){float f=p.x*.65+p.y*.4+view.x*1.9+view.y*.85;return pow(max(0.,1.-abs(fract(f+.16)-.5)*2.),3.);}
void main(){
 vec2 p=(uv-.5)*1.6+.5;vec2 u=p;
 vec2 edge=abs((p-.5)*vec2(1.,cardAspect))-(vec2(.5,cardAspect*.5)-vec2(.045));
 float edgeDistance=length(max(edge,0.))+min(max(edge.x,edge.y),0.)-.045;
 float cardMask=1.-smoothstep(-pixelWidth,pixelWidth,edgeDistance);
 float foregroundMask=depth>0.?1.:cardMask;vec2 a=(p-.5)*1.25+.5+view*.40;vec2 b=(p-.5)*.5+.5-view*.25;
 if(extracted>.5){a=p-view*(.34+(depth<0.?.06:.08)*depth);u=p-view*.14*max(depth,0.);b=(p-.5)*.5+.5-view*.25;}
 vec4 ch=texture2D(art,a);ch.a*=step(0.,a.x)*step(a.x,1.)*step(0.,a.y)*step(a.y,1.);
 ch.a*=foregroundMask;
 vec4 background=texture2D(bg,b);background.a*=cardMask;background.a*=step(0.,b.x)*step(b.x,1.)*step(0.,b.y)*step(b.y,1.);
 float baseAlpha=cardMask+(1.-cardMask)*ch.a;
 vec3 base=mix(background.rgb*cardMask,ch.rgb,ch.a);
 vec3 ui=texture2D(uiTex,u).rgb;vec3 uh=hsv(ui);float um=max(smoothstep(.105,.23,uh.y),1.-smoothstep(.35,.62,uh.z));
 if(extracted>.5)um=texture2D(uiTex,u).a*step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);
 // The text/frame plate has its own rounded boundary, moving with its UVs.
 vec2 uiEdge=abs((u-.5)*vec2(1.,cardAspect))-(vec2(.5,cardAspect*.5)-vec2(.045));
 float uiDistance=length(max(uiEdge,0.))+min(max(uiEdge.x,uiEdge.y),0.)-.045;
 float uiMask=1.-smoothstep(-pixelWidth,pixelWidth,uiDistance);
 um*=uiMask*foregroundMask;
 float finalAlpha=clamp(baseAlpha+(1.-baseAlpha)*um,0.,1.);
 // Transparent overscan must contain zero RGB, including on Safari/Metal.
 if(finalAlpha<=0.){gl_FragColor=glowPass>.5?encodeHDR(vec3(0.)):vec4(0.);return;}
 float phase=p.x*.62+p.y*.36+view.x*1.9+view.y*.8;
 vec3 spectrum=rainbow(phase*2.2);float light=band(p);
 float micro=pow(hash(floor(p*vec2(620.,868.))),28.);
 base=mix(base,base*(.64+spectrum*.7)+spectrum*.07*baseAlpha,light*.48*power);
 float line=structure(a)*ch.a;
 float envelope=smoothstep(.025,.42,light);
 vec3 emission=(spectrum*.85+vec3(.15))*line*envelope*power*40.*contourBrightness;
 vec2 cell=fract(p*vec2(24.,34.))-.5;float seed=hash(floor(p*vec2(24.,34.)));float star=pow(max(0.,1.-abs(cell.x)*18.),14.)*pow(max(0.,1.-abs(cell.y)*2.),6.)+pow(max(0.,1.-abs(cell.y)*18.),14.)*pow(max(0.,1.-abs(cell.x)*2.),6.);
 base+=spectrum*(star*step(.965,seed)*light*.65+micro*light*.12)*power*(1.-ch.a)*cardMask;
 base=mix(base,ui,um);

 float glare=pow(max(0.,1.-length((p-vec2(.5+view.x,.6+view.y))*vec2(1.,.75))),5.);
 base+=vec3(glare*.12*power)*finalAlpha;
 base/=max(finalAlpha,.0001);
 // Concentric rounded border in card-width units, matching the CSS outer radius.
 // Outer radius .045, uniform inset .015, inner radius .030.
 vec2 corner=abs((p-.5)*vec2(1.,cardAspect))-(vec2(.485,cardAspect*.5-.015)-vec2(.030));
 float distanceToInner=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-.030;
 float inside=1.-smoothstep(-pixelWidth,pixelWidth,distanceToInner);
 float rim=(1.-inside)*(1.-extracted);
 base=mix(base,mix(vec3(.76,.67,.32),spectrum*.5+.5,.35*power)+glare*.15,rim);
 emission*=(1.-um)*foregroundMask;
 if(glowPass>.5){gl_FragColor=encodeHDR(max(emission-vec3(1.),vec3(0.)));return;}
 vec3 bloom=decodeHDR(texture2D(bloomNear,uv))*.55+decodeHDR(texture2D(bloomWide,uv))*.8;
 bloom*=foregroundMask*(1.-um)*line;
 // Display mapping is applied AFTER the HDR light and two-scale bloom are composed.
 vec3 linear=pow(clamp(base,0.,1.),vec3(2.2));
 vec3 combined=1.-(1.-linear)*exp(-(emission*.38+bloom*.85));
 gl_FragColor=vec4(pow(clamp(combined,0.,1.),vec3(1./2.2))*finalAlpha,finalAlpha);
}`;
const blurFragment = `precision highp float; varying vec2 uv;uniform sampler2D source;uniform vec2 stepSize;
vec3 decodeHDR(vec4 c){return c.rgb*c.a*64.;}
vec4 encodeHDR(vec3 c){float m=clamp(ceil(max(max(c.r,c.g),c.b)/64.*255.)/255.,1./255.,1.);return vec4(c/(64.*m),m);}
void main(){vec3 c=vec3(0.);float total=0.;for(int i=-4;i<=4;i++){float f=float(i);float w=exp(-f*f/8.);c+=decodeHDR(texture2D(source,uv+stepSize*f))*w;total+=w;}gl_FragColor=encodeHDR(c/total);}`;
/**
 * One WebGL context per viewer. Asset changes are atomic; superseded work
 * resolves false, external cancellation rejects AbortError, and a current
 * failure leaves the previous card usable. The app recreates this renderer
 * after webglcontextrestored rather than reusing invalid GL handles.
 * options.loadTimeoutMs bounds each selection's image loading (default 15000).
 */
async function createCardRenderer(canvas, assets, options = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL unavailable');
  const shaders = new Set(), programs = new Set();
  const textures = new Set(), frames = new Set();
  const names = ['character', 'background', 'ui', 'structure'];
  let buffer, scene, blur, sceneU, step;
  let disposed = false, lost = false, pending = null;
  let artwork = [], targets = [], size = null, aspect = 1.486;
  let quality = options.quality ?? 'auto';
  const loadTimeoutMs = options.loadTimeoutMs === undefined ? 15000 : options.loadTimeoutMs;
  const positions = new Map();
  const maxSize = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096,
  );

  function available() { return !disposed && !lost && !gl.isContextLost(); }
  function abortError() { return new DOMException('Asset loading cancelled', 'AbortError'); }
  function invalidate() {
    // A consumer callback must not turn a successful GPU commit into a failure.
    try { options.onInvalidate?.(); } catch (error) { console.error(error); }
  }
  function own(set, value, label) {
    if (!value) throw new Error('Unable to allocate ' + label);
    set.add(value);
    return value;
  }
  function deleteTexture(t) {
    if (textures.delete(t)) gl.deleteTexture(t);
  }
  function deleteTargets(list) {
    list.forEach(({ t, f }) => {
      if (frames.delete(f)) gl.deleteFramebuffer(f);
      deleteTexture(t);
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    pending?.cancel('disposed');
    canvas.removeEventListener('webglcontextlost', contextLost);
    frames.forEach((f) => gl.deleteFramebuffer(f));
    textures.forEach((t) => gl.deleteTexture(t));
    programs.forEach((p) => gl.deleteProgram(p));
    shaders.forEach((s) => gl.deleteShader(s));
    if (buffer) gl.deleteBuffer(buffer);
    frames.clear(); textures.clear(); programs.clear(); shaders.clear();
    artwork = []; targets = [];
  }
  function contextLost(event) {
    event.preventDefault();
    lost = true;
    pending?.cancel('lost');
  }
  function compile(type, source) {
    const shader = own(shaders, gl.createShader(type), 'shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader error');
    return shader;
  }
  function program(source, vertexShader) {
    const p = own(programs, gl.createProgram(), 'shader program');
    gl.attachShader(p, vertexShader);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) || 'Shader link error');
    positions.set(p, gl.getAttribLocation(p, 'position'));
    return p;
  }
  function use(p) {
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const a = positions.get(p);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  }
  function texture(filter) {
    const t = own(textures, gl.createTexture(), 'texture');
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    } catch (error) {
      deleteTexture(t);
      throw error;
    }
  }
  function checkError(message) {
    if (gl.getError() !== gl.NO_ERROR) throw new Error(message);
  }
  function target(scale, width, height) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    let t, f;
    try {
      t = texture(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      checkError('Bloom framebuffer allocation failed');
      f = own(frames, gl.createFramebuffer(), 'bloom framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Bloom framebuffer unavailable');
      return { t, f, w, h };
    } catch (error) {
      if (f && frames.delete(f)) gl.deleteFramebuffer(f);
      if (t) deleteTexture(t);
      throw error;
    }
  }
  function positive(value) { return Number.isFinite(value) && value > 0; }
  function dimensions(config, imageAspect) {
    const nextQuality = config.quality ?? quality;
    if (!['auto', 'high', 'low'].includes(nextQuality)) throw new RangeError('Unknown rendering quality');
    const dpr = positive(config.dpr) ? config.dpr : (window.devicePixelRatio || 1);
    const ratio = Math.min(dpr, nextQuality === 'low' ? 1 : nextQuality === 'high' ? 2 : 1.5);
    const fallbackWidth = window.innerWidth < 640 ? 1036 : 1408;
    // clientWidth is the untransformed 160% overscan canvas, not its rotated bounds.
    const cssWidth = positive(config.cssWidth) ? config.cssWidth
      : canvas.clientWidth || size?.cssWidth || fallbackWidth / ratio;
    const cssHeight = positive(config.cssHeight) ? config.cssHeight
      : canvas.clientHeight || (size?.cssHeight && size.cssHeight) || cssWidth * imageAspect;
    let width = Math.max(1, Math.round(cssWidth * ratio));
    let height = Math.max(1, Math.round(cssHeight * ratio));
    const widthLimit = nextQuality === 'low' ? 896 : nextQuality === 'high' ? 2048 : 1408;
    const scale = Math.min(1, widthLimit / width, maxSize / Math.max(width, height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
    return { width, height, cssWidth, cssHeight, dpr, quality: nextQuality };
  }
  function resizeInternal(config = {}, imageAspect = aspect, notify = true) {
    if (!available()) return false;
    const next = dimensions(config, imageAspect);
    if (size && size.width === next.width && size.height === next.height) {
      size = next;
      quality = next.quality;
      return false;
    }
    const staged = [];
    try {
      // Keep the same two-scale bloom pipeline and shader math at every quality.
      [0.5, 0.5, 0.5, 0.25, 0.25].forEach((scale) => staged.push(target(scale, next.width, next.height)));
    } catch (error) {
      deleteTargets(staged);
      throw error;
    }
    const previous = targets;
    targets = staged;
    size = next;
    quality = next.quality;
    canvas.width = next.width;
    canvas.height = next.height;
    deleteTargets(previous);
    if (notify) invalidate();
    return true;
  }

  function loadImage(url, name, request) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const item = { image, reject, name, settled: false };
      request.images.push(item);
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        item.settled = true;
        image.onload = image.onerror = null;
        if (!image.width || !image.height) reject(new Error('Empty ' + name + ' image'));
        else resolve(image);
      };
      image.onerror = () => {
        item.settled = true;
        image.onload = image.onerror = null;
        reject(new Error('Unable to load ' + name + ' image'));
      };
      image.src = url;
    });
  }

  async function setAssets(nextAssets, { signal } = {}) {
    if (disposed) throw new DOMException('Renderer disposed', 'InvalidStateError');
    if (!available()) throw new Error('WebGL context lost; recreate the renderer');
    if (signal?.aborted) throw abortError();
    names.forEach((name) => {
      if (typeof nextAssets?.[name] !== 'string' || !nextAssets[name].trim())
        throw new TypeError('Missing ' + name + ' image URL');
    });
    // Snapshot URLs before awaiting so callers cannot mutate an active request.
    const urls = names.map((name) => nextAssets[name]);
    pending?.cancel('superseded');
    const request = {
      images: [], reason: null, error: null, timer: null,
      cancel(reason, error = abortError()) {
        if (this.reason) return;
        this.reason = reason;
        this.error = error;
        clearTimeout(this.timer);
        this.timer = null;
        this.images.forEach(({ image, reject }) => {
          image.onload = image.onerror = null;
          image.src = '';
          reject(error);
        });
      },
    };
    pending = request;
    const externalAbort = () => request.cancel('external');
    signal?.addEventListener('abort', externalAbort, { once: true });
    const reused = urls.map((url, i) => artwork[i]?.url === url ? artwork[i] : null);
    const staged = [];
    try {
      const loading = Promise.all(urls.map((url, i) => reused[i] || loadImage(url, names[i], request)));
      request.timer = setTimeout(() => {
        const waiting = request.images.filter((item) => !item.settled).map((item) => item.name);
        if (!waiting.length) return;
        const error = new Error('Timed out loading ' + waiting.join(', ') + ' image after ' + loadTimeoutMs + ' ms');
        error.name = 'TimeoutError';
        request.cancel('timeout', error);
      }, loadTimeoutMs);
      const images = await loading;
      clearTimeout(request.timer);
      request.timer = null;
      if (request.reason) {
        if (request.reason === 'external' || request.reason === 'timeout') throw request.error;
        return false;
      }
      if (!available()) { request.cancel('lost'); return false; }
      const nextArtwork = images.map((image, i) => {
        if (reused[i]) return reused[i];
        const t = texture(gl.LINEAR);
        staged.push(t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        checkError('Unable to upload ' + names[i] + ' texture');
        return { t, url: urls[i], width: image.width, height: image.height };
      });
      const nextAspect = nextArtwork[0].height / nextArtwork[0].width;
      // A selection must not silently undo an explicit ResizeObserver/DPR size.
      resizeInternal(size ? {
        cssWidth: size.cssWidth, cssHeight: size.cssHeight, dpr: size.dpr,
      } : {}, nextAspect, false);
      const previous = artwork;
      artwork = nextArtwork;
      aspect = nextAspect;
      previous.forEach((item) => { if (!artwork.includes(item)) deleteTexture(item.t); });
      staged.length = 0;
      invalidate();
      return true;
    } catch (error) {
      staged.forEach(deleteTexture);
      if (request.reason === 'timeout') throw request.error;
      if (request.reason && request.reason !== 'external') return false;
      if (request.reason === 'external') throw abortError();
      request.cancel('failure');
      throw error;
    } finally {
      clearTimeout(request.timer);
      request.timer = null;
      signal?.removeEventListener('abort', externalAbort);
      request.images.length = 0;
      if (pending === request) pending = null;
    }
  }
  function bind(t, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }
  function blurPass(src, dst, x, y) {
    use(blur);
    bind(src.t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.uniform2f(step, x / src.w, y / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  const renderer = {
    draw(x, y, strength, depth = 0, contourBrightness = 0.15) {
      if (!available() || !artwork.length || !targets.length) return false;
      const [emission, temp, near, wideTemp, wide] = targets;
      use(scene);
      artwork.forEach(({ t }, i) => bind(t, i === 3 ? 5 : i));
      bind(near.t, 3);
      bind(wide.t, 4);
      gl.uniform1f(sceneU.cardAspect, canvas.height / canvas.width);
      gl.uniform1f(sceneU.pixelWidth, 1 / canvas.width);
      gl.uniform2f(
        sceneU.view,
        Math.sin((y * Math.PI) / 180) * 0.65,
        Math.sin((x * Math.PI) / 180) * 0.65,
      );
      gl.uniform1f(sceneU.power, strength);
      gl.uniform1f(sceneU.depth, depth);
      gl.uniform1f(sceneU.contourBrightness, contourBrightness);
      gl.uniform1f(sceneU.pass, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, emission.f);
      gl.viewport(0, 0, emission.w, emission.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      blurPass(emission, temp, 1.2, 0);
      blurPass(temp, near, 0, 1.2);
      blurPass(near, wideTemp, 5, 0);
      blurPass(wideTemp, wide, 0, 2.5);
      use(scene);
      artwork.forEach(({ t }, i) => bind(t, i === 3 ? 5 : i));
      bind(near.t, 3);
      bind(wide.t, 4);
      gl.uniform1f(sceneU.pass, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    },
    setAssets,
    resize: (config) => resizeInternal(config),
    dispose,
  };
  try {
    if (!['auto', 'high', 'low'].includes(quality)) throw new RangeError('Unknown rendering quality');
    if (!positive(loadTimeoutMs)) throw new RangeError('loadTimeoutMs must be a positive finite duration');
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate vertex buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const vertexShader = compile(gl.VERTEX_SHADER, vertex);
    scene = program(fragment, vertexShader);
    blur = program(blurFragment, vertexShader);
    sceneU = {};
    ['view', 'power', 'depth', 'contourBrightness', 'cardAspect', 'pixelWidth'].forEach((name) => {
      sceneU[name] = gl.getUniformLocation(scene, name);
    });
    sceneU.pass = gl.getUniformLocation(scene, 'glowPass');
    use(scene);
    gl.uniform1f(gl.getUniformLocation(scene, 'extracted'), 1);
    gl.uniform1i(gl.getUniformLocation(scene, 'structureTex'), 5);
    ['art', 'bg', 'uiTex', 'bloomNear', 'bloomWide'].forEach((name, i) => gl.uniform1i(gl.getUniformLocation(scene, name), i));
    use(blur);
    gl.uniform1i(gl.getUniformLocation(blur, 'source'), 0);
    step = gl.getUniformLocation(blur, 'stepSize');
    canvas.addEventListener('webglcontextlost', contextLost);
    if (assets) await setAssets(assets);
    return renderer;
  } catch (error) {
    dispose();
    throw error;
  }
}

globalThis.HOLO_CREATE_RENDERER=createCardRenderer;
