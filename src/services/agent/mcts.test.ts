// Ported invariants from py_reference/tests/test_mcts_cell.py, driven by a
// uniform fake evaluator (no network needed).
import { describe, it, expect } from 'vitest';
import { BOARD_CELLS, toPos, type GameState, type Player, type Phase } from '../../game/types';
import { initialState, applyStone, applyCell } from '../../game/engine';
import { legalMask } from '../../game/obs';
import { MCTS, MCTSNode, terminalValue, type Evaluator } from './mcts';
import { computeTurn } from './search';
import { presetFor } from './types';

const P = (r: number, c: number) => toPos(r, c);

/** Uniform policy over legal actions, value 0 — deterministic and net-free. */
const uniformEvaluator: Evaluator = {
  async evaluate(state: GameState) {
    const mask = legalMask(state);
    const policy = new Float32Array(BOARD_CELLS);
    let n = 0;
    for (let a = 0; a < BOARD_CELLS; a++) if (mask[a]) n++;
    for (let a = 0; a < BOARD_CELLS; a++) if (mask[a]) policy[a] = 1 / n;
    return { policy, value: 0 };
  },
};

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

/** A cell-phase-entry state: P1 stone adjacent to an own stone (K=1). */
function cellPhaseState(): { stonePlayer: Player; state: GameState } {
  let s = initialState();
  s = applyStone(s, P(7, 6)); // P1, K0
  s = applyStone(s, P(7, 8)); // P2, K0
  const stonePlayer = s.currentPlayer; // P1 again
  s = applyStone(s, P(6, 7)); // adjacent to (7,6) diagonally → K1 → CELL
  return { stonePlayer, state: s };
}

describe('MCTS', () => {
  it('accepts a STONE-phase root', async () => {
    const mcts = new MCTS(uniformEvaluator);
    const root = await mcts.search(initialState(), 3);
    expect(root.phase).toBe('STONE');
    expect(root.nTotal).toBe(3);
  });

  it('T1/T2: accepts a CELL-phase root whose player is the stone placer', async () => {
    const { stonePlayer, state } = cellPhaseState();
    expect(state.phase).toBe('CELL');
    expect(state.currentPlayer).toBe(stonePlayer); // §14.3 P1: no end_turn yet
    const mcts = new MCTS(uniformEvaluator);
    const root = await mcts.search(state, 3);
    expect(root.phase).toBe('CELL');
    expect(root.player).toBe(stonePlayer);
  });

  it('T4: terminal values are signed per player', () => {
    expect(terminalValue(1, 1)).toBe(1);
    expect(terminalValue(1, 2)).toBe(-1);
    expect(terminalValue(2, 2)).toBe(1);
    expect(terminalValue(2, 1)).toBe(-1);
    expect(terminalValue('DRAW', 1)).toBe(0);
  });

  it('T4: backup flips exactly at player boundaries', async () => {
    // P1 has an immediate winning stone; the winning child keeps player=P1
    // (win returns before end_turn), so its +1 must arrive at the P1 root
    // unflipped and dominate visits.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let c = 4; c < 8; c++) {
      cells[P(7, c)] = 1;
      stones[P(7, c)] = 1;
    }
    cells[P(7, 8)] = 1; // winning square
    cells[P(0, 0)] = 1; // decoy
    cells[P(0, 1)] = 1; // decoy
    const s = mkState(cells, stones, 1);

    const mcts = new MCTS(uniformEvaluator);
    const root = await mcts.search(s, 60);
    const pi = root.visitPolicy(0);
    let best = 0;
    for (let a = 1; a < BOARD_CELLS; a++) if (pi[a] > pi[best]) best = a;
    expect(best).toBe(P(7, 8)); // search converges on the win
    expect(root.qValue(P(7, 8))).toBeCloseTo(1, 5);
    expect(root.children.get(P(7, 8))!.player).toBe(1); // winner keeps the node
  });

  it('visitPolicy sums to 1 (temp>0) and is one-hot (temp=0)', async () => {
    const mcts = new MCTS(uniformEvaluator);
    const root = await mcts.search(initialState(), 10);
    const soft = root.visitPolicy(1);
    expect(Array.from(soft).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    const hard = root.visitPolicy(0);
    expect(Array.from(hard).filter((x) => x > 0)).toEqual([1]);
  });
});

describe('computeTurn', () => {
  const cfg = { ...presetFor('medium'), sims: 24, cellSims: 8 };

  it('returns a legal stone plus all earned cells', async () => {
    let s = initialState();
    s = applyStone(s, P(7, 6));
    s = applyStone(s, P(7, 8));
    // P1 to move; adjacent placements may earn cells
    const move = await computeTurn(s, { ...cfg, useVcf: false }, uniformEvaluator, () => 0.42);
    expect(s.cells[move.stone]).toBe(1);
    expect(s.stones[move.stone]).toBe(0);
    // replay the move to confirm full legality and cell-count match
    let s2 = applyStone(s, move.stone);
    for (const c of move.cells) {
      expect(s2.phase).toBe('CELL');
      expect(s2.cells[c]).toBe(0); // must be empty before placing
      s2 = applyCell(s2, c);
    }
    expect(s2.phase).toBe('STONE'); // turn fully consumed
  });

  it('VCF override: plays the forced win without search', async () => {
    // Immediate 5-completion available → vcfScan tempo-0 must fire.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let c = 4; c < 8; c++) {
      cells[P(7, c)] = 1;
      stones[P(7, c)] = 1;
    }
    cells[P(7, 8)] = 1;
    cells[P(0, 0)] = 1;
    const s = mkState(cells, stones, 1);

    let evals = 0;
    const countingEvaluator: Evaluator = {
      async evaluate(st) {
        evals++;
        return uniformEvaluator.evaluate(st);
      },
    };
    const move = await computeTurn(
      s,
      { ...cfg, useVcf: true, vcfMaxPly: 2 },
      countingEvaluator,
    );
    expect(move.stone).toBe(P(7, 8));
    expect(move.cells).toEqual([]);
    expect(evals).toBe(0); // MCTS fully skipped
  });

  it('greedy after tempMoves: deterministic stone choice', async () => {
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let c = 4; c < 8; c++) {
      cells[P(7, c)] = 1;
      stones[P(7, c)] = 1; // 4 stones on board ≥ tempMoves=0 → greedy
    }
    cells[P(7, 8)] = 1;
    cells[P(0, 0)] = 1;
    const s = mkState(cells, stones, 1);
    const move = await computeTurn(
      s,
      { ...cfg, useVcf: false, tempMoves: 0, sims: 60 },
      uniformEvaluator,
      () => 0.999, // would sample the tail if a distribution leaked through
    );
    expect(move.stone).toBe(P(7, 8)); // one-hot visit policy → the winning move
  });
});

describe('MCTSNode', () => {
  it('PUCT prefers unvisited high-prior actions as visits accumulate', () => {
    const n = new MCTSNode(1, 'STONE');
    n.P.set(0, 0.9);
    n.P.set(1, 0.1);
    n.N.set(0, 10);
    n.N.set(1, 0);
    n.W.set(0, 2);
    n.W.set(1, 0);
    n.nTotal = 10;
    // action 0: q=0.2 + 1.5*0.9*sqrt(10)/11 ≈ 0.588
    // action 1: q=0   + 1.5*0.1*sqrt(10)/1  ≈ 0.474
    expect(n.selectAction(1.5)).toBe(0);
    n.N.set(0, 100);
    n.nTotal = 100;
    n.W.set(0, 5); // q drops to 0.05, exploration term shrinks
    expect(n.selectAction(1.5)).toBe(1);
  });
});
