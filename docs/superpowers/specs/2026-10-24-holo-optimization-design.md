# Holographic collection optimization

## Intent and scope

Improve the existing 125-card collection in ways people can see and use: reliable rapid switching, clear loading and recovery, comfortable mobile browsing, and finding/saving/sharing a hero. Preserve the current artwork, foil/HDR/bloom material, parallax, drag rotation, back face, and depth/contour controls.

The user requested comprehensive optimization after the repository assessment. The implementation choices below are the agent's decisions within that scope.

## Approach

Keep the dependency-free static HTML/CSS/JavaScript architecture. A framework rewrite would introduce build/deployment work without improving this small collection's core rendering problem. Separate the existing page into a semantic HTML shell, stylesheet, app controller, catalog helpers and renderer; do not add a backend or runtime dependencies.

`heroes.json` is the single runtime catalog. Preserve its original series `no` and `edition` values (125 available cards from a 130-slot series). Display available collection count separately. `faces.json` remains historical asset-production metadata. Make `all.html` a compatibility entry into the same application, retaining hash/query state.

## Rendering and loading

- One canvas/WebGL context and one pair of shader programs for the page lifetime.
- Keep `HOLO_CREATE_RENDERER` and the existing `draw`/`dispose` interface. Add `setAssets(assets, {signal}?)` and `resize({cssWidth, cssHeight, dpr, quality}?)`.
- Asset switches are atomic: retain the last usable card until all replacement textures are ready. A stale or cancelled load never replaces the newest selection or reports its error over the current selection.
- Abort obsolete image requests, share the background, and explicitly release replaced resources and partially initialized resources. Keep memory bounded; do not preload all full-resolution cards.
- Resize from untransformed canvas layout dimensions. Offer automatic, performance and high quality. Bound drawing-buffer and bloom dimensions by device capability. Retain the existing material pipeline.
- Render only during interaction/settling or after an explicit invalidation. Suspend animation in hidden tabs and respect reduced motion.
- Surface WebGL loss/failure with recovery action and a usable image fallback. Do not silently present a failed card as loaded.

## Interface contract

- Preserve charcoal/green collection styling and make the card the visual focus.
- Desktop: searchable scrolling collection at left, stage and compact labeled controls at right. Mobile: stage first, compact horizontal hero strip and reachable controls, no page overflow or obscured card.
- Real buttons for hero selection and actions; visible focus; live loading/status announcements; labels on every input.
- Search by name, title or series number. Favorites persist locally with graceful handling of unavailable/corrupt storage. A favorites-only filter has a clear empty state.
- Initial selection and hash changes support `#hero=<encoded key>`. Share copies the current deep link with fallback when clipboard is unavailable.
- Previous/next selection and keyboard arrows operate without stealing input/range keystrokes. Flip and recenter remain available through buttons and keyboard.
- Fast thumbnail feedback, specific failure message and retry action. Selection, displayed card and title remain consistent through failures and fast clicks.

## Verification and stop condition

Deliver all listed behaviors with meaningful Node tests for catalog and rendering lifecycle; asset inventory validation; isolated real Chromium tests for switching/races/error recovery, favorites/deep links, controls, keyboard, WebGL loss, and responsive layouts at 320/768/1024/1440 widths. Capture before/after desktop/mobile screenshots and repeat the same switching measurement. Review the complete diff independently and fix material findings. Keep the work in a reviewable feature branch; production publishing/merging is outside this implementation step.
