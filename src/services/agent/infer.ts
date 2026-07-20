// Pure post-processing around the ONNX session — mirrors network.infer():
// phase-selected logits → legal-masked stable softmax; WDL → scalar value.
// Kept ort-free so it is unit-testable against golden fixtures.
import { BOARD_CELLS } from '../../game/types';

/** Legal-masked stable softmax (network.infer): illegal actions get 0. */
export function maskedSoftmax(logits: ArrayLike<number>, mask: Uint8Array): Float32Array {
  let maxLogit = -Infinity;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (mask[a] && logits[a] > maxLogit) maxLogit = logits[a];
  }
  const policy = new Float32Array(BOARD_CELLS);
  let sum = 0;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (!mask[a]) continue;
    policy[a] = Math.exp(logits[a] - maxLogit);
    sum += policy[a];
  }
  if (sum > 0) for (let a = 0; a < BOARD_CELLS; a++) policy[a] /= sum;
  return policy;
}

/** WDL distribution → scalar in [-1, 1]: P(win) − P(loss). */
export function wdlToValue(wdl: ArrayLike<number>): number {
  return wdl[0] - wdl[2];
}
