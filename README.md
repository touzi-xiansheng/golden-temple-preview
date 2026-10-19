# Golden Temple development preview

- [Temple](https://touzi-xiansheng.github.io/golden-temple-preview/)
- [Campus (WebGL)](https://touzi-xiansheng.github.io/golden-temple-preview/campus.html)
- [Campus (WebGPU experimental preview)](https://touzi-xiansheng.github.io/golden-temple-preview/campus-webgpu.html)

GitHub Pages serves built static assets from the `main` branch. The complete source is on [source/webgpu-preview](https://github.com/touzi-xiansheng/golden-temple-preview/tree/source/webgpu-preview). This snapshot was built from [8cfc1c0](https://github.com/touzi-xiansheng/golden-temple-preview/commit/8cfc1c0e2bb29e5e9771236c37c455af818bb4ea) with `npm run build -- --base=/golden-temple-preview/`.

The WebGPU preview now caches world-space shadows for the static campus and uses four 512-pixel, parallax-corrected reflection probes. It preserves all seven buildings, vegetation and render resolution. Reduced environment fill improves contrast. Dynamic shadows and planar reflections remain available for diagnosis with `?shadows=dynamic&reflections=planar`.

On the reference Chrome/macOS device at 1920×1080, continuous playback near glass improved from a median application frame interval of 35.9 ms to 16.5 ms. All six sampled tour segments passed a 25 ms p95 interval check. These are application frame intervals, not GPU timings or a guarantee for other devices. [Before/after raw reports and method](https://github.com/touzi-xiansheng/golden-temple-preview/blob/source/webgpu-preview/docs/WEBGPU_IMPLEMENTATION.md) are in the source branch.

The final build also passed six-view screenshots, three quality settings and free-camera checks without recorded page/GPU errors. Node WebGPU tests: 21 passed, one optional real-GPU calibration skipped. The first complete frame took about 15 seconds in that local run; cold-start conditions were not controlled. The browser and GPU must support WebGPU.

Reflection probes approximate mirrors. Cached shadows assume a static sun and geometry. Cross-device, long-duration and full visual acceptance remain incomplete; GPU visibility experiments are not enabled in the campus.

Original Golden Temple project: [Leonxlnx/golden-temple](https://github.com/Leonxlnx/golden-temple), Copyright (c) 2026 Leon Lin, MIT license. See LICENSE and THIRD_PARTY_LICENSES.txt.
