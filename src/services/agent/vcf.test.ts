// Ported from py_reference/tests/test_vcf.py (positions re-hosted on the fixed
// 15×15 board — threat semantics are board-size independent for these shapes).
import { describe, it, expect } from 'vitest';
import { BOARD_CELLS, toPos, type GameState, type Player, type Phase } from '../../game/types';
import { checkWin, frontierMask } from '../../game/rules';
import { applyCell } from '../../game/engine';
import {
  winsAt,
  completionCells,
  hasImmediateCompletion,
  opensOpponentThreat,
  anyDefenseWinsForOpp,
  evalAfterMyTurn,
  proveMyTurn,
  isHardProvedWin,
  forcedBlock,
  safeCellMask,
  vcfScan,
} from './vcf';

const P = (r: number, c: number) => toPos(r, c);

function blank(): { cells: Uint8Array; stones: Uint8Array } {
  return { cells: new Uint8Array(BOARD_CELLS), stones: new Uint8Array(BOARD_CELLS) };
}

/** Set a horizontal run cells[r, c0:c1) with optional stones. */
function line(
  cells: Uint8Array,
  stones: Uint8Array,
  r: number,
  c0: number,
  c1: number,
  player: 0 | Player = 0,
) {
  for (let c = c0; c < c1; c++) {
    cells[P(r, c)] = 1;
    if (player) stones[P(r, c)] = player;
  }
}

function mkState(
  cells: Uint8Array,
  stones: Uint8Array,
  currentPlayer: Player,
  phase: Phase = 'STONE',
  remainingK = 0,
): GameState {
  return {
    cells, stones, currentPlayer, phase, remainingK,
    lastStonePos: null, thisTurnCells: [], lastCellPositions: [],
    winner: null, winLine: null,
  };
}

// ── T-EQ: winsAt == rules.checkWin ────────────────────────────────────────────

describe('winsAt equivalence', () => {
  it('matches checkWin on random boards', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 300; t++) {
      const stones = new Uint8Array(BOARD_CELLS);
      for (let i = 0; i < BOARD_CELLS; i++) stones[i] = Math.floor(rand() * 3);
      const pos = Math.floor(rand() * BOARD_CELLS);
      const player = (1 + Math.floor(rand() * 2)) as Player;
      stones[pos] = player;
      expect(winsAt(stones, pos, player)).toBe(checkWin(stones, pos, player) !== null);
    }
  });

  it('counts overline (6) as a win', () => {
    const { stones } = blank();
    for (let c = 0; c < 6; c++) stones[P(4, c)] = 1;
    expect(winsAt(stones, P(4, 3), 1)).toBe(true);
  });
});

// ── T-COMP: completion-cell detection ────────────────────────────────────────

describe('completionCells', () => {
  it('XXXX_ : trailing empty real cell is a completion cell', () => {
    const { cells, stones } = blank();
    line(cells, stones, 4, 0, 4, 1);
    cells[P(4, 4)] = 1; // empty real cell
    expect(completionCells(cells, stones, 1)).toEqual(new Set([P(4, 4)]));
  });

  it('XX_XX : middle empty cell is a completion cell', () => {
    const { cells, stones } = blank();
    stones[P(4, 0)] = stones[P(4, 1)] = 1;
    stones[P(4, 3)] = stones[P(4, 4)] = 1;
    for (let c = 0; c < 5; c++) cells[P(4, c)] = 1; // (4,2) empty
    expect(completionCells(cells, stones, 1).has(P(4, 2))).toBe(true);
  });

  it('a completing square that is a hole is NOT a threat', () => {
    const { cells, stones } = blank();
    line(cells, stones, 4, 0, 4, 1);
    // (4,4) stays a hole
    expect(completionCells(cells, stones, 1).has(P(4, 4))).toBe(false);
  });

  it('one move completing two lines counts once', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; }
    for (let r = 0; r < 4; r++) { stones[P(r, 4)] = 1; cells[P(r, 4)] = 1; }
    cells[P(4, 4)] = 1; // empty real cross square
    expect(completionCells(cells, stones, 1)).toEqual(new Set([P(4, 4)]));
  });

  it('two distinct completion squares -> size >= 2', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(2, c)] = 1; cells[P(2, c)] = 1; }
    cells[P(2, 4)] = 1;
    for (let c = 0; c < 4; c++) { stones[P(6, c)] = 1; cells[P(6, c)] = 1; }
    cells[P(6, 4)] = 1;
    expect(completionCells(cells, stones, 1)).toEqual(new Set([P(2, 4), P(6, 4)]));
  });

  it('excluding a square drops the completion that depends on it', () => {
    const { cells, stones } = blank();
    line(cells, stones, 4, 0, 4, 1);
    cells[P(4, 4)] = 1;
    expect(completionCells(cells, stones, 1).has(P(4, 4))).toBe(true);
    expect(
      completionCells(cells, stones, 1, new Set([P(4, 4)])).has(P(4, 4)),
    ).toBe(false);
  });
});

