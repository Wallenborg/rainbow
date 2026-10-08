# Mobile visibility and rendering verification

Changes are confined to this standalone artwork. No commit or push was made.

## Diagnosis

The original app combined `height: 100dvh` with `min-height: 100vh`.
On mobile, `vh` can describe the larger viewport behind browser chrome;
the minimum therefore overrides the smaller dynamic height. The absolutely
positioned bottom status/controls can fall outside the visible screen, while
`overflow: hidden` prevents scrolling to them. Unsupported `dvh` also had no
explicit fallback for the canvas dimensions.

This explains a layout path to an invisible status independently of inference.
A second, independent startup defect was the static CDN module import: if it
failed, none of the application's initialization/error handlers ran. The canvas
would remain empty, and the HTML loading text would never report the failure.
The exact combination on the reported phone has not been confirmed, because no
physical phone browser was tested.

Viewport semantics: [WebKit's viewport unit documentation](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).
Backend compatibility: [Transformers.js WebGPU documentation](https://huggingface.co/docs/transformers.js/guides/webgpu).

## Changes

- `index.html`: grid rows reserve a separate footer; square canvas sizing uses
  the actual available stage; safe-area padding and visual viewport resize
  handling; fallback viewport units without a conflicting minimum; wrapping
  status/error text; 44px touch button heights. Initial HTML status/layout are
  independent of the detector. CDN import and main-thread CPU loading have
  deadlines and visible failures. Unexpected startup/search failures are also
  reported. Canvas resize redraws existing fragments.
- `detector-worker.js`: explicitly reports the selected device/dtype so GPU
  inference failures reliably identify the backend for the existing WASM retry.
- `tests/browser.cjs`, `tests/benchmark.cjs`: adapt their harnesses to deferred
  library import. The benchmark harness was syntax checked, not rerun wholesale.
- `tests/mobile.cjs`: repeatable viewport/rendering/startup failure tests.
- `tests/runtime.cjs`: real Commons/model smoke test without mocked detections
  or mocked network responses.

Detection thresholds, model, categories, retrieval, cropping, random collage
properties, placement, coverage/completion, export and session continuation
remain unchanged.

## Tests performed

Desktop Google Chrome 154 on macOS, headless; mobile viewport/touch emulation
uses the desktop Chromium runtime, not iOS Safari or Android Chrome.

| Viewport | Initial text | Canvas bounds | First fixture fragment | Rotation | Completion controls |
| --- | --- | --- | --- | --- | --- |
| 320 × 568 | pass | pass | pass | pass | pass |
| 375 × 667 | pass | pass | pass | pass | pass |
| 390 × 844 | pass | pass | pass | pass | pass |
| 430 × 932 | pass | pass | pass | pass | pass |
| 768 × 1024 | pass | pass | pass | pass | pass |
| 1024 × 768 | pass | pass | pass | pass | pass |
| 1440 × 900 | pass | pass | pass | pass | pass |
| 568 × 320 | pass | pass | pass | pass | pass |
| 667 × 375 | pass | pass | pass | pass | pass |
| 844 × 390 | pass | pass | pass | pass | pass |
| 932 × 430 | pass | pass | pass | pass | pass |
| 320 × 240 | pass | pass | pass | pass | pass |

The layout suite checks square dimensions, non-overlap, actual painted canvas
pixels, preserved fragments across rotation, and visible completion buttons
with touch target heights. It additionally checks simulated safe areas,
simulated visual viewport height changes, wrapped errors, actual CDN failure,
and simulated worker restrictions followed by CPU initialization failure.
Safe areas/browser bars were simulated, not native mobile browser UI.

Real production page with live Commons requests and unmodified model inference:

- 390 × 844, DPR 3, forced WASM: initialized a q8 worker with one WASM thread,
  accepted a real photograph and painted 32,449 nontransparent canvas pixels.
  Rotation to 844 × 390 retained fragments and rendered pixels within bounds.
- 1440 × 900, automatic backend: initialized a WebGPU fp32 worker, accepted a
  real photograph and painted 10,991 nontransparent canvas pixels. Resize to
  1024 × 768 retained fragments/rendering within bounds.
- No uncaught page JavaScript errors in either real-model run.

Existing browser regressions passed: serialized inference, prefetch reuse,
source deduplication, Commons pagination, coverage recomputation, completion
stopping search, export PNG, screen/export placement agreement, reset/session
continuation, simulated GPU initialization and inference fallback to WASM.

The final footer alignment was checked by rerunning the layout suite. It does
not change inference or collage rules. `git diff --check` and test script syntax
checks passed.

## Reproduction and outstanding device checks

Run from this directory, setting `RAINBOW_PUPPETEER` to an installed
`puppeteer-core` module and optionally `CHROME_PATH` to the Chrome executable:

```sh
node tests/browser.cjs
node tests/mobile.cjs
node tests/runtime.cjs
```

The runtime test needs network access to jsDelivr, Hugging Face and Wikimedia.
Runtime test results/screenshots are stored in `/private/tmp/rainbow-mobile-*`.

Physical iOS Safari and Android Chrome still need verification of visible status
with native browser chrome/notches, actual device model allocation/inference,
first fragment, portrait/landscape rotation, address bar changes, and completion
button taps/download. Desktop emulation and successful desktop WASM inference
are not proof of phone memory limits or mobile WebGPU/WASM support. No model
replacement or threshold reduction was made to conceal those limits.
