// Agent worker — owns the ONNX session and runs the whole turn computation
// (inference + MCTS + VCF) off the main thread, so the UI never blocks.
//
// Deployment target is a static GitHub Pages site, which pins the runtime:
//   - no COOP/COEP headers → no SharedArrayBuffer → single-threaded, always
//   - SIMD wasm is the only viable backend (no WebGPU/WebGL probing)
// So there is exactly one execution path here and nothing to detect.
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { N, type GameState } from '../../game/types';
import { encodeObs, legalMask, N_OBS_PLANES } from '../../game/obs';
import { maskedSoftmax, wdlToValue } from './infer';
import { computeTurn } from './search';
import type { Evaluator } from './mcts';
import type { AgentConfig, AgentMove } from './types';

// Point ORT at the wasm binary Vite emitted (the JS glue is already inlined in
// the `onnxruntime-web/wasm` bundle build, so only this one path is needed).
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

interface Manifest {
  file: string;
  checkpoint: string;
  iteration: number;
  quantized: boolean;
}

/** network.infer semantics: phase-selected logits → masked softmax; value = win − loss. */
class OnnxEvaluator implements Evaluator {
  private session: ort.InferenceSession;

  constructor(session: ort.InferenceSession) {
    this.session = session;
  }

  async evaluate(state: GameState): Promise<{ policy: Float32Array; value: number }> {
    const input = new ort.Tensor('float32', encodeObs(state), [1, N_OBS_PLANES, N, N]);
    const out = await this.session.run({ obs: input });
    const logits = (
      state.phase === 'STONE' ? out.stone_logits : out.cell_logits
    ).data as Float32Array;
    const wdl = out.value.data as Float32Array; // softmaxed [win, draw, loss]
    return {
      policy: maskedSoftmax(logits, legalMask(state)),
      value: wdlToValue(wdl),
    };
  }
}

async function createEvaluator(): Promise<OnnxEvaluator> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}models/manifest.json`);
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  const session = await ort.InferenceSession.create(`${base}models/${manifest.file}`, {
    executionProviders: ['wasm'],
  });
  return new OnnxEvaluator(session);
}

// ── RPC ───────────────────────────────────────────────────────────────────────

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'move'; id: number; state: GameState; config: AgentConfig };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'initError'; message: string }
  | { type: 'move'; id: number; move: AgentMove }
  | { type: 'moveError'; id: number; message: string };

let evaluator: OnnxEvaluator | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      evaluator = await createEvaluator();
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'initError', message: String(err) });
    }
    return;
  }

  if (msg.type === 'move') {
    try {
      if (!evaluator) throw new Error('engine not initialised');
      const move = await computeTurn(msg.state, msg.config, evaluator);
      post({ type: 'move', id: msg.id, move });
    } catch (err) {
      post({ type: 'moveError', id: msg.id, message: String(err) });
    }
  }
};
