// Full-turn move selection — evaluate.py `play_eval_game_gen` pattern plus the
// selfplay VCF hard-proof override. Pure orchestration over an Evaluator, so it
// is unit-testable without onnxruntime.
import { BOARD_CELLS, type GameState, type Pos } from '../../game/types';
import { applyStone, applyCell } from '../../game/engine';
import { legalMask } from '../../game/obs';
import { MCTS, type Evaluator } from './mcts';
import { vcfScan, forcedBlock, safeCellMask } from './vcf';
import type { AgentConfig, AgentMove } from './types';

/** Sample an action from a distribution over BOARD_CELLS (np.random.choice). */
function sampleFrom(policy: Float32Array, rng: () => number = Math.random): Pos {
  let r = rng();
  for (let a = 0; a < BOARD_CELLS; a++) {
    // Skip zero-mass (illegal) actions: with r === 0 the `r <= 0` test below
    // would otherwise hand back the first index regardless of its legality.
    if (policy[a] <= 0) continue;
    r -= policy[a];
    if (r <= 0) return a;
  }
  // numerical remainder: last action with mass
  for (let a = BOARD_CELLS - 1; a >= 0; a--) if (policy[a] > 0) return a;
  return 0;
}

/** evaluate.py cell pick: argmax(policy * mask), fallback to the first allowed. */
function pickMasked(policy: Float32Array, mask: Uint8Array): Pos {
  let best = -1;
  let bestVal = 0;
  let first = -1;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (!mask[a]) continue;
    if (first < 0) first = a;
    if (policy[a] > bestVal) {
      bestVal = policy[a];
      best = a;
    }
  }
  return best >= 0 && bestVal > 1e-12 ? best : first;
}

/** Sample from `policy` restricted to `mask` (renormalised over the allowed set). */
function sampleMasked(policy: Float32Array, mask: Uint8Array, rng: () => number): Pos {
  let total = 0;
  for (let a = 0; a < BOARD_CELLS; a++) if (mask[a]) total += policy[a];
  if (total <= 1e-12) return pickMasked(policy, mask); // no mass here — take the fallback
  let r = rng() * total;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (!mask[a] || policy[a] <= 0) continue;
    r -= policy[a];
    if (r <= 0) return a;
  }
  for (let a = BOARD_CELLS - 1; a >= 0; a--) if (mask[a] && policy[a] > 0) return a;
  return pickMasked(policy, mask);
}

function countStones(s: GameState): number {
  let n = 0;
  for (let i = 0; i < BOARD_CELLS; i++) if (s.stones[i] !== 0) n++;
  return n;
}

/**
 * Compute a full CPU turn from a STONE-phase state.
 *
 * 1. VCF hard-proof override (whole-turn sequence, MCTS skipped) when enabled.
 * 2. Stone MCTS (`sims`) → temperature sampling (config.temperature while
 *    stones-on-board < tempMoves, greedy after) — evaluate.py schedule with the
 *    difficulty temperature knob folded in.
 * 3. Dedicated cell-phase MCTS (`cellSims`) rooted after the stone; greedy walk
 *    down the tree, net-prior fallback on unexplored nodes.
 */
export async function computeTurn(
  state: GameState,
  config: AgentConfig,
  evaluator: Evaluator,
  rng: () => number = Math.random,
): Promise<AgentMove> {
  if (state.phase !== 'STONE' || state.winner !== null) {
    throw new Error('computeTurn expects an ongoing STONE-phase state');
  }

  // ── VCF override (§9.2): a hard-proved forced win plays out the whole turn ──
  if (config.useVcf && config.vcfMaxPly > 0) {
    const seq = vcfScan(state, config.vcfMaxPly);
    if (seq !== null) {
      return { stone: seq[0], cells: seq.slice(1) };
    }
  }

  const mcts = new MCTS(evaluator);
  // One snapshot for both temperature gates, so `tempMoves` and `cellTempMoves`
  // are read on the same scale (the stone placed this turn does not shift one
  // of them relative to the other).
  const stonesOnBoard = countStones(state);

  // ── stone choice ──
  // A forced block skips the search entirely: the move is not a matter of
  // judgement, and routing it through the visit distribution would let
  // temperature sampling throw the game away.
  const block = config.useVcf ? forcedBlock(state) : null;
  let stone: Pos;
  if (block !== null) {
    stone = block;
  } else {
    const root = await mcts.search(state, Math.max(1, config.sims));
    const temperature =
      stonesOnBoard < config.tempMoves ? Math.max(0, config.temperature) : 0;
    stone = sampleFrom(root.visitPolicy(temperature), rng);
  }

  let s = applyStone(state, stone);
  const cells: Pos[] = [];

  // ── dedicated cell-phase search (§14.2) — same player, CELL root ──
  if (s.phase === 'CELL' && s.winner === null) {
    let node =
      config.cellSims > 0 ? await mcts.search(s, config.cellSims) : null;
    const cellTemp =
      stonesOnBoard < config.cellTempMoves ? Math.max(0, config.cellTemperature) : 0;

    while (s.phase === 'CELL' && s.winner === null) {
      const legal = legalMask(s);
      // Screen out placements that would open a five for the opponent. Only
      // matters once cells are sampled, but it is cheap enough to always run.
      const usable = (config.useVcf ? safeCellMask(s, legal) : null) ?? legal;

      const policy =
        node && node.nTotal > 0
          // temp 0 -> take raw visit shares and argmax below, so that masking
          // still picks the *best* allowed cell rather than an arbitrary one
          ? node.visitPolicy(cellTemp > 0 ? cellTemp : 1)
          : (await evaluator.evaluate(s)).policy; // net-prior fallback

      const a = cellTemp > 0
        ? sampleMasked(policy, usable, rng)
        : pickMasked(policy, usable);

      cells.push(a);
      s = applyCell(s, a);
      node = node?.children.get(a) ?? null;
    }
  }

  return { stone, cells };
}