// ── immediate completion / hand-off / counter-attack ─────────────────────────

describe('threat predicates', () => {
  it('hasImmediateCompletion true with an open four', () => {
    const { cells, stones } = blank();
    line(cells, stones, 4, 0, 4, 2);
    cells[P(4, 4)] = 1;
    expect(hasImmediateCompletion(cells, stones, 2)).toBe(true);
  });

  it('hasImmediateCompletion false with only three', () => {
    const { cells, stones } = blank();
    line(cells, stones, 4, 0, 3, 2);
    cells[P(4, 3)] = 1;
    expect(hasImmediateCompletion(cells, stones, 2)).toBe(false);
  });

  it('filling a hole that becomes the opponent completion square = hand-off', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(4, c)] = 2; cells[P(4, c)] = 1; }
    const before = completionCells(cells, stones, 2);
    expect(before.size).toBe(0); // hole -> no threat yet
    expect(opensOpponentThreat(cells, stones, P(4, 4), 2, before)).toBe(true);
  });

  it('does not flag a cell that opens nothing for the opponent', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; } // my stones
    const before = completionCells(cells, stones, 2);
    expect(opensOpponentThreat(cells, stones, P(4, 4), 2, before)).toBe(false);
  });

  it('cross square: blocking my completion wins for the opponent', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; }
    for (let r = 0; r < 4; r++) { stones[P(r, 4)] = 2; cells[P(r, 4)] = 1; }
    cells[P(4, 4)] = 1;
    const myComp = completionCells(cells, stones, 1);
    expect(myComp.has(P(4, 4))).toBe(true);
    expect(anyDefenseWinsForOpp(cells, stones, myComp, 2)).toBe(true);
  });

  it('safe defense: no counter-attack', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; }
    cells[P(4, 4)] = 1;
    const myComp = completionCells(cells, stones, 1);
    expect(anyDefenseWinsForOpp(cells, stones, myComp, 2)).toBe(false);
  });
});

// ── prove / classify / scan ───────────────────────────────────────────────────

/** Cross double-threat STONE position: placing at (4,4) creates a double threat. */
function crossDoubleThreat(player: Player): GameState {
  const { cells, stones } = blank();
  for (const c of [1, 2, 3]) { stones[P(4, c)] = player; cells[P(4, c)] = 1; }
  for (const r of [1, 2, 3]) { stones[P(r, 4)] = player; cells[P(r, 4)] = 1; }
  cells[P(4, 4)] = 1; // the placing square (cross)
  cells[P(4, 5)] = 1; // horizontal completion square
  cells[P(5, 4)] = 1; // vertical completion square
  for (const [r, c] of [[0, 0], [0, 1], [1, 0], [8, 8], [8, 7], [7, 8]]) {
    cells[P(r, c)] = 1; // neutral spots for K cells
  }
  return mkState(cells, stones, player);
}

describe('proveMyTurn', () => {
  it('finds the double-threat stone (P1)', () => {
    expect(proveMyTurn(crossDoubleThreat(1), 2)).toBe(P(4, 4));
  });

  it('sign symmetry: same shape proves for P2', () => {
    expect(proveMyTurn(crossDoubleThreat(2), 2)).toBe(P(4, 4));
  });

  it('opening position has no forced threat', () => {
    const cells = new Uint8Array(BOARD_CELLS);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) cells[P(7 + dr, 7 + dc)] = 1;
    const s = mkState(cells, new Uint8Array(BOARD_CELLS), 1);
    expect(proveMyTurn(s, 2)).toBeNull();
  });

  it('depth<=0 short-circuits', () => {
    expect(proveMyTurn(crossDoubleThreat(1), 0)).toBeNull();
  });

  it('does not mutate the input state', () => {
    const s = crossDoubleThreat(1);
    const cellsBefore = s.cells.slice();
    const stonesBefore = s.stones.slice();
    proveMyTurn(s, 2);
    expect(s.cells).toEqual(cellsBefore);
    expect(s.stones).toEqual(stonesBefore);
  });
});

