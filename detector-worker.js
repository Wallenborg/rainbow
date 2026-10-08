import { pipeline, RawImage, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

// A fresh worker gives each backend its own ORT runtime. A failed GPU session
// cannot poison the CPU fallback, and WASM never blocks collage rendering.
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
  : 1;

let detector;
let labels;
let stages;
let chain = Promise.resolve();

function timeCallable(target, key, synchronous = false) {
  return new Proxy(target, {
    apply(fn, receiver, args) {
      const started = performance.now();
      if (synchronous) {
        try { return Reflect.apply(fn, receiver, args); }
        finally { stages[key] += performance.now() - started; }
      }
      return (async () => {
        try { return await Reflect.apply(fn, receiver, args); }
        finally { stages[key] += performance.now() - started; }
      })();
    }
  });
}

async function handle({ id, type, options, image }) {
  try {
    if (type === "init") {
      const started = performance.now();
      labels = options.labels;
      detector = await pipeline("zero-shot-object-detection", options.model, {
        device: options.device, dtype: options.dtype
      });
      if (options.device === "webgpu") {
        env.backends.onnx.webgpu.device?.lost.then(info => {
          self.postMessage({ fatal: "GPU device lost: " + info.message });
        });
      }
      detector.processor = timeCallable(detector.processor, "preprocessMs");
      detector.model = timeCallable(detector.model, "modelMs");
      detector.tokenizer = timeCallable(detector.tokenizer, "tokenizationMs", true);
      self.postMessage({ id, result: {
        ...detector.model.sessions.model.config,
        isolated: self.crossOriginIsolated,
        gpuInitialized: options.device === "webgpu" && Boolean(env.backends.onnx.webgpu.device),
        transformersVersion: env.version,
        wasmThreads: env.backends.onnx.wasm.numThreads,
        loadMs: performance.now() - started,
        worker: true
      }});
    } else if (type === "infer") {
      stages = { preprocessMs: 0, modelMs: 0, tokenizationMs: 0 };
      const started = performance.now();
      const input = new RawImage(image.data, image.width, image.height, 4);
      const detections = await detector(input, labels, { threshold: 0.045, top_k: 8 });
      const pipelineMs = performance.now() - started;
      self.postMessage({ id, result: { detections, timings: {
        ...stages, pipelineMs,
        postprocessMs: Math.max(0, pipelineMs - stages.preprocessMs - stages.modelMs - stages.tokenizationMs)
      }}});
    }
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
}

self.onmessage = event => {
  chain = chain.then(() => handle(event.data));
};
