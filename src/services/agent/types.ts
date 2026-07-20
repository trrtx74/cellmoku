import type { GameState, Pos } from '../../game/types';
import type { Difficulty } from '../../store/useGameStore';

/** A full CPU turn: the stone plus the earned cells, in placement order. */
export interface AgentMove {
  stone: Pos;
  cells: Pos[];
}

/**
 * Tunable search parameters. The real engine (MCTS + VCF) will consume all of
 * these; the mock only uses `temperature`. Every field is adjustable live from
 * the debug panel (?debug=1) so difficulty numbers can be dialed in by testing.
 */
export interface AgentConfig {
  sims: number; // stone-root MCTS simulations
  cellSims: number; // cell-root MCTS simulations
  temperature: number; // stone-choice sampling temperature
  tempMoves: number; // stones on board after which the stone choice turns greedy
  /**
   * Cell-placement sampling temperature — a difficulty knob independent of
   * `temperature`. 0 = greedy, matching evaluate.py's play path.
   */
  cellTemperature: number;
  /**
   * Stones on board after which cell placement turns greedy — the cell-side
   * counterpart to `tempMoves`. Both gates read the same board snapshot (the
   * stone count at the start of the turn) so the two are on one scale.
   * Note `cellTemperature` only bites while this gate is open.
   */
  cellTempMoves: number;
  useVcf: boolean; // enable VCF hard-proof override
  vcfMaxPly: number; // VCF search depth
}

export interface CellmokuAgent {
  /** Resolves when the model/engine is ready (instant for the mock). */
  ready: Promise<void>;
  /** Compute a full turn for the current (CPU) player. `state` is at STONE phase. */
  getMove(state: GameState, config: AgentConfig): Promise<AgentMove>;
}

// Difficulty presets — tuned by playtesting via the debug panel (?debug=1).
//
// Latency reference (measured): one forward is ~9 ms native single-thread, so
// roughly ~20-25 ms under the single-threaded SIMD wasm we run on GitHub Pages.
// A turn costs about (sims + cellSims) forwards — ~1.5 s at sims=cellSims=32,
// ~6 s at 128. This runs in a worker, so it delays the CPU's reply without
// freezing the UI.
export const PRESETS: Record<Difficulty, AgentConfig> = {
  easy: { sims: 32, cellSims: 32, temperature: 0.0, tempMoves: 0, cellTemperature: 0.0, cellTempMoves: 0, useVcf: true, vcfMaxPly: 2 },
  medium: { sims: 64, cellSims: 64, temperature: 0.0, tempMoves: 0, cellTemperature: 0.0, cellTempMoves: 0, useVcf: true, vcfMaxPly: 2 },
  hard: { sims: 128, cellSims: 128, temperature: 0.0, tempMoves: 0, cellTemperature: 0.0, cellTempMoves: 0, useVcf: true, vcfMaxPly: 2 },
};

export const presetFor = (d: Difficulty): AgentConfig => ({ ...PRESETS[d] });
