import { describe, it, expect } from 'vitest';
import { N, toPos, type GameState, type Player, type Phase, type Turn, type Draft } from './types';
import {
  initialCells,
  computeK,
  frontierMask,
  hasFrontier,
  frontierList,
  legalStoneList,
  hasLegalStone,
} from './rules';
import {
  initialState,
  applyStone,
  applyCell,
  replay,
  rebuild,
  planUndo,
  canUndo,
  type Mode,
} from './engine';

// ── test helpers ──────────────────────────────────────────────────────────────

const P = (r: number, c: number) => toPos(r, c);

interface StateOpts {
  cells?: Array<[number, number]>;
  stones?: Array<[number, number, Player]>;
  fullCells?: boolean;
  currentPlayer?: Player;
  phase?: Phase;
  remainingK?: number;
}

function mkState(opts: StateOpts = {}): GameState {
  const cells = new Uint8Array(N * N);
  const stones = new Uint8Array(N * N);
  if (opts.fullCells) cells.fill(1);
  for (const [r, c] of opts.cells ?? []) cells[P(r, c)] = 1;
  for (const [r, c, p] of opts.stones ?? []) {
    cells[P(r, c)] = 1;
    stones[P(r, c)] = p;
  }
  return {
    cells,
    stones,
    currentPlayer: opts.currentPlayer ?? 1,
    phase: opts.phase ?? 'STONE',
    remainingK: opts.remainingK ?? 0,
    lastStonePos: null,
    thisTurnCells: [],
    lastCellPositions: [],
    winner: null,
    winLine: null,
  };
}

/** Drive a game via the same commit logic the store uses. */
function makeGame(mode: Mode) {
  let turns: Turn[] = [];
  let draft: Draft | null = null;
  let state = initialState();

  function place(pos: number) {
    if (state.phase === 'STONE') {
      draft = { player: state.currentPlayer, stone: pos, cells: [] };
      state = applyStone(state, pos);
      if (state.phase !== 'CELL' || state.winner) {
        turns.push(draft);
        draft = null;
      }
    } else {
      draft!.cells.push(pos);
      state = applyCell(state, pos);
      if (state.phase !== 'CELL') {
        turns.push(draft!);
        draft = null;
      }
    }
  }

  function undo() {
    const plan = planUndo(turns, draft, mode);
    if (!plan) return false;
    turns = plan.turns;
    draft = plan.draft;
    state = rebuild(turns, draft);
    return true;
  }

  return {
    place,
    undo,
    get state() { return state; },
    get turns() { return turns; },
    get draft() { return draft; },
    canUndo: () => canUndo(turns, draft, mode),
  };
}

// ── 1. K calculation (test_env.py TestKCalculation) ──────────────────────────

describe('computeK', () => {
  it('is 0 with no adjacent own stones', () => {
    const s = mkState({ cells: [[6, 7]] });
    expect(computeK(s.stones, P(6, 7), 1)).toBe(0);
  });

  it('counts own stones in all 8 directions', () => {
    const s = mkState({
      stones: [[6, 7, 1], [8, 7, 1], [7, 6, 1], [6, 6, 1], [8, 8, 1]],
    });
    expect(computeK(s.stones, P(7, 7), 1)).toBe(5);
  });

  it('ignores opponent stones', () => {
    const s = mkState({ stones: [[6, 7, 2], [8, 7, 1]] });
    expect(computeK(s.stones, P(7, 7), 1)).toBe(1);
  });

  it('maxes out at 8', () => {
    const stones: Array<[number, number, Player]> = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) stones.push([7 + dr, 7 + dc, 1]);
    const s = mkState({ stones });
    expect(computeK(s.stones, P(7, 7), 1)).toBe(8);
  });
});

// ── 2. Chaining frontier (chaining always on for web) ────────────────────────

describe('frontier', () => {
  it('extends from a newly placed cell (chaining)', () => {
    // cells at row 7 cols 6,7,8; stones (7,6)=P1,(7,8)=P1; cell phase K=2.
    const s = mkState({
      cells: [[7, 6], [7, 7], [7, 8]],
      stones: [[7, 6, 1], [7, 8, 1]],
      phase: 'CELL',
      remainingK: 2,
      currentPlayer: 1,
    });
    expect(frontierMask(s.cells)[P(7, 5)]).toBe(1);
    const s2 = applyCell(s, P(7, 5));
    // col 4 now reachable via the newly placed cell at (7,5)
    expect(frontierMask(s2.cells)[P(7, 4)]).toBe(1);
  });

  it('excludes existing cells and the center hole is in frontier', () => {
    const cells = initialCells();
    expect(frontierMask(cells)[P(7, 7)]).toBe(1); // center hole adj to ring cells
    expect(frontierMask(cells)[P(6, 6)]).toBe(0); // existing cell, not frontier
  });
});

