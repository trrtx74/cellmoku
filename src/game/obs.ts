// Observation encoding — ports py_reference/env.py `_obs` (10 planes).
// Output layout is CHW (plane-major), matching the ONNX model input
// (1, 10, 15, 15); python's env produces HWC and transposes before inference.
import {
  N,
  BOARD_CELLS,
  WIN_LENGTH,
  inBounds,
  toPos,
  type GameState,
  type Player,
} from './types';
import { frontierMask } from './rules';

export const N_OBS_PLANES = 10;

const WIN_DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

/**
 * env._completion_map — empty real cells where `player` completes >= WIN_LENGTH
 * with a single stone (handles gapped shapes like XX_XX). Non-mutating.
 */
export function completionMap(
  cells: Uint8Array,
  stones: Uint8Array,
  player: Player,
): Uint8Array {
  const out = new Uint8Array(BOARD_CELLS);
  // cheap gate: impossible with fewer than WIN_LENGTH-1 own stones
  let own = 0;
  for (let i = 0; i < BOARD_CELLS; i++) if (stones[i] === player) own++;
  if (own < WIN_LENGTH - 1) return out;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = toPos(r, c);
      if (!cells[i] || stones[i] !== 0) continue;
      for (const [dr, dc] of WIN_DIRS) {
        let length = 1;
        for (const sign of [1, -1]) {
          let nr = r + sign * dr;
          let nc = c + sign * dc;
          while (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) {
            length++;
            nr += sign * dr;
            nc += sign * dc;
          }
        }
        if (length >= WIN_LENGTH) {
          out[i] = 1;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * env._obs — 10-plane observation from the current player's perspective,
 * flattened CHW into a Float32Array of length 10 * 225.
 */
export function encodeObs(s: GameState): Float32Array {
  const p = s.currentPlayer;
  const opp: Player = p === 1 ? 2 : 1;
  const obs = new Float32Array(N_OBS_PLANES * BOARD_CELLS);
  const plane = (ch: number) => ch * BOARD_CELLS;

  const frontier = frontierMask(s.cells); // chaining=True → recompute every call
  const myComp = completionMap(s.cells, s.stones, p);
  const oppComp = completionMap(s.cells, s.stones, opp);
  const phaseVal = s.phase === 'CELL' ? 1 : 0;
  const kVal = s.remainingK / 8.0;

  for (let i = 0; i < BOARD_CELLS; i++) {
    if (s.stones[i] === p) obs[plane(0) + i] = 1;
    if (s.stones[i] === opp) obs[plane(1) + i] = 1;
    if (s.cells[i]) obs[plane(2) + i] = 1;
    if (s.cells[i] && s.stones[i] === 0) obs[plane(3) + i] = 1; // legal stone mask
    if (frontier[i]) obs[plane(4) + i] = 1;
    obs[plane(6) + i] = phaseVal;
    obs[plane(7) + i] = kVal;
    if (myComp[i]) obs[plane(8) + i] = 1;
    if (oppComp[i]) obs[plane(9) + i] = 1;
  }
  if (s.lastStonePos !== null) obs[plane(5) + s.lastStonePos] = 1;
  return obs;
}

/** env.legal_mask — flat boolean mask over 225 actions for the current phase. */
export function legalMask(s: GameState): Uint8Array {
  if (s.phase === 'STONE') {
    const out = new Uint8Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (s.cells[i] && s.stones[i] === 0) out[i] = 1;
    }
    return out;
  }
  return frontierMask(s.cells);
}
