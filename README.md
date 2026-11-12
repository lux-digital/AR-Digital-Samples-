# LUX — AR Digital Samples

A first-pass 3D viewer + experimental world-tracked WebAR for LUX Architectural Products, using the original GLBs and woodgrain textures.

## Implemented

- Desktop / touch 3D preview with drag-to-orbit.
- All five uploaded GLB profiles: Random Plank, Folded Wall, Variable Wall, Board + Batten, V-Groove / Lap.
- All nine uploaded woodgrain finishes, mapped to the appropriate per-profile texture assets.
- Four independently draggable resize edges and live dimensions in metres.
- Shader cropping of the original geometry, without stretching texture UVs.
- Four adjustable J-style trims with approximately 1 inch of visible overlap.
- Phone AR integration using 8th Wall Distributed Engine Binary (SLAM tracking), manual wall placement, adjustable placement distance, reset/reposition.

## How to test

This is a static website. No npm installation, backend or Adobe Aero account is needed.

1. Open this repository's Settings → Pages.
2. In Build and deployment, choose Deploy from a branch.
3. Select main and /(root), then Save.
4. Once GitHub reports deployment, follow the exact URL shown on that settings page.
5. Desktop: drag the 3D view to orbit, drag handles to resize, and choose profiles and finishes.
6. iPhone/Android: use the HTTPS Pages URL in Safari/Chrome. Tap START AR, grant camera access, stand facing a wall, aim the reticle, set approximate distance, then tap PLACE ON WALL. Use REPOSITION if needed.

**Status:** The interface, rendering logic and AR integration are committed, and app.js passes a JavaScript syntax check. These have NOT been visually tested or validated on a real AR device yet. This is a development prototype, not production-ready wall recognition or accurately verified tracking.

## AR placement limitation

The first build does not automatically detect a vertical wall. The customer aims the camera at a wall and manually places the sample an estimated distance away. With SLAM operating, the sample should remain at that 3D world position as the device moves. Actual placement, drift, alignment and metre scaling require phone tests.

## Implementation

- index.html — application structure, scripts and controls
- styles.css — responsive styling
- app.js — loading, caching, cropping shader, trim meshes, resize handles, preview and XR8 pipeline
- Profiles / Textures / ICONS — the existing source assets

Three.js and GLTFLoader use pinned version 0.146.0 (classic global build for compatibility with XR8's Three.js pipeline). XR8 is loaded from the official @8thwall/engine-binary@1 package. World tracking is in the distributed proprietary binary, not the MIT-only framework.

8th Wall license and attribution: https://github.com/8thwall/engine/blob/main/LICENSE
Docs: https://8thwall.org/docs/engine/overview

## Next verification steps

1. Confirm rendering and material appearance for all 5 GLBs in Chrome and Safari. The three larger binary files could not be fully inspected using the GitHub connection.
2. Test camera access and XR8 tracking with real phones. Tune placement and scale.
3. Inspect correct UV mapping on Folded, Variable and V-Groove.
4. Optimize source images (some Tobacco PNGs exceed 10 MB) to WebP or KTX2 after visual comparisons.
5. Improve wall-alignment tooling, browser fallbacks, trim details and original-icon integration.
6. Confirm performance on older phones and tablets.

The large original texture files have not been rewritten. The app uses on-demand loading, asset caching and a capped pixel ratio to limit work until further optimization.