// ── 3. Win detection (test_env.py TestWinDetection) ──────────────────────────

describe('checkWin / applyStone win', () => {
  const winCase = (
    line: Array<[number, number]>,
    place: [number, number],
    player: Player,
  ) => {
    const s = mkState({
      stones: line.map(([r, c]) => [r, c, player] as [number, number, Player]),
      cells: [place],
      currentPlayer: player,
    });
    return applyStone(s, P(place[0], place[1]));
  };

  it('detects horizontal win', () => {
    const s = winCase([[7, 4], [7, 5], [7, 6], [7, 7]], [7, 8], 1);
    expect(s.winner).toBe(1);
    expect(s.winLine).toHaveLength(5);
  });

  it('detects vertical win', () => {
    const s = winCase([[3, 7], [4, 7], [5, 7], [6, 7]], [7, 7], 1);
    expect(s.winner).toBe(1);
  });

  it('detects diagonal win', () => {
    const s = winCase([[3, 3], [4, 4], [5, 5], [6, 6]], [7, 7], 1);
    expect(s.winner).toBe(1);
  });

  it('detects anti-diagonal win', () => {
    const s = winCase([[3, 11], [4, 10], [5, 9], [6, 8]], [7, 7], 1);
    expect(s.winner).toBe(1);
  });

  it('counts overline (6+) as a win', () => {
    const s = winCase([[7, 4], [7, 5], [7, 6], [7, 7], [7, 8]], [7, 9], 1);
    expect(s.winner).toBe(1);
    expect(s.winLine!.length).toBeGreaterThanOrEqual(6);
  });

  it('does not award a win for the opponent line', () => {
    // P2 has 5 in a row; P1 places elsewhere. Extra empty cell keeps game alive.
    const s = mkState({
      stones: [[7, 4, 2], [7, 5, 2], [7, 6, 2], [7, 7, 2], [7, 8, 2]],
      cells: [[3, 3], [0, 0]],
      currentPlayer: 1,
    });
    const s2 = applyStone(s, P(3, 3));
    expect(s2.winner).toBeNull();
  });

  it('never triggers a win during cell placement', () => {
    // Fill the hole with a stone next to an own stone → K=1 → cell phase, no win.
    const s = mkState({
      cells: [[7, 7]],
      stones: [[7, 6, 1]],
      currentPlayer: 1,
    });
    const s2 = applyStone(s, P(7, 7));
    expect(s2.winner).toBeNull();
    expect(s2.phase).toBe('CELL');
  });

  it('awards P2 a win', () => {
    const s = winCase([[7, 4], [7, 5], [7, 6], [7, 7]], [7, 8], 2);
    expect(s.winner).toBe(2);
  });
});

// ── 4. Draw detection (test_env.py TestDrawDetection) ────────────────────────

describe('draw', () => {
  it('declares a draw when the next player has no stone target', () => {
    // Full 15×15 of cells, all P2 except (0,0) empty. P1 plays (0,0): K=0, no win.
    const cells = new Uint8Array(N * N).fill(1);
    const stones = new Uint8Array(N * N).fill(2);
    stones[P(0, 0)] = 0;
    const s: GameState = {
      cells, stones, currentPlayer: 1, phase: 'STONE', remainingK: 0,
      lastStonePos: null, thisTurnCells: [], lastCellPositions: [], winner: null, winLine: null,
    };
    const s2 = applyStone(s, P(0, 0));
    // No 5-in-a-row of P1, board now full → draw at end of turn.
    expect(s2.winner).toBe('DRAW');
  });

  it('does not draw while empty cells remain', () => {
    const s = applyStone(initialState(), legalStoneList(initialCells(), new Uint8Array(N * N))[0]);
    expect(s.winner).toBeNull();
  });
});

// ── 5. Option A — K exceeds available spots (test_env.py TestOptionA) ─────────

