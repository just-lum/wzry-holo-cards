# Holographic collection implementation plan

> **For agentic workers:** Use incremental implementation with independent renderer/catalog tasks and a final fresh review. Track validation and decisions in `docs/optimization-progress.md`.

**Goal:** Deliver the design's reliable renderer and usable responsive collection.

**Architecture:** Keep static hosting and classic browser scripts. `HOLO_CATALOG` owns pure catalog helpers, `HOLO_CREATE_RENDERER` owns WebGL, and `viewer/app.js` coordinates UI and selection.

**Tech Stack:** HTML, CSS, JavaScript, Node built-in test runner, Python Playwright for isolated browser verification.

**Spec:** `docs/superpowers/specs/2026-10-24-holo-optimization-design.md`

## Global constraints

- Zero runtime dependencies and no required build step.
- Preserve artwork, material pipeline and original series numbering.
- One context per viewer, bounded resources, latest selection wins.
- HTTP static serving and existing `index.html` / `all.html` entry URLs work.
- No remote publishing or main-branch merge in this step.

## Review focus

- Slow older selection finishing or failing after a newer selection.
- Shader/image/framebuffer failure during initialization and replacement.
- Small/short landscape screens and browser zoom without control overlap.
- Blocked storage/clipboard and invalid hash/catalog input.
- Context loss, hidden tabs, bfcache and reduced-motion changes.

### Task 1: Catalog and inventory

Files: `viewer/catalog.js`, `tests/catalog.test.cjs`, `tools/validate-assets.cjs`, `package.json`.

Interface: global/CommonJS `HOLO_CATALOG` exposes `normalizeHeroes(raw)`, `filterHeroes(heroes, query, {favoritesOnly, favorites}?)`, `heroFromHash(heroes, hash)`, `heroHash(hero)`, `assetsFor(hero)` and `thumbnailFor(hero)`.

- [ ] Write/run failing tests for catalog validity, search, original numbering, favorite filtering, encoded/invalid hashes and safe asset paths.
- [ ] Implement pure catalog helpers and one authoritative JSON catalog.
- [ ] Validate runtime inventory (125 complete layer/thumbnail sets, shared background/back) and script entry points. Do not assert historical `faces.json` matches runtime inventory.
- [ ] Run focused tests and inventory validator; commit this slice.

### Task 2: Persistent renderer

Files: `viewer/renderer.js`, optional focused loader/policy helpers, `tests/renderer.test.cjs`.

Interface: `await HOLO_CREATE_RENDERER(canvas, assets?, options?)` returns compatible `draw` and idempotent `dispose`, plus asynchronous `setAssets(assets,{signal}?)` and `resize({cssWidth,cssHeight,dpr,quality}?)`. `setAssets` resolves true only when committed and false when superseded; real current failures reject.

- [ ] Write/run failing lifecycle tests for replacement, stale requests, failed partial upload, initial failure cleanup and idempotent disposal.
- [ ] Reuse context/shaders/background and atomically replace textures, cancel stale requests and clean every resource path.
- [ ] Add bounded adaptive resolution/quality and transactional framebuffer resize. Preserve shader appearance.
- [ ] Run renderer tests, compare in the real browser after Task 3 integration; commit the renderer slice.

### Task 3: Collection experience

Files: `index.html`, `all.html`, `viewer/app.js`, `viewer/styles.css`, `tests/browser_smoke.py`.

Consumes Task 1/2 APIs. App owns status, selected hero, favorites, URL, animation scheduling and context recovery.

- [ ] Use semantic HTML controls with the existing visual language; remove duplicate inline catalog/app code.
- [ ] Integrate one renderer, loading thumbnail, retry/fallback, and coherent latest-selection status.
- [ ] Implement search/favorites/deep links/share and previous/next/keyboard controls.
- [ ] Integrate ResizeObserver, quality selector, reduced-motion and visibility-aware demand rendering.
- [ ] Test app flows in Chromium, including forced failure, fast selection, blocked storage and context loss; verify 320/768/1024/1440 layouts and keyboard interaction.
- [ ] Update README/change notes, run complete tests/inventory/browser verification; commit this slice.

### Task 4: Review and delivery

- [ ] Independently review current diff, reproduce/fix material findings, rerun affected checks.
- [ ] Record actual before/after measurements and screenshots with limitations.
- [ ] Open the working preview and provide branch/source/test evidence for review.
