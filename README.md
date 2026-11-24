# LUX — AR Digital Samples

A first-pass 3D viewer + experimental world-tracked WebAR for LUX Architectural Products, using the original GLBs and woodgrain textures.

## Implemented

- Desktop / touch 3D preview with drag-to-orbit.
- All five uploaded GLB profiles: Random Plank, Folded Wall, Variable Wall, Board + Batten, V-Groove / Lap.
- All nine uploaded woodgrain finishes, mapped to the appropriate per-profile texture assets.
- Four independently draggable resize edges and live dimensions in metres.
- Shader cropping of the original geometry, without stretching texture UVs.
- Four adjustable J-style trims with approximately 1 inch of visible overlap.
- Phone AR integration using 8th Wall Distributed Engine Binary (SLAM tracking), metric-scale tracking, a white alignment grid, experimental feature-point vertical-plane estimation, and tap-to-place.

## How to test

This is a static website. No npm installation, backend or Adobe Aero account is needed.

1. Open this repository's Settings → Pages.
2. In Build and deployment, choose Deploy from a branch.
3. Select main and /(root), then Save.
4. Once GitHub reports deployment, follow the exact URL shown on that settings page.
5. Desktop: drag the 3D view to orbit, drag handles to resize, and choose profiles and finishes.
6. iPhone/Android: use the HTTPS Pages URL in Safari/Chrome. Tap START AR, grant camera access, face a wall and scan along the floor–wall junction. Wait for a stable estimate, then tap once. If it never becomes ready, tap two points on the physical floor–wall edge to align manually. Use REPOSITION after placing if needed. There is no distance slider.

**Status:** The interface, rendering logic and AR integration are committed, and app.js passes a JavaScript syntax check. These have NOT been visually tested or validated on a real AR device yet. This is a development prototype, not production-ready wall recognition or accurately verified tracking.

## Isolated Floor → Wall experiment (existing test page)

**Test URL:** `https://lux-digital.github.io/AR-Digital-Samples-/floor-test.html`.

This opt-in page does **not load the original automatic seam detector**. It now uses one adjustable, live vertical grid, positioned in 8th Wall's tracked horizontal Y=0 world coordinates. It does not claim automatic wall recognition.

**Testing on a phone:**
1. Tap START AR, grant camera permission, and scan the floor until tracking is normal. A white world-space vertical grid appears.
2. **Drag the grid** to move it left/right and closer/farther until the bottom edge meets the real wall.
3. **Drag the circular rotate control** left or right to align the plane angle with the real wall.
4. Tap **PLACE WALL** to replace the grid with the LUX sample. Then walk sideways, closer, and farther away to evaluate stability.
5. Use **REPOSITION** to realign, or **RESET ALIGNMENT** before placement to start over. **SAVE DIAGNOSTICS** exports camera tracking and plane adjustments.

No extra app, subscription, manual two-point placement, camera-pixel seam detection, or model changes are involved. The original main page (`index.html`) is kept unchanged. The AR engine can still drift or reset; manual alignment can compensate for an incorrect plane angle but cannot correct a tracking reset.

## Test 11: tracking failure fix and visible manual controls

The November 23 diagnostic report recorded **79 JavaScript errors** originating from a typo in `wall-guide.js` line 353: `trackingNormal` was used in `getDebug()` although the declared variable was `trackedNormal`. That bug prevented diagnostic frames from completing. It has been corrected.

The original report also recorded **zero camera frames processed** by the seam finder. The new implementation optionally uses 8th Wall's `CameraPixelArray.pipelineModule({luminance:true,width:112,height:176})` to sample live camera luminance directly. This avoids relying solely on an accessible HTML video element on Safari. If the module is unavailable, the previous video path remains, and the report records which inputs are missing. The new path is unproven on actual phones.

While scanning, users see a **white dashed alignment reference grid** even before any wall detection succeeds. The grid is not evidence that a physical wall was detected. Users may still tap two points along the real floor–wall seam to place manually. The **PLACE TEST SAMPLE** button is an explicit fallback which places a panel approximately 1.5 m in front of the camera for testing stability and geometry. It is **not wall-aligned** and must not be interpreted as an automatic placement result. After placement, the four resize handles and finish controls remain available.

The diagnostics exporter remains available throughout the test.

## Collecting on-device AR diagnostics (test 10)

The AR view now has a **SAVE DIAGNOSTICS** button near the upper-right, visible while scanning or after placement. It also stays available if the XR startup fails or after returning to preview. Press the button to open the report dialog, then select **SHARE / SAVE JSON REPORT** (iPhone: Save to Files or share directly) or **COPY REPORT TEXT** as a fallback. Send the saved `.json` file back through the ChatGPT conversation.

Technical data captured locally: camera initialization state, video readiness/dimensions, XR tracking statuses and reasons, sampled feature-point counts, seam detector confidence and errors, wall-estimate agreement, placement taps/poses, runtime exceptions, viewport and device/browser information. No camera frames, photos, video, audio, GPS coordinates or remote telemetry uploads are captured. Nothing is transmitted automatically.

A debugging overlay can still be enabled using `?arDebug=1`, but the Save Diagnostics button no longer requires that option. The report will help distinguish between unsupported/unavailable camera frames, insufficient tracked points, sensor disagreement and genuine SLAM tracking instability. It does not itself improve physical tracking.

## AR placement limitation

8th Wall's native SLAM estimates **one horizontal ground plane**, not native vertical wall planes. The experimental `wall-guide.js` v2 combines three sources:

1. **Camera image:** low-resolution horizontal-contrast analysis searches for a floor–wall seam, sampled around three times per second. A *white dashed line* is only a visual candidate, not verified wall recognition.
2. **SLAM feature points:** custom RANSAC fits approximately vertical feature-point clusters. When possible, it cross-checks their orientation/location against the image seam.
3. **Real-world floor estimate:** camera rays intersect the tracked horizontal Y=0 ground plane to locate the seam and calculate a candidate wall orientation in metre-scale coordinates.

The estimator requires sustained temporal consistency. When a candidate becomes stable, its world-space position stays fixed **even after the phone is pointed away from the seam**. A green grid indicates a stable *estimate*, not native wall recognition.

**Manual fallback:** If a wall cannot be confirmed automatically, aim at the floor–wall edge and tap two separated points along the same junction (left end, then right end). This defines a vertical plane using the tracked ground plane. No arbitrary 1.45-metre placement is accepted just because the user taps. The app copies the wall pose *once* on placement. Later seam detections **never move the placed panel**. After placement, tracking stability still depends on 8th Wall SLAM and the environment.

World tracking uses `scale: 'absolute'` (real-world metre coordinates), so the user does not need a distance slider. This does **not** guarantee accurate scale until ground tracking has calibrated. Repetitive woodgrain surfaces and plain featureless walls remain challenging. Validate alignment, size and drift on real devices before treating these experiments as reliable automatic wall detection.

## Implementation

- index.html — application structure, scripts and controls
- styles.css — responsive styling
- app.js — loading, caching, cropping shader, trim meshes, resize handles, preview and XR8 pipeline
- wall-guide.js — experimental camera seam detection, floor-plane raycasts, feature-point fitting and fixed-pose grid overlay
- diagnostics.js — on-device diagnostic recorder and iPhone-friendly JSON report export
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
