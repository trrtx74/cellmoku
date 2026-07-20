// AlphaZero-style MCTS — port of py_reference/mcts.py (§14: two searches per
// game turn — stone root + dedicated cell-phase root).
//
// Sign conventions (mcts.py design notes):
// - No sign flip between same-player steps (cell sub-turns stay with the player).
// - Sign flips only when the player changes (i.e. at end-of-turn boundaries).
// - Node value is always from that node's player's perspective.
//
// Play (vs human) uses no Dirichlet noise, matching evaluate.py (dirichlet_eps=0).
import {
  BOARD_CELLS,
  type GameState,
  type Phase,
  type Player,
  type Pos,
  type Winner,
} from '../../game/types';
import { applyStone, applyCell } from '../../game/engine';
import { legalMask } from '../../game/obs';
import type { ProvedStatusValue } from './vcf';

/** Async leaf evaluator — net.infer semantics: legal-masked softmax policy over
 * 225 actions for the current phase + scalar value (win−loss) in [-1, 1],
 * both from the current player's perspective. */
export interface Evaluator {
  evaluate(state: GameState): Promise<{ policy: Float32Array; value: number }>;
}

function step(s: GameState, action: Pos): GameState {
  return s.phase === 'STONE' ? applyStone(s, action) : applyCell(s, action);
}

export class MCTSNode {
  player: Player;
  phase: Phase;
  N = new Map<number, number>();
  W = new Map<number, number>();
  P = new Map<number, number>();
  children = new Map<number, MCTSNode>();
  nTotal = 0;
  /** Terminal result at this node, or null when non-terminal (mcts.py node.result). */
  result: Winner = null;
  netValue = 0;
  /** VCF proved status tag (§2.4). */
  proved: ProvedStatusValue = 0;

  constructor(player: Player, phase: Phase) {
    this.player = player;
    this.phase = phase;
  }

  qValue(action: number): number {
    const n = this.N.get(action) ?? 0;
    return n > 0 ? (this.W.get(action) ?? 0) / n : 0;
  }

  puctScore(action: number, cPuct: number): number {
    return (
      this.qValue(action) +
      (cPuct * (this.P.get(action) ?? 0) * Math.sqrt(this.nTotal)) /
        (1 + (this.N.get(action) ?? 0))
    );
  }

  selectAction(cPuct: number): number {
    let best = -1;
    let bestScore = -Infinity;
    for (const a of this.P.keys()) {
      const s = this.puctScore(a, cPuct);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    return best;
  }

  /** Visit-count distribution over BOARD_CELLS actions, with temperature. */
  visitPolicy(temperature: number): Float32Array {
    const pi = new Float32Array(BOARD_CELLS);
    let sum = 0;
    for (const [a, n] of this.N) {
      pi[a] = n;
      sum += n;
    }
    if (sum === 0) return pi;
    if (temperature === 0) {
      // one-hot on the first max (np.argmax semantics)
      let best = 0;
      for (let a = 1; a < BOARD_CELLS; a++) if (pi[a] > pi[best]) best = a;
      pi.fill(0);
      pi[best] = 1;
      return pi;
    }
    let total = 0;
    for (let a = 0; a < BOARD_CELLS; a++) {
      pi[a] = pi[a] ** (1 / temperature);
      total += pi[a];
    }
    for (let a = 0; a < BOARD_CELLS; a++) pi[a] /= total;
    return pi;
  }
}

function terminalValue(result: Winner, player: Player): number {
  if (result === 'DRAW') return 0;
  return result === player ? 1 : -1;
}

export class MCTS {
  private evaluator: Evaluator;
  private cPuct: number;

  constructor(evaluator: Evaluator, cPuct = 1.5) {
    this.evaluator = evaluator;
    this.cPuct = cPuct;
  }

  /** Full MCTS search from `state` (STONE or CELL phase, ongoing). */
  async search(state: GameState, numSimulations: number): Promise<MCTSNode> {
    if (state.winner !== null) throw new Error('search on a finished game');
    const root = new MCTSNode(state.currentPlayer, state.phase);
    await this.expand(root, state);
    for (let i = 0; i < numSimulations; i++) {
      await this.simulate(root, state);
    }
    return root;
  }

  /** mcts._expand_gen — evaluate one node (or mark terminal). */
  private async expand(node: MCTSNode, state: GameState): Promise<void> {
    if (state.winner !== null) {
      node.result = state.winner;
      node.netValue = terminalValue(state.winner, node.player);
      return;
    }
    const { policy, value } = await this.evaluator.evaluate(state);
    const mask = legalMask(state);
    for (let a = 0; a < BOARD_CELLS; a++) {
      if (mask[a]) {
        node.P.set(a, policy[a]);
        node.N.set(a, 0);
        node.W.set(a, 0);
      }
    }
    node.netValue = value;
  }

  /** mcts._simulate_gen — one simulation with player-boundary sign flips. */
  private async simulate(root: MCTSNode, rootState: GameState): Promise<void> {
    const path: Array<[MCTSNode, number, MCTSNode]> = [];
    let node = root;
    let s = rootState;
    let leafValue: number;

    for (;;) {
      if (node.result !== null) {
        leafValue = node.netValue;
        break;
      }

      const action = node.selectAction(this.cPuct);
      s = step(s, action);

      const existing = node.children.get(action);
      if (!existing) {
        const child = new MCTSNode(s.currentPlayer, s.phase);
        node.children.set(action, child);
        await this.expand(child, s);
        path.push([node, action, child]);
        leafValue = child.netValue;
        break;
      }

      path.push([node, action, existing]);
      node = existing;
    }

    // Backup: flip sign only at player-switch boundaries
    let v = leafValue;
    for (let i = path.length - 1; i >= 0; i--) {
      const [parent, action, child] = path[i];
      if (parent.player !== child.player) v = -v;
      parent.N.set(action, (parent.N.get(action) ?? 0) + 1);
      parent.nTotal += 1;
      parent.W.set(action, (parent.W.get(action) ?? 0) + v);
    }
  }
}

export { terminalValue };
