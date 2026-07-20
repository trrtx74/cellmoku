// Golden parity for the JS inference post-processing: raw torch logits + our
// legal mask must reproduce torch net.infer()'s masked-softmax policy exactly
// (to rounding), and WDL must collapse to the same scalar value.
import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/golden.json';
import { maskedSoftmax, wdlToValue } from './infer';
import { legalMask } from '../../game/obs';
import { BOARD_CELLS, type GameState, type Player } from '../../game/types';

interface Fixture {
  name: string;
  state: {
    cells: number[];
    stones: number[];
    currentPlayer: number;
    phase: number;
    remainingK: number;
    lastStonePos: number | null;
    thisTurnCells: number[];
  };
  logits: number[];
  policy: number[];
  value: number;
  wdl: number[];
}

const fixtures = golden as Fixture[];

function toState(f: Fixture): GameState {
  return {
    cells: Uint8Array.from(f.state.cells),
    stones: Uint8Array.from(f.state.stones),
    currentPlayer: f.state.currentPlayer as Player,
    phase: f.state.phase === 0 ? 'STONE' : 'CELL',
    remainingK: f.state.remainingK,
    lastStonePos: f.state.lastStonePos,
    thisTurnCells: [...f.state.thisTurnCells],
    lastCellPositions: [],
    winner: null,
    winLine: null,
  };
}

describe('golden inference post-processing parity', () => {
  for (const f of fixtures) {
    it(`maskedSoftmax reproduces net.infer policy — ${f.name}`, () => {
      const policy = maskedSoftmax(f.logits, legalMask(toState(f)));

      let sum = 0;
      let tsArgmax = 0;
      let pyArgmax = 0;
      for (let a = 0; a < BOARD_CELLS; a++) {
        sum += policy[a];
        if (policy[a] > policy[tsArgmax]) tsArgmax = a;
        if (f.policy[a] > f.policy[pyArgmax]) pyArgmax = a;
        expect(Math.abs(policy[a] - f.policy[a])).toBeLessThan(2e-4);
      }
      expect(sum).toBeCloseTo(1, 5);
      expect(tsArgmax).toBe(pyArgmax);
    });
  }

  it('wdlToValue matches win − loss for every fixture', () => {
    for (const f of fixtures) {
      expect(wdlToValue(f.wdl)).toBeCloseTo(f.value, 5);
      expect(f.wdl[0] + f.wdl[1] + f.wdl[2]).toBeCloseTo(1, 4);
    }
  });
});
