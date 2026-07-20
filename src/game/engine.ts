// Turn engine: applies actions, mirrors env.py step flow, and computes undo targets.
import {
  BOARD_CELLS,
  type GameState,
  type Player,
  type Pos,
  type Turn,
  type Draft,
} from './types';
import {
  initialCells,
  computeK,
  hasFrontier,
  frontierMask,
  hasLegalStone,
  checkWin,
} from './rules';

// ── construction / cloning ───────────────────────────────────────────────────

export function initialState(): GameState {
  return {
    cells: initialCells(),
    stones: new Uint8Array(BOARD_CELLS),
    currentPlayer: 1,
    phase: 'STONE',
    remainingK: 0,
    lastStonePos: null,
    thisTurnCells: [],
    lastCellPositions: [],
    winner: null,
    winLine: null,
  };
}

export function cloneState(s: GameState): GameState {
  return {
    cells: s.cells.slice(),
    stones: s.stones.slice(),
    currentPlayer: s.currentPlayer,
    phase: s.phase,
    remainingK: s.remainingK,
    lastStonePos: s.lastStonePos,
    thisTurnCells: [...s.thisTurnCells],
    lastCellPositions: [...s.lastCellPositions],
    winner: s.winner,
    winLine: s.winLine ? [...s.winLine] : null,
  };
}

const other = (p: Player): Player => (p === 1 ? 2 : 1);

// ── step (mutating helpers; callers pass a state they own) ────────────────────

/** env._end_turn — switch player, reset to stone phase, check for draw. */
function endTurn(s: GameState): void {
  s.lastCellPositions = s.thisTurnCells;
  s.thisTurnCells = [];
  s.currentPlayer = other(s.currentPlayer);
  s.phase = 'STONE';
  s.remainingK = 0;
  if (!hasLegalStone(s.cells, s.stones)) {
    s.winner = 'DRAW';
  }
}

/** env._step_stone — returns a new state with the stone applied. */
export function applyStone(state: GameState, pos: Pos): GameState {
  const s = cloneState(state);
  if (s.phase !== 'STONE') throw new Error('applyStone called outside STONE phase');
  if (!s.cells[pos] || s.stones[pos] !== 0) {
    throw new Error(`illegal stone at ${pos}`);
  }
  const p = s.currentPlayer;
  s.stones[pos] = p;
  s.lastStonePos = pos;
  s.thisTurnCells = [];

  const line = checkWin(s.stones, pos, p);
  if (line) {
    s.winner = p;
    s.winLine = line;
    return s;
  }

  const k = computeK(s.stones, pos, p);
  s.remainingK = k;

  if (k === 0 || !hasFrontier(s.cells)) {
    // No cell phase (K=0 or no room): turn ends immediately.
    endTurn(s);
  } else {
    s.phase = 'CELL';
  }
  return s;
}

/** env._step_cell — returns a new state with one cell placed. */
export function applyCell(state: GameState, pos: Pos): GameState {
  const s = cloneState(state);
  if (s.phase !== 'CELL') throw new Error('applyCell called outside CELL phase');
  if (!frontierMask(s.cells)[pos]) throw new Error(`illegal cell at ${pos}`);
  s.cells[pos] = 1;
  s.thisTurnCells = [...s.thisTurnCells, pos];
  s.remainingK -= 1;

  if (s.remainingK === 0 || !hasFrontier(s.cells)) {
    // Used all K, or frontier exhausted (remaining K is soaked / discarded).
    s.remainingK = 0;
    endTurn(s);
  }
  return s;
}

// ── replay ────────────────────────────────────────────────────────────────────

/**
 * Rebuild state by replaying committed turns from scratch.
 * If `openLastCells` is true, the final turn's stone is applied but its cells are
 * NOT — leaving the state mid-turn in CELL phase (used by undo to "re-open" a turn).
 */
export function replay(turns: Turn[], openLastCells = false): GameState {
  let s = initialState();
  turns.forEach((turn, idx) => {
    const isLast = idx === turns.length - 1;
    s = applyStone(s, turn.stone);
    if (isLast && openLastCells) return; // stop after stone, stay in CELL phase
    for (const cell of turn.cells) {
      if (s.phase !== 'CELL') break; // defensive
      s = applyCell(s, cell);
    }
  });
  return s;
}

/** Rebuild the live state from committed turns plus an optional in-progress draft. */
export function rebuild(turns: Turn[], draft: Draft | null): GameState {
  let s = replay(turns);
  if (draft) {
    s = applyStone(s, draft.stone);
    for (const cell of draft.cells) {
      if (s.phase !== 'CELL') break;
      s = applyCell(s, cell);
    }
  }
  return s;
}

// ── undo planning ──────────────────────────────────────────────────────────────

export type Mode = 'VS_CPU' | 'VS_HUMAN';

export interface UndoPlan {
  turns: Turn[];
  draft: Draft | null;
}

/**
 * Compute the target of an undo, per PLAN.md §1 rules. Returns the new
 * (turns, draft) from which the live state is rebuilt, or null if nothing can
 * be undone. `humanColor` is only consulted for VS_CPU (to skip the CPU turn).
 *
 * Cases:
 *  - Draft present (CELL phase, mid-turn): drop the draft → back to this turn's
 *    stone step (same player re-places the stone).
 *  - No draft (STONE phase, turn start): rewind to the target turn T and re-open
 *    its cell step (or its stone step if T earned no cells). In VS_CPU, T is the
 *    human's previous turn (the intervening CPU turn is removed); in VS_HUMAN, T
 *    is the immediately preceding turn.
 */
export function planUndo(
  turns: Turn[],
  draft: Draft | null,
  mode: Mode,
): UndoPlan | null {
  if (draft) {
    // Mid cell-placement: discard the whole in-progress turn.
    return { turns, draft: null };
  }

  // STONE phase, turn start. Pick the target turn index.
  const targetIdx = mode === 'VS_CPU' ? turns.length - 2 : turns.length - 1;
  if (targetIdx < 0) return null;

  const target = turns[targetIdx];
  const keep = turns.slice(0, targetIdx);

  if (target.cells.length > 0) {
    // Re-open the target turn's cell step: keep its stone, drop its cells.
    return { turns: keep, draft: { player: target.player, stone: target.stone, cells: [] } };
  }
  // Target earned no cells: drop it entirely → its stone step.
  return { turns: keep, draft: null };
}

/** Whether an undo is currently possible (mirrors planUndo returning non-null). */
export function canUndo(turns: Turn[], draft: Draft | null, mode: Mode): boolean {
  if (draft) return true;
  const targetIdx = mode === 'VS_CPU' ? turns.length - 2 : turns.length - 1;
  return targetIdx >= 0;
}
