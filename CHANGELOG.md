# Changes

## Unreleased

- Reuse one WebGL renderer across hero changes and explicitly release replaced GPU resources.
- Preserve the original foil/HDR/bloom shaders, card artwork and original series numbers.
- Load card assets atomically, cancel superseded work, bound stalled loads and allow retry.
- Adapt drawing resolution to layout, DPR and quality; stop animation scheduling when settled or hidden.
- Add search, local favorites, previous/next navigation, keyboard controls and shareable hero links.
- Separate mobile stage and controls, provide a horizontal collection strip and handle short landscape screens.
- Use one JSON catalog for both page entry points and remove missing-asset choices from the legacy entry.
- Add catalog/renderer regression tests, full image inventory validation and isolated browser checks.
