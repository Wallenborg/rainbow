# Real inference investigation — 8 October 2026

Measurements used installed Chrome 154.0.8037.98 on macOS, an Apple Metal-3
hardware adapter (not a fallback adapter), and eight logical CPUs. No flags enabled
experimental GPU support. Each run used the same eight distinct Commons files in
`samples.json`, the original labels, threshold 0.045 and acceptance threshold 0.055,
including the application's area penalties. Inference was strictly serial.

A separate first-photo warmup was excluded from steady-state timings. Samples
include partial, faint and complete rainbows and two fountain rainbows. This is a
small convenience sample, not a labeled accuracy or false-positive validation set.
Acceptance is the application's decision to add a crop, not measured precision.
Downloads were mostly browser cached after the initial run. No transfer-speed or
mobile-performance claims follow from these numbers.

## Backend comparison

`results.json` records direct pipeline timings, boxes and decisions; the canvas
preparation is standardized to the ordinary raster path. Model execution includes
ONNX execution and tensor conversion; preprocessing measures the Transformers.js
image processor separately. Tokenization and postprocessing are outside model time.

| Configuration | Mean model execution | Mean complete pipeline | Accepted |
| --- | ---: | ---: | ---: |
| WASM q8, one thread | 2,563 ms | 2,593 ms | 2/8 (25%) |
| WASM q8, isolated, four threads | 1,271 ms | 1,303 ms | 2/8 (25%) |
| WebGPU fp32, original pixels | 174 ms | 206 ms | 4/8 (50%) |
| WebGPU fp32, longest edge 768 | 165 ms | 195 ms | 4/8 (50%) |
| WebGPU fp32, longest edge 640 | 168 ms | 198 ms | 4/8 (50%) |
| WebGPU q4, original pixels | 465 ms | 503 ms | 2/8 (25%) |
| WebGPU fp16, original pixels | 115 ms | 145 ms | 0/8 (0%) |

