# Golden Temple development preview

- [Temple](https://touzi-xiansheng.github.io/golden-temple-preview/)
- [Campus (WebGL)](https://touzi-xiansheng.github.io/golden-temple-preview/campus.html)
- [Campus (WebGPU experimental preview)](https://touzi-xiansheng.github.io/golden-temple-preview/campus-webgpu.html)

GitHub Pages serves built static assets from the `main` branch. The complete source is on [source/webgpu-preview](https://github.com/touzi-xiansheng/golden-temple-preview/tree/source/webgpu-preview). This snapshot was built from [07e3b7c](https://github.com/touzi-xiansheng/golden-temple-preview/commit/07e3b7c483d88fb55c0daea4aed947eacef5e9fa) with `npm run build -- --base=/golden-temple-preview/`.

The latest realism pass fixes excessive sky light from below ground, leaf-back environment scaling and the glass roughness floor. A generated ground-contact mask adds subtle depth at roots and column feet, while a modest apparent-interior fill makes rooms more legible. All seven buildings and 9,179,037 scene triangles remain unchanged. Static shadows and four 512-pixel parallax-corrected reflection probes keep movement inexpensive.

On the reference Chrome/macOS device at 1920×1080, the six tour sections retained median application frame intervals around 16.6 ms. The new p95 range was 17.9–20.0 ms, passing both the 25 ms budget and a paired regression gate against the previous release. Natural camera cuts and free-camera transitions were sampled separately. These are application frame intervals, not GPU timings or a guarantee for other devices.

The production build passed six-view screenshots, three quality settings and free-camera checks without recorded page/GPU errors. Node tests: 26 passed, one optional GPU test skipped; a separate real-GPU run passed all 18 lighting and production-material calibrations. [Matched screenshots, raw reports and limitations](https://github.com/touzi-xiansheng/golden-temple-preview/blob/source/webgpu-preview/docs/WEBGPU_IMPLEMENTATION.md) are in the source branch.

The browser and GPU must support WebGPU. Probe reflections still distort at close range, repeated foliage shapes remain visible, and some glazing still looks too dark. Cached lighting and contact masks assume static geometry. Cross-device and long-duration acceptance remain incomplete; this is not a claim of photographic realism. GPU visibility experiments are not enabled in the campus.

Original Golden Temple project: [Leonxlnx/golden-temple](https://github.com/Leonxlnx/golden-temple), Copyright (c) 2026 Leon Lin, MIT license. See LICENSE and THIRD_PARTY_LICENSES.txt.
