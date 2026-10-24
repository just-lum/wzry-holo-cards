(async function () {
  'use strict';
  const catalog = globalThis.HOLO_CATALOG;
  const ids = ['grid', 'search', 'favorites-only', 'result-count', 'empty', 'empty-message',
    'clear-filters', 'favorite', 'share', 'share-fallback', 'share-link', 'prev', 'next',
    'flip', 'recenter', 'quality', 'depth', 'glow', 'odepth', 'oglow', 'stage', 'card',
    'cv', 'preview', 'retry', 'status', 'tname', 'tmeta'];
  const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const front = ui.card.querySelector('.front'), back = ui.card.querySelector('.back');
  const storageKey = 'wzry-holo-preferences-v1';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) { /* Preferences remain usable for this session. */ }
  const favorites = new Set(Array.isArray(saved.favorites) ? saved.favorites.filter((key) => typeof key === 'string') : []);
  let quality = ['auto', 'low', 'high'].includes(saved.quality) ? saved.quality : 'auto';
  let appliedQuality = quality;
  let heroes = [], visibleHeroes = [], selected = null, renderer = null, rendererPromise = null;
  let sequence = 0, controller = null, contextLost = false, dirty = true, raf = 0;
  let mx = -5, my = -12, tx = -5, ty = -12, base = 0, depth = 0, glow = .15;
  let down = false, pointer = null, px = 0, py = 0, sx = 0, sy = 0, moved = false;
  let lastX = Infinity, lastY = Infinity;
  const buttons = new Map();
  ui.quality.value = quality;

  function setStatus(message) { ui.status.textContent = message; }
  function savePreferences() {
    try { localStorage.setItem(storageKey, JSON.stringify({ favorites: [...favorites], quality })); }
    catch (_) { if (document.body.dataset.loadState === 'ready') setStatus('已应用；当前浏览器无法保存偏好，下次打开将恢复默认。'); }
  }
  function updateFavorite() {
    const active = !!selected && favorites.has(selected.key);
    ui.favorite.textContent = active ? '★' : '☆';
    ui.favorite.setAttribute('aria-pressed', String(active));
    ui.favorite.setAttribute('aria-label', active ? '取消收藏当前英雄' : '收藏当前英雄');
    for (const [key, button] of buttons) button.classList.toggle('is-favorite', favorites.has(key));
  }
  function filter() {
    const favoritesOnly = ui['favorites-only'].getAttribute('aria-pressed') === 'true';
    visibleHeroes = catalog.filterHeroes(heroes, ui.search.value, { favoritesOnly, favorites });
    const visible = new Set(visibleHeroes.map((hero) => hero.key));
    for (const [key, button] of buttons) button.hidden = !visible.has(key);
    ui['result-count'].textContent = `${visibleHeroes.length} / ${heroes.length} 位英雄${favoritesOnly ? ' · 我的收藏' : ' · 原系列编号保留'}`;
    ui.empty.hidden = visibleHeroes.length !== 0;
    ui.grid.hidden = visibleHeroes.length === 0;
    ui['empty-message'].textContent = favoritesOnly && !favorites.size ? '还没有收藏，点击卡片旁的 ☆ 收入典藏。' : '没有找到匹配的英雄，试试其他名称或编号。';
    ui.prev.disabled = ui.next.disabled = visibleHeroes.length < 2;
  }
  function makeGrid() {
    const fragment = document.createDocumentFragment();
    buttons.clear();
    for (const hero of heroes) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'item'; button.dataset.key = hero.key;
      button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', `${hero.name} · ${hero.title}`);
      const image = document.createElement('img');
      image.loading = 'lazy'; image.decoding = 'async'; image.src = catalog.thumbnailFor(hero); image.alt = '';
      image.width = 100; image.height = 140;
      const name = document.createElement('b'); name.textContent = hero.name;
      const title = document.createElement('span'); title.textContent = hero.title;
      button.append(image, name, title);
      button.addEventListener('click', () => choose(hero));
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault(); event.stopPropagation(); navigate(event.key === 'ArrowRight' ? 1 : -1, true);
        }
      });
      buttons.set(hero.key, button); fragment.append(button);
    }
    ui.grid.replaceChildren(fragment); updateFavorite(); filter();
  }
  function writeHash(hero, mode) {
    const hash = catalog.heroHash(hero);
    if (location.hash === hash) return;
    const url = location.pathname + location.search + hash;
    if (mode === 'push') history.pushState(null, '', url); else history.replaceState(null, '', url);
  }
  function resizeRenderer({ strict = false } = {}) {
    if (!renderer || contextLost) return;
    try {
      if (renderer.resize({ cssWidth: ui.cv.clientWidth, cssHeight: ui.cv.clientHeight, dpr: window.devicePixelRatio || 1, quality })) dirty = true;
      appliedQuality = quality;
    } catch (error) {
      if (strict) throw error;
      quality = appliedQuality; ui.quality.value = quality;
      setStatus('画质调整失败，已保留可用卡面。可尝试流畅画质。');
    }
    wake();
  }
  function ensureRenderer() {
    if (!rendererPromise) {
      rendererPromise = globalThis.HOLO_CREATE_RENDERER(ui.cv, undefined, { quality, onInvalidate: () => { dirty = true; wake(); } })
        .then((value) => {
          renderer = value;
          try { resizeRenderer({ strict: true }); return value; }
          catch (error) { value.dispose(); renderer = null; throw error; }
        })
        .catch((error) => { rendererPromise = null; throw error; });
    }
    return rendererPromise;
  }
  async function choose(hero, { historyMode = 'push', focus = false } = {}) {
    const request = ++sequence;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    selected = hero;
    document.body.dataset.hero = hero.key; document.body.dataset.loadState = 'loading';
    ui.stage.setAttribute('aria-busy', 'true'); ui.tname.textContent = hero.name;
    ui.tmeta.textContent = `${hero.title} · ${hero.edition}`;
    document.title = `${hero.name} · 原皮典藏 · 全息卡`;
    ui.preview.src = catalog.thumbnailFor(hero); ui.preview.alt = `${hero.name}卡面预览`;
    ui.retry.hidden = true; ui['share-fallback'].hidden = true;
    setStatus(`正在加载「${hero.name}」的全息卡面…`);
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === hero.key));
    updateFavorite(); writeHash(hero, historyMode);
    if (focus) buttons.get(hero.key)?.focus({ preventScroll: true });
    buttons.get(hero.key)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    try {
      if (contextLost) throw new Error('context-lost');
      const active = await ensureRenderer();
      if (request !== sequence || signal.aborted) return;
      const committed = await active.setAssets(catalog.assetsFor(hero), { signal });
      if (!committed || request !== sequence || signal.aborted) return;
      document.body.dataset.renderedHero = hero.key; document.body.dataset.loadState = 'ready';
      ui.stage.setAttribute('aria-busy', 'false'); dirty = true; lastX = lastY = Infinity;
      resizeRenderer(); wake(); setStatus(`「${hero.name}」已就绪`);
    } catch (error) {
      if (request !== sequence || signal.aborted || error.name === 'AbortError') return;
      document.body.dataset.loadState = 'error'; ui.stage.setAttribute('aria-busy', 'false'); ui.retry.hidden = contextLost;
      setStatus(contextLost ? '图形渲染已暂停，恢复后会重新载入卡片。' : `「${hero.name}」卡面加载失败。可重试，或切换其他英雄。`);
    }
  }
  function navigate(direction, focus = false) {
    if (!visibleHeroes.length) return;
    const index = visibleHeroes.findIndex((hero) => hero.key === selected?.key);
    const next = index < 0 ? (direction > 0 ? 0 : visibleHeroes.length - 1) : (index + direction + visibleHeroes.length) % visibleHeroes.length;
    choose(visibleHeroes[next], { focus });
  }
  function stopFrame() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function wake() { if (!raf && !document.hidden && !contextLost) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (document.hidden || contextLost) return;
    const ease = motion.matches ? 1 : .16;
    mx = Math.abs(tx - mx) < .025 ? tx : mx + (tx - mx) * ease;
    my = Math.abs(ty - my) < .025 ? ty : my + (ty - my) * ease;
    ui.card.style.transform = `rotateX(${mx}deg) rotateY(${my}deg)`;
    const visible = Math.cos(my * Math.PI / 180) * Math.cos(mx * Math.PI / 180) > .001;
    front.style.visibility = visible ? 'visible' : 'hidden'; back.style.visibility = visible ? 'hidden' : 'visible';
    ui.card.dataset.face = visible ? 'front' : 'back';
    if (renderer && visible && document.body.dataset.loadState === 'ready' && (dirty || Math.abs(mx - lastX) > .01 || Math.abs(my - lastY) > .01)) {
      renderer.draw(mx, my, 1, depth, glow); dirty = false; lastX = mx; lastY = my;
    }
    if (mx !== tx || my !== ty) wake();
  }
  function flip() { ty = base + 180; base += 180; wake(); }
  function recenter() { tx = -5; ty = base = 0; wake(); }
  ui.card.addEventListener('pointerdown', (event) => {
    if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer = event.pointerId; down = true; moved = false;
    px = sx = event.clientX; py = sy = event.clientY; ui.card.setPointerCapture(event.pointerId);
  });
  ui.card.addEventListener('pointermove', (event) => {
    if (!down || pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - sx, event.clientY - sy) > 5) moved = true;
    ty += (event.clientX - px) * .62; tx = Math.max(-50, Math.min(50, tx - (event.clientY - py) * .3));
    px = event.clientX; py = event.clientY; wake();
  });
  function endPointer(event, cancelled) {
    if (pointer !== event.pointerId) return;
    pointer = null; down = false;
    if (ui.card.hasPointerCapture(event.pointerId)) ui.card.releasePointerCapture(event.pointerId);
    if (!cancelled && !moved) flip(); else base = Math.round(ty / 180) * 180;
  }
  ui.card.addEventListener('pointerup', (event) => endPointer(event, false));
  ui.card.addEventListener('pointercancel', (event) => endPointer(event, true));
  ui.card.addEventListener('lostpointercapture', () => { pointer = null; down = false; });
  ui.card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); } });
  ui.flip.addEventListener('click', flip); ui.recenter.addEventListener('click', recenter);
  ui.prev.addEventListener('click', () => navigate(-1)); ui.next.addEventListener('click', () => navigate(1));
  ui.depth.addEventListener('input', () => {
    depth = Number(ui.depth.value); ui.odepth.value = `${depth > 0 ? '+' : ''}${depth.toFixed(2)}×`; dirty = true; wake();
  });
  ui.glow.addEventListener('input', () => { glow = Number(ui.glow.value); ui.oglow.value = `${glow.toFixed(2)}×`; dirty = true; wake(); });
  ui.quality.addEventListener('change', () => { quality = ui.quality.value; resizeRenderer(); savePreferences(); });
  ui.search.addEventListener('input', filter);
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault(); ui.search.focus();
    ui.search.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  ui.search.addEventListener('keydown', (event) => { if (event.key === 'Escape') { ui.search.value = ''; filter(); event.preventDefault(); } });
  ui['favorites-only'].addEventListener('click', () => {
    const active = ui['favorites-only'].getAttribute('aria-pressed') === 'true';
    ui['favorites-only'].setAttribute('aria-pressed', String(!active)); filter();
  });
  ui['clear-filters'].addEventListener('click', () => { ui.search.value = ''; ui['favorites-only'].setAttribute('aria-pressed', 'false'); filter(); ui.search.focus(); });
  ui.favorite.addEventListener('click', () => {
    if (!selected) return;
    if (favorites.has(selected.key)) favorites.delete(selected.key); else favorites.add(selected.key);
    updateFavorite(); filter(); savePreferences();
  });
  ui.share.addEventListener('click', async () => {
    if (!selected) return;
    const url = new URL(location.href); url.hash = catalog.heroHash(selected);
    try { await navigator.clipboard.writeText(url.href); setStatus('卡片链接已复制，可以分享给朋友。'); }
    catch (_) {
      ui['share-fallback'].hidden = false; ui['share-link'].value = url.href; ui['share-link'].focus(); ui['share-link'].select();
      setStatus('长按或选中下方链接即可复制。');
    }
  });
  ui.retry.addEventListener('click', () => selected ? choose(selected, { historyMode: 'replace' }) : start());
  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); navigate(event.key === 'ArrowRight' ? 1 : -1); }
    else if (event.key.toLowerCase() === 'r') recenter();
  });
  window.addEventListener('hashchange', () => {
    if (!heroes.length) return;
    const hero = catalog.heroFromHash(heroes, location.hash) || heroes[0];
    if (hero.key !== selected?.key) choose(hero, { historyMode: 'replace' }); else writeHash(hero, 'replace');
  });
  ui.cv.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true; sequence++; controller?.abort(); renderer?.dispose(); renderer = null; rendererPromise = null;
    stopFrame(); document.body.dataset.loadState = 'error'; ui.stage.setAttribute('aria-busy', 'false'); ui.retry.hidden = true;
    setStatus('图形渲染已暂停，恢复后会重新载入卡片。');
  });
  ui.cv.addEventListener('webglcontextrestored', () => { contextLost = false; if (selected) choose(selected, { historyMode: 'replace' }); });
  function onResize() {
    const width = Math.max(1, ui.stage.clientWidth), height = Math.max(1, ui.stage.clientHeight);
    ui.card.style.setProperty('--card-width', `${Math.min(430, width * .68, height * .75 / 1.486)}px`);
    resizeRenderer(); dirty = true; wake();
  }
  const observer = new ResizeObserver(onResize); observer.observe(ui.stage);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { down = false; pointer = null; stopFrame(); } else { dirty = true; wake(); }
  });
  motion.addEventListener('change', () => { dirty = true; wake(); });
  window.addEventListener('pagehide', (event) => { stopFrame(); if (!event.persisted) { controller?.abort(); renderer?.dispose(); observer.disconnect(); } });
  window.addEventListener('pageshow', () => { dirty = true; wake(); });

  async function start() {
    ui.retry.hidden = true;
    document.body.dataset.loadState = 'loading';
    setStatus('正在读取英雄目录…');
    const catalogRequest = new AbortController();
    const deadline = setTimeout(() => catalogRequest.abort(), 15000);
    try {
      if (location.protocol === 'file:') throw new Error('file-protocol');
      const response = await fetch('heroes.json', { signal: catalogRequest.signal });
      if (!response.ok) throw new Error('catalog-unavailable');
      heroes = catalog.normalizeHeroes(await response.json());
      clearTimeout(deadline);
      makeGrid(); onResize();
      await choose(catalog.heroFromHash(heroes, location.hash) || heroes[0], { historyMode: 'replace' });
    } catch (_) {
      document.body.dataset.loadState = 'error'; ui.stage.setAttribute('aria-busy', 'false'); ui.retry.hidden = location.protocol === 'file:';
      setStatus(location.protocol === 'file:' ? '请通过 HTTP 打开：在项目目录运行 python -m http.server 8796，再访问 http://127.0.0.1:8796/' : '英雄目录暂时无法读取，请检查网络后重新加载。');
      ui['result-count'].textContent = '目录加载失败';
    } finally { clearTimeout(deadline); }
  }
  await start();
})();
