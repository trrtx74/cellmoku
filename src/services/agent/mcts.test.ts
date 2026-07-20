// Ported invariants from py_reference/tests/test_mcts_cell.py, driven by a
// uniform fake evaluator (no network needed).
import { describe, it, expect } from 'vitest';
import { BOARD_CELLS, toPos, type GameState, type Player, type Phase } from '../../game/types';
import { initialState, applyStone, applyCell } from '../../game/engine';
import { legalMask } from '../../game/obs';
import { MCTS, MCTSNode, terminalValue, type Evaluator } from './mcts';
import { completionCells } from './vcf';
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

  it('VCF override wins even when the network actively avoids the winning move', async () => {
    // P1 has four in a row; (7,8) completes it. The evaluator pushes all mass
    // away from (7,8), so only the VCF override can produce the winning move.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let c = 4; c < 8; c++) {
      cells[P(7, c)] = 1;
      stones[P(7, c)] = 1;
    }
    cells[P(7, 8)] = 1; // the winning square
    cells[P(0, 0)] = 1;
    cells[P(0, 1)] = 1;
    const s = mkState(cells, stones, 1);

    const hostile: Evaluator = {
      async evaluate(st) {
        const mask = legalMask(st);
        const policy = new Float32Array(BOARD_CELLS);
        let n = 0;
        for (let a = 0; a < BOARD_CELLS; a++) if (mask[a] && a !== P(7, 8)) n++;
        for (let a = 0; a < BOARD_CELLS; a++) {
          if (mask[a] && a !== P(7, 8)) policy[a] = 1 / n; // zero mass on the win
        }
        return { policy, value: 0 };
      },
    };

    const withVcf = await computeTurn(
      s, { ...cfg, useVcf: true, vcfMaxPly: 2 }, hostile,
    );
    expect(withVcf.stone).toBe(P(7, 8));

    // ...and with VCF disabled the hostile policy can steer it elsewhere,
    // which is exactly why the override exists.
    const withoutVcf = await computeTurn(
      s, { ...cfg, useVcf: false, sims: 4 }, hostile,
    );
    expect(withoutVcf.stone).not.toBe(P(7, 8));
  });

  it('picks the first proved candidate when several prove (order preserved)', async () => {
    // Two immediate wins: (4,1) and (6,1). vcfScan must return the lower index,
    // matching the pre-cleanup behaviour of taking the first HARD grade.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (const r of [4, 6]) {
      for (let c = 2; c < 6; c++) {
        cells[P(r, c)] = 1;
        stones[P(r, c)] = 1;
      }
      cells[P(r, 1)] = 1;
      cells[P(r, 6)] = 1;
      stones[P(r, 6)] = 2;
    }
    const s = mkState(cells, stones, 1);
    const move = await computeTurn(s, { ...cfg, useVcf: true, vcfMaxPly: 2 }, uniformEvaluator);
    expect(move.stone).toBe(P(4, 1));
    expect(move.cells).toEqual([]); // winning stone ends the game — no cell phase
  });

  it('blocks the opponent 5-threat regardless of temperature sampling', async () => {
    // Regression: the block used to go through the visit distribution, so with
    // temperature > 0 a non-blocking move got sampled (~44% of the time against
    // the real net at temperature 1.0).
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let r = 4; r <= 10; r++) for (let c = 4; c <= 10; c++) cells[P(r, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2; // P2 four in a row
    for (const [r, c] of [[5, 5], [6, 6], [9, 9], [8, 5]]) stones[P(r, c)] = 1;
    const s = mkState(cells, stones, 1);
    const block = P(7, 8);

    const hot = { ...cfg, useVcf: true, temperature: 1, tempMoves: 99 };
    // sweep the whole sampling range — no draw may steer off the block, and the
    // cell placements must stay identical too (cells are never sampled)
    let firstCells: number[] | null = null;
    for (const r of [0, 0.05, 0.3, 0.5, 0.77, 0.999]) {
      const move = await computeTurn(s, hot, uniformEvaluator, () => r);
      expect(move.stone).toBe(block);
      if (firstCells === null) firstCells = move.cells;
      else expect(move.cells).toEqual(firstCells);
    }

    // without the rule-based layer the same hot config can wander off it
    const loose = await computeTurn(
      s, { ...hot, useVcf: false, sims: 8 }, uniformEvaluator, () => 0.999,
    );
    expect(loose.stone).not.toBe(block);
  });

  it('end-to-end: defends instead of chasing its own 2-ply win', async () => {
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (const c of [1, 2, 3]) { stones[P(4, c)] = 1; cells[P(4, c)] = 1; }
    for (const r of [1, 2, 3]) { stones[P(r, 4)] = 1; cells[P(r, 4)] = 1; }
    for (const [r, c] of [[4, 4], [4, 5], [5, 4], [0, 0], [0, 1], [1, 0], [8, 8]]) {
      cells[P(r, c)] = 1;
    }
    for (let c = 4; c < 8; c++) { stones[P(10, c)] = 2; cells[P(10, c)] = 1; }
    cells[P(10, 8)] = 1; // opponent's sole completion square
    const s = mkState(cells, stones, 1);

    const move = await computeTurn(
      s, { ...cfg, useVcf: true, vcfMaxPly: 2 }, uniformEvaluator,
    );
    expect(move.stone).toBe(P(10, 8)); // block, not the double-threat square
    expect(move.stone).not.toBe(P(4, 4));
  });

  it('cellTemperature varies cell placement; 0 stays deterministic', async () => {
    // P1 stone at (6,6) sits next to its own (6,5) -> K=1, so exactly one cell
    // is placed and the draw fully determines it.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let r = 5; r <= 8; r++) for (let c = 4; c <= 8; c++) cells[P(r, c)] = 1;
    stones[P(6, 5)] = 1;
    stones[P(8, 8)] = 2;
    const s = mkState(cells, stones, 1);

    const pick = (cellTemperature: number, r: number, cellTempMoves = 99) =>
      computeTurn(
        s,
        { ...cfg, useVcf: false, cellTemperature, cellTempMoves, cellSims: 0 },
        uniformEvaluator,
        () => r,
      );

    // temp 0 -> identical regardless of the draw
    const g1 = await pick(0, 0.05);
    const g2 = await pick(0, 0.95);
    expect(g1.cells).toEqual(g2.cells);

    // temp > 0 -> the draw moves the placement
    const seen = new Set<string>();
    for (const r of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      seen.add(JSON.stringify((await pick(1, r)).cells));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('cellTempMoves gates cell temperature by stones on board', async () => {
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let r = 5; r <= 8; r++) for (let c = 4; c <= 8; c++) cells[P(r, c)] = 1;
    stones[P(6, 5)] = 1;
    stones[P(8, 8)] = 2;
    const s = mkState(cells, stones, 1); // exactly 2 stones on board

    const run = (cellTempMoves: number, r: number) =>
      computeTurn(
        s,
        { ...cfg, useVcf: false, cellTemperature: 1, cellTempMoves, cellSims: 0 },
        uniformEvaluator,
        () => r,
      );

    // gate open (2 < 99): the draw still matters
    const open = new Set<string>();
    for (const r of [0.05, 0.5, 0.95]) open.add(JSON.stringify((await run(99, r)).cells));
    expect(open.size).toBeGreaterThan(1);

    // gate shut once the board reaches the threshold (2 < 2 is false)
    const shut = new Set<string>();
    for (const r of [0.05, 0.5, 0.95]) shut.add(JSON.stringify((await run(2, r)).cells));
    expect(shut.size).toBe(1);

    // ...and the default of 0 keeps cells greedy no matter the temperature
    const off = new Set<string>();
    for (const r of [0.05, 0.5, 0.95]) off.add(JSON.stringify((await run(0, r)).cells));
    expect(off.size).toBe(1);
  });

  it('sampled cells never hand the opponent a five', async () => {
    // (7,8) is a hole completing P2's four — placing a cell there loses.
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let r = 6; r <= 8; r++) for (let c = 4; c <= 7; c++) cells[P(r, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2;
    stones[P(6, 5)] = 1;
    const s = mkState(cells, stones, 1);

    // a policy that actively wants the losing cell
    const wantsTheHole: Evaluator = {
      async evaluate(st) {
        const mask = legalMask(st);
        const policy = new Float32Array(BOARD_CELLS);
        if (mask[P(7, 8)]) policy[P(7, 8)] = 1;
        else for (let a = 0; a < BOARD_CELLS; a++) if (mask[a]) policy[a] = 1;
        return { policy, value: 0 };
      },
    };

    for (const r of [0.01, 0.3, 0.6, 0.99]) {
      const move = await computeTurn(
        s,
        { ...cfg, useVcf: true, cellTemperature: 1.5, cellTempMoves: 99, cellSims: 0 },
        wantsTheHole,
        () => r,
      );
      expect(move.cells).not.toContain(P(7, 8));
      // replay the turn: the opponent must still have no completion
      let after = applyStone(s, move.stone);
      for (const c of move.cells) after = applyCell(after, c);
      expect(completionCells(after.cells, after.stones, 2).size).toBe(0);
    }
  });

  it('end-to-end: takes our own five over blocking theirs', async () => {
    const cells = new Uint8Array(BOARD_CELLS);
    const stones = new Uint8Array(BOARD_CELLS);
    for (let c = 4; c <= 10; c++) cells[P(7, c)] = 1;
    for (let c = 4; c < 8; c++) stones[P(7, c)] = 2; // P2 threatens at (7,8)
    for (let c = 4; c < 8; c++) { cells[P(9, c)] = 1; stones[P(9, c)] = 1; }
    cells[P(9, 8)] = 1; // P1 completes at (9,8)
    const s = mkState(cells, stones, 1);

    const move = await computeTurn(
      s, { ...cfg, useVcf: true, vcfMaxPly: 2 }, uniformEvaluator,
    );
    expect(move.stone).toBe(P(9, 8)); // win now
    expect(move.stone).not.toBe(P(7, 8)); // not the block
    expect(applyStone(s, move.stone).winner).toBe(1);
  });

  it('never returns an illegal stone when the rng yields exactly 0', async () => {
    // Regression: sampling walked zero-mass entries, so rng()===0 handed back
    // action 0 (a hole on a fresh board) instead of the sampled legal move.
    let s = initialState();
    s = applyStone(s, P(7, 6));
    s = applyStone(s, P(7, 8));
    const move = await computeTurn(
      s, { ...cfg, useVcf: false, temperature: 1, tempMoves: 99 }, uniformEvaluator,
      () => 0,
    );
    expect(s.cells[move.stone]).toBe(1);
    expect(s.stones[move.stone]).toBe(0);
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
