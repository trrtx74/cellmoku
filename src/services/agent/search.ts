// Full-turn move selection — evaluate.py `play_eval_game_gen` pattern plus the
// selfplay VCF hard-proof override. Pure orchestration over an Evaluator, so it
// is unit-testable without onnxruntime.
import { BOARD_CELLS, type GameState, type Pos } from '../../game/types';
import { applyStone, applyCell } from '../../game/engine';
import { legalMask } from '../../game/obs';
import { MCTS, type Evaluator } from './mcts';
import { vcfScan } from './vcf';
import type { AgentConfig, AgentMove } from './types';

/** Sample an action from a distribution over BOARD_CELLS (np.random.choice). */
function sampleFrom(policy: Float32Array, rng: () => number = Math.random): Pos {
  let r = rng();
  for (let a = 0; a < BOARD_CELLS; a++) {
    r -= policy[a];
    if (r <= 0) return a;
  }
  // numerical remainder: last action with mass
  for (let a = BOARD_CELLS - 1; a >= 0; a--) if (policy[a] > 0) return a;
  return 0;
}

/** evaluate.py cell pick: argmax(policy * legal), fallback first legal. */
function pickCellGreedy(policy: Float32Array, legal: Uint8Array): Pos {
  let best = -1;
  let bestVal = 0;
  let firstLegal = -1;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (!legal[a]) continue;
    if (firstLegal < 0) firstLegal = a;
    if (policy[a] > bestVal) {
      bestVal = policy[a];
      best = a;
    }
  }
  return best >= 0 && bestVal > 1e-12 ? best : firstLegal;
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
    const seq = vcfScan(state, null, config.vcfMaxPly);
    if (seq !== null) {
      return { stone: seq[0], cells: seq.slice(1) };
    }
  }

  const mcts = new MCTS(evaluator);

  // ── stone search ──
  const root = await mcts.search(state, Math.max(1, config.sims));
  const temperature =
    countStones(state) < config.tempMoves ? Math.max(0, config.temperature) : 0;
  const stonePolicy = root.visitPolicy(temperature);
  const stone = sampleFrom(stonePolicy, rng);

  let s = applyStone(state, stone);
  const cells: Pos[] = [];

  // ── dedicated cell-phase search (§14.2) — same player, CELL root ──
  if (s.phase === 'CELL' && s.winner === null) {
    let node =
      config.cellSims > 0 ? await mcts.search(s, config.cellSims) : null;

    while (s.phase === 'CELL' && s.winner === null) {
      const legal = legalMask(s);
      let cellPolicy: Float32Array;
      if (node && node.nTotal > 0) {
        cellPolicy = node.visitPolicy(0);
      } else {
        cellPolicy = (await evaluator.evaluate(s)).policy; // net-prior fallback
      }
      const a = pickCellGreedy(cellPolicy, legal);
      cells.push(a);
      s = applyCell(s, a);
      node = node?.children.get(a) ?? null;
    }
  }

  return { stone, cells };
}