describe('Option A (K soak)', () => {
  it('skips the cell phase when the board leaves no frontier', () => {
    const cells = new Uint8Array(N * N).fill(1); // full board, no frontier
    const stones = new Uint8Array(N * N);
    stones[P(7, 6)] = 1;
    stones[P(7, 8)] = 1;
    stones[P(6, 7)] = 1;
    stones[P(8, 7)] = 1;
    const s: GameState = {
      cells, stones, currentPlayer: 1, phase: 'STONE', remainingK: 0,
      lastStonePos: null, thisTurnCells: [], lastCellPositions: [], winner: null, winLine: null,
    };
    expect(hasFrontier(cells)).toBe(false);
    const s2 = applyStone(s, P(7, 7)); // K=4 but no room
    expect(s2.phase).toBe('STONE');
    expect(s2.remainingK).toBe(0);
    expect(s2.currentPlayer).toBe(2);
  });

  it('soaks remaining K when the frontier is exhausted mid cell-phase', () => {
    // All cells filled except one frontier spot X; placing X leaves no frontier.
    const cells = new Uint8Array(N * N).fill(1);
    cells[P(0, 0)] = 0; // the single frontier spot
    const s: GameState = {
      cells, stones: new Uint8Array(N * N), currentPlayer: 1, phase: 'CELL', remainingK: 2,
      lastStonePos: null, thisTurnCells: [], lastCellPositions: [], winner: null, winLine: null,
    };
    expect(frontierMask(cells)[P(0, 0)]).toBe(1);
    const s2 = applyCell(s, P(0, 0));
    expect(s2.phase).toBe('STONE');
    expect(s2.remainingK).toBe(0);
  });
});

// ── 6/7. Perspective + initial K=0 (test_env.py TestPerspective/TestInitialK) ─

describe('turn flow', () => {
  it('keeps the same player during the cell sub-turn', () => {
    const s = mkState({ cells: [[7, 7]], stones: [[7, 6, 1]], currentPlayer: 1 });
    const s2 = applyStone(s, P(7, 7));
    expect(s2.phase).toBe('CELL');
    expect(s2.currentPlayer).toBe(1);
  });

  it('switches player after the cell sub-turn completes', () => {
    const s = mkState({ cells: [[7, 7]], stones: [[7, 6, 1]], currentPlayer: 1 });
    let s2 = applyStone(s, P(7, 7)); // K=1 → cell phase
    s2 = applyCell(s2, frontierList(s2.cells)[0]);
    expect(s2.currentPlayer).toBe(2);
  });

  it('first move earns no cells and passes the turn', () => {
    const s = applyStone(initialState(), P(7, 6));
    expect(s.phase).toBe('STONE');
    expect(s.currentPlayer).toBe(2);
    expect(s.remainingK).toBe(0);
  });
});

// ── 8. Hole vs cell (test_env.py TestHoleVsEmptyCell) ─────────────────────────

describe('initial board', () => {
  it('has exactly 8 cells forming the center ring, center is a hole', () => {
    const cells = initialCells();
    expect(cells.reduce((a, b) => a + b, 0)).toBe(8);
    expect(cells[P(7, 7)]).toBe(0);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) expect(cells[P(7 + dr, 7 + dc)]).toBe(1);
  });

  it('hole is not a legal stone target but is in the frontier', () => {
    const cells = initialCells();
    const stones = new Uint8Array(N * N);
    expect(legalStoneList(cells, stones)).not.toContain(P(7, 7));
    expect(hasLegalStone(cells, stones)).toBe(true);
    expect(frontierList(cells)).toContain(P(7, 7));
  });
});

// ── integration: random play terminates ───────────────────────────────────────

describe('integration', () => {
  it('terminates within 225 stone+cell steps under random legal play', () => {
    let s = initialState();
    let steps = 0;
    while (!s.winner) {
      const legal = s.phase === 'STONE'
        ? legalStoneList(s.cells, s.stones)
        : frontierList(s.cells);
      const pos = legal[Math.floor((steps * 2654435761) % legal.length)];
      s = s.phase === 'STONE' ? applyStone(s, pos) : applyCell(s, pos);
      steps++;
      expect(steps).toBeLessThanOrEqual(225 * 9);
    }
    expect(s.winner).not.toBeNull();
  });

  it('applyStone does not mutate the input state', () => {
    const s = initialState();
    const before = s.stones.slice();
    applyStone(s, P(7, 6));
    expect(s.stones).toEqual(before);
  });
});

// ── undo (PLAN.md §1 four scenarios) ──────────────────────────────────────────