describe('evalAfterMyTurn', () => {
  it('opponent immediate completion defers (returns false)', () => {
    const { cells, stones } = blank();
    for (let c = 0; c < 4; c++) { stones[P(2, c)] = 2; cells[P(2, c)] = 1; }
    cells[P(2, 4)] = 1;
    cells[P(8, 8)] = 1; // spare legal square
    const s = mkState(cells, stones, 2); // currentPlayer = opp(2)
    expect(evalAfterMyTurn(s, 1, 2)).toBe(false);
  });

  it('worst case: completions resting on neutral cells are discounted', () => {
    const { cells, stones } = blank();
    for (const r of [4, 6]) {
      for (const c of [1, 2, 3, 4]) { stones[P(r, c)] = 1; cells[P(r, c)] = 1; }
      cells[P(r, 5)] = 1; // completion square
    }
    cells[P(8, 8)] = 1; // spare legal square for the opponent
    const s = mkState(cells, stones, 2); // opp to move; P1 is the attacker

    // both completion squares count -> double threat -> forced win
    expect(evalAfterMyTurn(s, 1, 2)).toBe(true);
    // ...but a proof may not lean on squares the attacker only placed neutrally
    expect(evalAfterMyTurn(s, 1, 2, new Set([P(4, 5), P(6, 5)]))).toBe(false);
  });
});