The original model factory selected **WASM q8**, never WebGPU. The runtime reported
`device: wasm`, `dtype: q8`, `numThreads: 1`. Browser GPU availability alone does not
select it: [Transformers.js defaults to WASM in browsers](https://raw.githubusercontent.com/huggingface/transformers.js/3.8.1/src/backends/onnx.js).

Fp16 was fast but returned no detections on these photographs and was rejected.
Q4 missed two photographs accepted by fp32 and was slower. Neither was selected.
Fp32 provided a roughly 15-fold model speedup in the controlled backend comparison.
ORT reports some CPU-assigned nodes, including shape operations. This is expected
in a GPU session; it does not mean the whole model has fallen back to WASM. The
successful GPU initialization and measured execution confirm acceleration of this
model on this machine. Per-node GPU kernel coverage was not profiled.

## Production validation and pixel preparation

`production-results.json` records the actual application's serial worker path after
the change, including loading, pixel extraction, cropping and placement:

| Stage, mean over eight photographs | CPU fallback | GPU default |
| --- | ---: | ---: |
| Canvas/pixel preparation | 4.6 ms | 12.1 ms |
| Model preprocessing | 27.0 ms | 35.3 ms |
| Model execution | 2,473 ms | 176 ms |
| Tokenization | 0.14 ms | 1.16 ms |
| Postprocessing inside pipeline | 1.67 ms | 0.74 ms |
| Crop extraction | 0.71 ms | 85.86 ms |
| Placement/rendering | 0.06 ms | 1.52 ms |
| Entire photograph inspection | 2,512 ms | 328 ms |
| Accepted | 2/8 | 4/8 |

GPU crop extraction includes a 675 ms first-crop allocation/readback spike; the
other three accepted crops took 2.3–5.4 ms. The means include rejected photographs
with zero crop/placement work. Model/pipeline warmup was excluded, while first-crop
allocation was deliberately retained. Worker message copying and image waiting
are included in inspection time, so it is not a sum of model-only timings.

Initial image load averages were about 73 ms plus 2.5 ms explicit decode in the first
paired run; warmed runs averaged about 2 ms plus 1.5–1.8 ms decode. Image loading is
therefore not the primary observed bottleneck. Load events can include browser
decoding work; the separate decode measurement is the explicit `img.decode()` wait,
not the browser decoder's entire internal CPU cost.

A production-validation discrepancy revealed that Chrome's canvas path with
`willReadFrequently: true` produced different detector outputs from the ordinary
path. Direct and worker inference agreed when their input preparation matched.
The previous readback path accepted 0/8 on this sample (about 2,509 ms WASM model
execution); ordinary canvas preparation restored 2/8 on WASM and 4/8 on GPU.
The implementation now uses ordinary rasterization and one pixel read per image.
Photographic crops still come from the original decoded source; no pixels are
painted, synthesized or bent. The backend table isolates device/precision changes
using identical preparation rather than mixing that raster-path change into it.

## Input-size and model alternatives

OWL-ViT's downloaded preprocessor configuration specifies a fixed **768 × 768**
model input. Smaller source images do not shrink the model tensor. They barely
changed execution time, and altered boxes/scores despite equal fp32 acceptance
counts. For example, the road photograph's adjusted score fell from 0.184 to 0.086
at edge 768, and its box changed. Full source resolution remains the default;
`?rainbowInput=768` and `?rainbowInput=640` remain experiments.

The initial WASM source-size sweep in `baseline-smaller-inputs.json` caps the
**longest edge** at 900, 768 or 640. That 900 setting is not the untouched source:
Commons returned width 960 thumbnails, some portrait images much taller. These
results must not be substituted for the original-resolution baseline.

Standard small COCO-trained YOLO detectors cannot query “rainbow”: it is absent
from their [published class list](https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/cfg/datasets/coco.yaml).
A custom trained rainbow detector could be smaller, but requires labeled training
and evaluation; no reliable drop-in model was established here. OWLv2 is another
base transformer, not a demonstrated lightweight replacement.

A real test of the 151 MB `onnx-community/grounding-dino-tiny-ONNX` q4f16 export failed
with WebGPU `GridSample` WGSL f32/f16 validation errors and tokenizer postprocessing
errors. Its fp32 export is 719 MB, larger than OWL-ViT's. Its different architecture,
threshold calibration and unverified rainbow localization make a swap unjustified.
See the [model files](https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX/tree/main/onnx).
No model replacement is shipped.

## Startup and browser compatibility

Fp32 weights are approximately **612 MB**, versus **155 MB** for q8. The uncached
fp32 initialization took 111 seconds here, with a 3.7-second first-inference warmup.
On the final production run, cached GPU worker initialization took 2.5 seconds and
warmup 390 ms; CPU worker initialization took 957 ms and warmup 2.6 seconds. Cache,
network and driver state strongly affect these figures. The initial large download
is a material tradeoff; acceleration is strongest after caching. [Model sizes](https://huggingface.co/Xenova/owlvit-base-patch32/tree/main/onnx).

Verified: Chrome 154 on this Apple GPU, with and without isolation. Other browsers
and GPUs were not physically benchmarked. The application checks for an actual
WebGPU adapter; initialization, device loss and inference failures switch to a
fresh WASM worker. CPU fallback uses q8 and stays serial. `?rainbowBackend=wasm`
forces the CPU path. Worker-restricted hosts retain a main-thread WASM fallback.
Serve both `index.html` and `detector-worker.js` through HTTPS or localhost.
WebGPU support varies with browser, device and secure-context policy; see
[Transformers.js WebGPU guidance](https://huggingface.co/docs/transformers.js/v3.8.1/guides/webgpu).

## The two browser warnings

CDP captured `SharedArrayBufferIssue/CreationIssue` and the deprecated feature
`SharedArrayBufferConstructedWithoutIsolation`, both at line 21 of
`ort-wasm-simd-threaded.jsep.mjs`. They refer to the same ORT shared-memory feature
probe, not a second deprecated canvas feature. Details are in `browser-issues.json`.

SharedArrayBuffer enables WASM threads, but browsers restrict it on non-isolated
pages. The application explicitly chooses one WASM thread without isolation and up
to four with isolation. This keeps a valid CPU path; it does not remove the browser's
security policy. Library feature probing can still produce the warning. There is no
need to disable browser protections or downgrade libraries. The warning does not
block the tested GPU path, which does not need SharedArrayBuffer for acceleration.

For multithreaded CPU inference, the static host must send these **HTTP headers**:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Use a secure origin and verify `crossOriginIsolated === true`. Meta tags and client
JavaScript cannot enable isolation. All third-party resources must satisfy CORS or
CORP; the tested CDN imports, model fetches and anonymous Commons image requests
worked under these headers. Isolation also affects cross-origin popup relationships.
No hosting configuration exists in this repository, so live hosting headers were
not changed. The measured roughly two-fold CPU benefit is real but conditional on
that deployment configuration. GPU execution does not require those headers.
See [ONNX Runtime threading configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
and [MDN isolation requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).

## Checks and retained constraints

`tests/browser.cjs` verifies serial inference, automatic initialization/inference
fallback, retained pixels for a retry, title/hash uniqueness, pagination, session
continuation, completion stopping work, reset, coverage removal, export placement
and PNG encoding. These lifecycle checks use stubs; the timings above use real
models and real Commons photographs. Crops were visually inspected against originals.
No new runtime dependencies, backend, commits or pushes were introduced.
