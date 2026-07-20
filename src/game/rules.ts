// Pure rule predicates — each mirrors a py_reference/env.py method.
import {
  N,
  CENTER,
  WIN_LENGTH,
  BOARD_CELLS,
  inBounds,
  toPos,
  type Pos,
  type Player,
} from './types';

// 8 directions for cell earning (env.DIRS_8).
const DIRS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

// 4 win directions (env.WIN_DIRS): horizontal, vertical, two diagonals.
const WIN_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 0], [1, 1], [1, -1],
];

/** Fresh board: empty 3×3 ring around the center (center itself has no cell). env.reset(). */
export function initialCells(): Uint8Array {
  const cells = new Uint8Array(BOARD_CELLS);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      cells[toPos(CENTER + dr, CENTER + dc)] = 1;
    }
  }
  return cells;
}

/** K = count of `player`'s stones among the 8 neighbours of `pos`. env._compute_k. */
export function computeK(stones: Uint8Array, pos: Pos, player: Player): number {
  const r = Math.floor(pos / N);
  const c = pos % N;
  let count = 0;
  for (const [dr, dc] of DIRS_8) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) count++;
  }
  return count;
}

/**
 * Frontier mask: positions 4-directionally adjacent to an existing cell but not
 * themselves cells. env._compute_frontier (adjacency_cells=4). Returns Uint8Array.
 */
export function frontierMask(cells: Uint8Array): Uint8Array {
  const out = new Uint8Array(BOARD_CELLS);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = toPos(r, c);
      if (cells[i]) continue; // frontier excludes existing cells
      if (
        (r > 0 && cells[toPos(r - 1, c)]) ||
        (r < N - 1 && cells[toPos(r + 1, c)]) ||
        (c > 0 && cells[toPos(r, c - 1)]) ||
        (c < N - 1 && cells[toPos(r, c + 1)])
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** List form of the frontier. */
export function frontierList(cells: Uint8Array): Pos[] {
  const mask = frontierMask(cells);
  const out: Pos[] = [];
  for (let i = 0; i < BOARD_CELLS; i++) if (mask[i]) out.push(i);
  return out;
}

/** True if any frontier position exists. Cheaper than building the list. */
export function hasFrontier(cells: Uint8Array): boolean {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = toPos(r, c);
      if (cells[i]) continue;
      if (
        (r > 0 && cells[toPos(r - 1, c)]) ||
        (r < N - 1 && cells[toPos(r + 1, c)]) ||
        (c > 0 && cells[toPos(r, c - 1)]) ||
        (c < N - 1 && cells[toPos(r, c + 1)])
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Cells that exist but hold no stone — valid stone-placement targets. env._legal_stone_mask. */
export function legalStoneList(cells: Uint8Array, stones: Uint8Array): Pos[] {
  const out: Pos[] = [];
  for (let i = 0; i < BOARD_CELLS; i++) if (cells[i] && stones[i] === 0) out.push(i);
  return out;
}

/** True if `player` has at least one legal stone target. */
export function hasLegalStone(cells: Uint8Array, stones: Uint8Array): boolean {
  for (let i = 0; i < BOARD_CELLS; i++) if (cells[i] && stones[i] === 0) return true;
  return false;
}

/**
 * Win check for a stone just placed at `pos` by `player`. env._check_win.
 * Returns the winning line's positions (>= WIN_LENGTH, overline included) or null.
 */
export function checkWin(stones: Uint8Array, pos: Pos, player: Player): Pos[] | null {
  const r = Math.floor(pos / N);
  const c = pos % N;
  for (const [dr, dc] of WIN_DIRS) {
    const line: Pos[] = [pos];
    // extend forward
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) {
      line.push(toPos(nr, nc));
      nr += dr;
      nc += dc;
    }
    // extend backward
    nr = r - dr;
    nc = c - dc;
    while (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) {
      line.unshift(toPos(nr, nc));
      nr -= dr;
      nc -= dc;
    }
    if (line.length >= WIN_LENGTH) return line;
  }
  return null;
}
