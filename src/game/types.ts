// Cellmoku game core — pure logic, no React/store dependency.
// Ported to mirror py_reference/env.py (board_size=15, adjacency_cells=4,
// chaining=True, win_length=5, no second-player free-cell handicap).

export const N = 15;
export const CENTER = 7; // N // 2
export const WIN_LENGTH = 5;
export const BOARD_CELLS = N * N; // 225

/** Flat row-major index into the N×N grid: pos = r * N + c, range 0..224. */
export type Pos = number;

/** 1 = first player (black), 2 = second player (white). Matches env P1/P2. */
export type Player = 1 | 2;

export type Phase = 'STONE' | 'CELL';

/** Game outcome. `null` while ongoing. */
export type Winner = Player | 'DRAW' | null;

/**
 * Full game state — the board plus turn/phase bookkeeping.
 * `cells`/`stones` are flat Uint8Arrays of length 225 (index = r*N + c).
 *   cells[i]  : 1 if a cell exists at i, else 0
 *   stones[i] : 0 empty, 1 black, 2 white
 */
export interface GameState {
  cells: Uint8Array;
  stones: Uint8Array;
  currentPlayer: Player;
  phase: Phase;
  /** Cells remaining to place in the current cell sub-turn (env.remaining_k). */
  remainingK: number;
  /** Most recently placed stone (for last-move highlight). */
  lastStonePos: Pos | null;
  /** Cells placed during the current (in-progress) cell sub-turn. */
  thisTurnCells: Pos[];
  /** Cells placed during the most recently completed cell sub-turn. */
  lastCellPositions: Pos[];
  winner: Winner;
  /** Winning line positions (>=5) for highlight, or null. */
  winLine: Pos[] | null;
}

/** A committed turn: one stone placement plus the cells earned/placed after it. */
export interface Turn {
  player: Player;
  stone: Pos;
  cells: Pos[];
}

/** An in-progress turn (stone placed, cells being placed). */
export interface Draft {
  player: Player;
  stone: Pos;
  cells: Pos[];
}

// ── coordinate helpers ───────────────────────────────────────────────────────

export const toPos = (r: number, c: number): Pos => r * N + c;
export const toRow = (pos: Pos): number => Math.floor(pos / N);
export const toCol = (pos: Pos): number => pos % N;
export const inBounds = (r: number, c: number): boolean =>
  r >= 0 && r < N && c >= 0 && c < N;