describe('forcedBlock', () => {
  /** P2 has four in a row; only (7,8) completes it (col 3 is not a cell). */
  const oppOpenFour = (extraCells: Array<[number, number]> = []) => {
    const { cells, stones } = blank();
    for (let c = 4; c <= 10; c++) cells[P(7, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2;
    cells[P(9, 9)] = 1;
    cells[P(9, 10)] = 1;
    for (const [r, c] of extraCells) cells[P(r, c)] = 1;
    return { cells, stones };
  };

  it('returns the threat square when the opponent completes 5 next turn', () => {
    const { cells, stones } = oppOpenFour();
    expect(forcedBlock(mkState(cells, stones, 1))).toBe(P(7, 8));
  });

  it('returns null when there is no threat', () => {
    const { cells, stones } = blank();
    for (let c = 4; c <= 10; c++) cells[P(7, c)] = 1;
    for (let c = 4; c < 7; c++) stones[P(7, c)] = 2; // only three
    expect(forcedBlock(mkState(cells, stones, 1))).toBeNull();
  });

  it('defers to our own win — attacking beats defending', () => {
    const { cells, stones } = oppOpenFour();
    // give P1 its own immediate completion at (9,8)
    for (let c = 4; c < 8; c++) { cells[P(9, c)] = 1; stones[P(9, c)] = 1; }
    cells[P(9, 8)] = 1;
    const s = mkState(cells, stones, 1);
    expect(completionCells(s.cells, s.stones, 1).size).toBeGreaterThan(0);
    expect(forcedBlock(s)).toBeNull();
    // vcfScan takes the win instead
    expect(vcfScan(s, 2)).toEqual([P(9, 8)]);
  });

  it('is not gated by the offensive prefilter (defends with few own stones)', () => {
    // mover has 0 stones — vcfScan bails on prefilter, defence must not
    const { cells, stones } = oppOpenFour();
    const s = mkState(cells, stones, 1);
    expect(vcfScan(s, 2)).toBeNull();
    expect(forcedBlock(s)).toBe(P(7, 8));
  });

  it('blocking removes exactly the blocked square from the threat set', () => {
    // both ends open -> two threats; we are lost, but the invariant must hold
    const { cells, stones } = blank();
    for (let c = 2; c <= 10; c++) cells[P(7, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2;
    const s = mkState(cells, stones, 1);
    const threats = completionCells(s.cells, s.stones, 2);
    expect(threats).toEqual(new Set([P(7, 3), P(7, 8)]));

    const chosen = forcedBlock(s)!;
    expect(threats.has(chosen)).toBe(true);
    const after = s.stones.slice();
    after[chosen] = 1;
    const remaining = completionCells(s.cells, after, 2);
    expect(remaining).toEqual(new Set([...threats].filter((t) => t !== chosen)));
  });

  it('only applies at stone phase', () => {
    const { cells, stones } = oppOpenFour();
    expect(forcedBlock(mkState(cells, stones, 1, 'CELL', 1))).toBeNull();
  });
});

describe('safeCellMask', () => {
  /** Opponent has four in a row whose completing square (7,8) is still a HOLE:
   *  turning it into a cell would hand them the win. */
  const nearMiss = () => {
    const { cells, stones } = blank();
    for (let r = 6; r <= 8; r++) for (let c = 4; c <= 7; c++) cells[P(r, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2;
    return mkState(cells, stones, 1, 'CELL', 1);
  };

  it('excludes a cell that would open a five for the opponent', () => {
    const s = nearMiss();
    const legal = frontierMask(s.cells);
    expect(legal[P(7, 8)]).toBe(1); // it is a legal placement...
    expect(completionCells(s.cells, s.stones, 2).size).toBe(0); // ...and no threat yet

    const safe = safeCellMask(s, legal)!;
    expect(safe).not.toBeNull();
    expect(safe[P(7, 8)]).toBe(0); // screened out
    expect(safe[P(5, 5)]).toBe(1); // a harmless placement survives

    // placing it really would create the threat
    const opened = applyCell(s, P(7, 8));
    expect(completionCells(opened.cells, opened.stones, 2).has(P(7, 8))).toBe(true);
  });

  it('returns null when the opponent cannot complete five at all', () => {
    const { cells, stones } = blank();
    for (let r = 6; r <= 8; r++) for (let c = 4; c <= 7; c++) cells[P(r, c)] = 1;
    for (let c = 4; c < 6; c++) stones[P(7, c)] = 2; // only two stones
    const s = mkState(cells, stones, 1, 'CELL', 1);
    expect(safeCellMask(s, frontierMask(s.cells))).toBeNull();
  });
});

describe('defence outranks a multi-turn win', () => {
  /** P1 can force a win in 2 plies via the cross square (4,4); optionally P2
   *  also has an immediate five at (10,8), which lands first. */
  const build = (withOppThreat: boolean): GameState => {
    const { cells, stones } = blank();
    for (const c of [1, 2, 3]) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; }
    for (const r of [1, 2, 3]) { stones[P(r, 4)] = 1; cells[P(r, 4)] = 1; }
    cells[P(4, 4)] = 1; // double-threat square
    cells[P(4, 5)] = 1;
    cells[P(5, 4)] = 1;
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [8, 8], [8, 7], [7, 8]]) {
      cells[P(r, c)] = 1; // neutral room for earned cells
    }
    if (withOppThreat) {
      for (let c = 4; c < 8; c++) { stones[P(10, c)] = 2; cells[P(10, c)] = 1; }
      cells[P(10, 8)] = 1; // sole completion — (10,3) stays a hole
    }
    return mkState(cells, stones, 1);
  };

  it('takes the 2-ply forced win when nothing is threatening us', () => {
    const s = build(false);
    expect(isHardProvedWin(s, P(4, 4), 2)).toBe(true);
    expect(vcfScan(s, 2)![0]).toBe(P(4, 4));
    expect(forcedBlock(s)).toBeNull();
  });

  it('abandons that win once the opponent completes five first', () => {
    const s = build(true);
    expect(completionCells(s.cells, s.stones, 2)).toEqual(new Set([P(10, 8)]));
    // the winning move no longer proves: the opponent lands first
    expect(isHardProvedWin(s, P(4, 4), 2)).toBe(false);
    expect(vcfScan(s, 2)).toBeNull();
    // ...so the block is what gets played
    expect(forcedBlock(s)).toBe(P(10, 8));
  });
});

describe('isHardProvedWin / vcfScan', () => {
  it('cross double-threat stone is a proved win', () => {
    expect(isHardProvedWin(crossDoubleThreat(1), P(4, 4), 2)).toBe(true);
  });

  it('tempo-0 regression: scan plays the immediate win, not a preserving move', () => {
    const { cells, stones } = blank();
    for (const r of [4, 6]) {
      line(cells, stones, r, 2, 6, 1); // cols 2..5 = X
      cells[P(r, 1)] = 1; // completion cell (empty)
      cells[P(r, 6)] = 1; stones[P(r, 6)] = 2; // O blocks the right end
    }
    cells[P(0, 0)] = 1; // row-major-first 'nothing' cell
    const s = mkState(cells, stones, 1);

    const comp = completionCells(s.cells, s.stones, 1);
    expect(comp).toEqual(new Set([P(4, 1), P(6, 1)]));

    // the nothing-move ALSO proves — ordering is exactly what's under test
    expect(isHardProvedWin(s, 0, 2)).toBe(true);

    const seq = vcfScan(s, 2);
    expect(seq).not.toBeNull();
    expect(seq).toHaveLength(1);
    expect(comp.has(seq![0])).toBe(true);
    expect(seq![0]).not.toBe(0);
  });

  it('scan returns the full [stone, ...cells] sequence', () => {
    const s = crossDoubleThreat(1);
    const seq = vcfScan(s, 2);
    expect(seq).not.toBeNull();
    expect(seq![0]).toBe(P(4, 4));
    expect(seq!.length).toBeGreaterThan(1); // the proving stone earns K=2 cells
  });

  it('prefilter skips sparse boards (opening)', () => {
    const cells = new Uint8Array(BOARD_CELLS);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) cells[P(7 + dr, 7 + dc)] = 1;
    const s = mkState(cells, new Uint8Array(BOARD_CELLS), 1);
    expect(vcfScan(s, 2)).toBeNull();
  });
});