describe('undo', () => {
  it('example 2 — VS_CPU, mid cell phase → back to this turn stone step', () => {
    const g = makeGame('VS_CPU');
    g.place(P(7, 6)); // P1 K0 → commit
    g.place(P(7, 8)); // P2 K0 → commit
    g.place(P(6, 7)); // P1: adjacent to (7,6) → K1 → cell phase (draft open)
    expect(g.state.phase).toBe('CELL');
    expect(g.undo()).toBe(true);
    expect(g.state.phase).toBe('STONE');
    expect(g.state.currentPlayer).toBe(1);
    expect(g.state.stones[P(6, 7)]).toBe(0); // stone removed
    expect(g.draft).toBeNull();
  });

  it('example 1 — VS_CPU, my turn start → previous my turn first-cell step (CPU turn removed)', () => {
    const g = makeGame('VS_CPU');
    g.place(P(7, 6)); // T1 P1 K0
    g.place(P(7, 8)); // T2 P2 K0
    g.place(P(6, 7)); // P1 K1 → cell phase
    const cell = frontierList(g.state.cells)[0];
    g.place(cell); // finish P1 turn → T3 (cells:[cell])
    // now P2 (CPU) turn:
    g.place(P(8, 7)); // T4 P2 (K? (8,7) neighbors incl (7,8)P2 → K1 → cell phase)
    if (g.state.phase === 'CELL') g.place(frontierList(g.state.cells)[0]); // finish T4
    expect(g.state.currentPlayer).toBe(1);
    expect(g.state.phase).toBe('STONE');
    // undo: back into P1's previous turn (T3) first cell step; T4 removed
    expect(g.undo()).toBe(true);
    expect(g.state.phase).toBe('CELL');
    expect(g.state.currentPlayer).toBe(1);
    expect(g.state.stones[P(6, 7)]).toBe(1); // my stone kept
    expect(g.state.cells[cell]).toBe(0); // my earned cell removed
    expect(g.state.stones[P(8, 7)]).toBe(0); // CPU turn removed
  });

  it('example 3 — VS_HUMAN, P1 turn start → previous P2 turn first-cell step', () => {
    const g = makeGame('VS_HUMAN');
    g.place(P(7, 6)); // T1 P1 K0
    g.place(P(6, 6)); // T2 P2 K0
    g.place(P(8, 6)); // P1 adjacent (7,6) → K1 → cell
    g.place(frontierList(g.state.cells)[0]); // finish T3 (P1)
    g.place(P(6, 7)); // P2 adjacent (6,6) → K1 → cell
    const p2cell = frontierList(g.state.cells)[0];
    g.place(p2cell); // finish T4 (P2)
    expect(g.state.currentPlayer).toBe(1);
    // undo → reopen P2's turn (T4) cell step
    expect(g.undo()).toBe(true);
    expect(g.state.phase).toBe('CELL');
    expect(g.state.currentPlayer).toBe(2);
    expect(g.state.stones[P(6, 7)]).toBe(2); // P2 stone kept
    expect(g.state.cells[p2cell]).toBe(0); // P2 cell removed
  });

  it('example 4 — VS_HUMAN, P1 mid cell phase → back to this turn stone step', () => {
    const g = makeGame('VS_HUMAN');
    g.place(P(7, 6)); // T1 P1
    g.place(P(7, 8)); // T2 P2
    g.place(P(6, 7)); // P1 K1 → cell phase
    expect(g.state.phase).toBe('CELL');
    expect(g.undo()).toBe(true);
    expect(g.state.phase).toBe('STONE');
    expect(g.state.currentPlayer).toBe(1);
    expect(g.state.stones[P(6, 7)]).toBe(0);
  });

  it('cannot undo at the very first move', () => {
    const gCpu = makeGame('VS_CPU');
    expect(gCpu.canUndo()).toBe(false);
    const gHum = makeGame('VS_HUMAN');
    expect(gHum.canUndo()).toBe(false);
  });

  it('VS_CPU: no undo until the human has completed a turn', () => {
    // Human is P2: after CPU's first move it is P2's turn start with only 1 committed turn.
    const g = makeGame('VS_CPU');
    g.place(P(7, 6)); // CPU (P1) K0 → commit, now P2's turn
    expect(g.canUndo()).toBe(false); // targetIdx = 1-2 = -1
  });
});

// ── replay / rebuild consistency ──────────────────────────────────────────────

describe('replay', () => {
  it('rebuild reconstructs the same board a live game produced', () => {
    const g = makeGame('VS_HUMAN');
    const moves = [P(7, 6), P(6, 6), P(8, 6)];
    for (const m of moves) {
      g.place(m);
      if (g.state.phase === 'CELL') g.place(frontierList(g.state.cells)[0]);
    }
    const rebuilt = rebuild(g.turns, g.draft);
    expect(Array.from(rebuilt.stones)).toEqual(Array.from(g.state.stones));
    expect(Array.from(rebuilt.cells)).toEqual(Array.from(g.state.cells));
    expect(rebuilt.currentPlayer).toBe(g.state.currentPlayer);
  });

  it('replay openLastCells leaves the last turn in CELL phase', () => {
    const turns: Turn[] = [
      { player: 1, stone: P(7, 6), cells: [] },
      { player: 2, stone: P(7, 8), cells: [] },
      { player: 1, stone: P(6, 7), cells: [frontierList(initialCells())[0]] },
    ];
    const s = replay(turns, true);
    expect(s.phase).toBe('CELL');
    expect(s.currentPlayer).toBe(1);
  });
});
