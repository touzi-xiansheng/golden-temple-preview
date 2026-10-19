# Golden Temple development preview

- [Temple](https://touzi-xiansheng.github.io/golden-temple-preview/)
- [Campus (WebGL)](https://touzi-xiansheng.github.io/golden-temple-preview/campus.html)
- [Campus (WebGPU experimental preview)](https://touzi-xiansheng.github.io/golden-temple-preview/campus-webgpu.html)

This repository contains built static assets from the local development project. GitHub Pages serves the `main` branch. Updates require a fresh build and push of the output; local source edits are not automatically published.

The complete development source is on the [source/webgpu-preview branch](https://github.com/touzi-xiansheng/golden-temple-preview/tree/source/webgpu-preview).
This snapshot was built from source commit [9fe99d6](https://github.com/touzi-xiansheng/golden-temple-preview/commit/9fe99d6c8375fc637da9d36deb52c69ad6c4b918) with `npm run build -- --base=/golden-temple-preview/`.

The WebGPU page is an experimental preview requiring a compatible browser and GPU. Its production build was checked on Chrome/macOS with real WebGPU at 1920×1080: seven campus buildings, 907 irradiance probes, four reflection probes and all six tour screenshots completed without recorded page/GPU errors. The first complete frame took about 45 seconds on that run; other devices may take longer. The source tests passed 72 campus and 18 WebGPU cases; one separate real-GPU test was skipped in the Node suite.

Visual quality is still too pale, performance needs work, and full motion, lifecycle and cross-device acceptance remain incomplete. GPU visibility experiments are included in the source but not enabled in the campus. This is not a claim that WebGPU already looks or runs better than the WebGL version.

Original Golden Temple project: [Leonxlnx/golden-temple](https://github.com/Leonxlnx/golden-temple), Copyright (c) 2026 Leon Lin, MIT license. See LICENSE and THIRD_PARTY_LICENSES.txt.
