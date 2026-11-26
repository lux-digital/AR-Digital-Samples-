# LUX West Coast Naturals — native ARKit / App Clip prototype

**Status:** Native source in development. The GitHub macOS workflow builds an unsigned simulator binary. It does not publish an App Clip, install it on an iPhone, or prove real-device tracking yet.

## What it implements
- Native ARKit vertical wall detection and world placement without LiDAR or image targets.
- Native SwiftUI buttons OVER the live AR camera view. Four independently adjustable edges (inward and outward).
- On-model 3D tap handles that adjust edges.
- ONE source mesh from the original LUX V-Groove/Lap GLB, with original per-vertex UVs.
- At every resize, triangles are cropped against the requested bounds. Geometry and woodgrain remain fixed-scale; no strips, duplicate pieces, invisible blockers or model scale changes.
- Original Heartwood LAP and trim images packaged from the repository. Materials/trim appearance are preliminary.

## No Mac on the user's desk required
The GitHub Actions workflow (.github/workflows/check-native-appclip.yml) runs on a cloud Mac. It exports original assets (tools/export_native_appclip_assets.py), generates the Xcode targets using XcodeGen and compiles both unsigned iOS apps for the simulator.

## Publishing is a separate, mandatory step
An App Clip MUST have a corresponding full app, be signed by an Apple Developer team, and be submitted through App Store Connect. The user can choose:
1. A company-owned Apple Developer team; source can be built on a cloud Mac.
2. A legitimate platform publishing partner who agrees to distribute LUX through that partner's own App Clip / associated app and Apple Developer account. This requires a contractual arrangement and review, not merely borrowing an account.

To publish, update the placeholder bundle identifiers and associations, arrange the signing team, publish through App Store Connect, and test on physical iPhones. No developer certificates or secrets belong in this repository. Apple platform-provider App Clips may support many businesses, but an appropriate publisher still needs to agree.

Android requires a separate solution. App Clips are iOS-only.

## Current link
The existing Quick Look test link has not changed. There is no new user-launchable App Clip URL until a published/signing provider is secured.
