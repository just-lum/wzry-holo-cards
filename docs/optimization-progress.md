# Optimization progress — 2026-10-24

Base: `feef7238f06c5531fbe3af0ddcf1ecb2dd41485d`; branch `feature/holo-experience`.

Scope: design and plan under `docs/superpowers/`. The user requested implementation of the previously assessed full optimization. Preserve static deployment and original card numbering.

- Repository: fresh independent clone; no existing tests, build or repository instruction files.
- Baseline browser capture: isolated Python Playwright 1.64 / Chromium 156, DPR 1, local HTTP with software rendering.
- Decision: reuse `heroes.json` as runtime catalog; retain original series numbers and show availability count separately.
- Decision: no framework migration; one renderer and shared controller for both entry URLs.
- Task 1: complete. Catalog tests 11/11; validator checks 125 cards, 752 image files and both entry points. Original numbering remains unchanged.
- Task 2: complete. Renderer tests 25/25. RED→GREEN covers persistent replacement, stale requests, abort, image deadlines, partial GPU/FBO failure, explicit resize, context loss and disposal. All three shader source strings remain identical to the base commit.
- Task 3: complete. Browser suite 13/13 with no uncaught page errors. Seven layouts: 320×780, 390×844, 568×320, 768×1024, 844×390, 1024×800 and 1440×1000. Covers search/favorites/URL/history/keyboard/share fallback, unavailable WebGL, context recovery, corrupt/blocked storage, failure retry, network deadlines and allocation rollback.
- Task 4: independent review found resize cleanup/errors, sub-600px landscape, skip-link selection reset and unbounded network loads. Each was reproduced before its fix and verified afterward. Screenshot QA also reproduced and fixed compressed desktop catalog rows.

## Measured changes

Same selection sequence: first hero plus ten successive selections. Before: 11 WebGL contexts; after: 1. Afterward only nine textures (four artwork + five bloom targets), three shaders, two programs, one buffer and five framebuffers remain live. Thirty replaced artwork textures were explicitly deleted. The unchanged shared background was uploaded once.

The settled page scheduled zero additional animation frames in the idle observation window. The previous 390×844 layout overlapped the card and controls by approximately 48px; the new layout has separate regions. DPR-2 quality selection changed the drawing buffer from 598×888 (low) to 1196×1776 (high) in the tested desktop layout.

Do not compare first-load timing directly: the old baseline began on a manual hero click; the new suite includes navigation/network-idle. Local headless/SwiftShader results do not establish phone FPS or public-network loading speed. Browser screenshots can trigger driver ReadPixels performance warnings; the intentionally injected 404 test produces an expected network error.

## Evidence and delivery

Local evidence: `C:/Users/233/_shots/holo-optimization-20261024/`, including `baseline.json`, `browser-results.json`, before/after screenshots, and focused RED/GREEN reports. These machine-local artifacts are outside the source repository.

Source validation: `npm test` → 36/36; `npm run validate` → 125 cards / 752 images; JavaScript syntax checks and `git diff --check` passed. Browser validation: `python tests/browser_smoke.py --output <evidence-directory>` → 13/13.

Delivery: feature branch and reviewable draft PR; local HTTP preview. Main branch publishing is a separate integration step.
