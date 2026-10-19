# Golden Temple development preview

- [Temple](https://touzi-xiansheng.github.io/golden-temple-preview/)
- [Campus (WebGL)](https://touzi-xiansheng.github.io/golden-temple-preview/campus.html)
- [Campus (WebGPU desktop preview)](https://touzi-xiansheng.github.io/golden-temple-preview/campus-webgpu.html)

GitHub Pages serves the static `main` branch. Source: [source/webgpu-preview](https://github.com/touzi-xiansheng/golden-temple-preview/tree/source/webgpu-preview). This snapshot was built from [700e224](https://github.com/touzi-xiansheng/golden-temple-preview/commit/700e224f05e712746e2a5bad6bac7cc8956579f4) with `npm run build -- --base=/golden-temple-preview/`.

The current pass improves daylight colour, courtyard bounce, wood ceilings, leaf transmission and apparent-interior lighting. One nearby glass facade receives a cropped live planar reflection; four static probes cover the rest. The reflection and main pipelines are warmed during loading to reduce the first arcade-cut stall. All seven buildings, 9,179,037 scene triangles and 1,159,231 instances remain procedurally generated. No external models, photographs or HDRIs are used.

Reference-device checks: 43 Node tests passed, one optional GPU test skipped; 72 legacy-campus tests passed; a separate WebGPU run passed 26 lighting/material calibrations. Six-view production screenshots, three quality settings and free-camera checks recorded no page/GPU errors. Paired 1080p steady movement p95 was 18.1–20.1 ms and passed both absolute and baseline gates. The first arcade cut measured 23.9 ms after prewarming; another camera cut peaked at 55.7 ms. These are short application-frame samples, not GPU timings or guarantees for other devices. [Evidence and matched images](https://github.com/touzi-xiansheng/golden-temple-preview/blob/source/webgpu-preview/docs/WEBGPU_IMPLEMENTATION.md).

The scene assumes fixed sunlight and static geometry. Distant glass, simplified interiors, foliage repetition and wide-area shadows remain approximations; long-duration and cross-device validation is incomplete. Mobile is outside this pass. GPU visibility experiments are not enabled. Temple and WebGL-campus HTML and directly referenced assets are unchanged.

Original project: [Leonxlnx/golden-temple](https://github.com/Leonxlnx/golden-temple), Copyright (c) 2026 Leon Lin, MIT license. See LICENSE and THIRD_PARTY_LICENSES.txt.
