// Heuristic mock agent — plays a legal, sometimes-sensible game so the whole
// CPU flow (loading, turn orchestration, difficulty, debug panel) can be built
// and tested before the real ONNX + MCTS engine is dropped in behind loadAgent.
import { applyStone, applyCell } from '../../game/engine';
import { legalStoneList, frontierList, checkWin } from '../../game/rules';
import {
  toRow, toCol, inBounds, toPos, N,
  type GameState, type Player, type Pos,
} from '../../game/types';
import type { AgentConfig, AgentMove, CellmokuAgent } from './types';
import type { Difficulty } from '../../store/useGameStore';

const other = (p: Player): Player => (p === 1 ? 2 : 1);
const DIRS_8 = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
] as const;
const WIN_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const;

/** Would `player` placing a stone at empty cell `pos` complete a win? */
function winsAt(state: GameState, pos: Pos, player: Player): boolean {
  const tmp = state.stones.slice();
  tmp[pos] = player;
  return checkWin(tmp, pos, player) !== null;
}

/** Longest own run (incl. the hypothetical stone at pos) across the 4 win axes. */
function bestLine(stones: Uint8Array, pos: Pos, player: Player): number {
  const r = toRow(pos), c = toCol(pos);
  let best = 1;
  for (const [dr, dc] of WIN_DIRS) {
    let len = 1;
    for (const sign of [1, -1]) {
      let nr = r + sign * dr, nc = c + sign * dc;
      while (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) {
        len++; nr += sign * dr; nc += sign * dc;
      }
    }
    best = Math.max(best, len);
  }
  return best;
}

function ownNeighbors(stones: Uint8Array, pos: Pos, player: Player): number {
  const r = toRow(pos), c = toCol(pos);
  let count = 0;
  for (const [dr, dc] of DIRS_8) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && stones[toPos(nr, nc)] === player) count++;
  }
  return count;
}

function scoreStone(state: GameState, pos: Pos, me: Player): number {
  const tmp = state.stones.slice();
  tmp[pos] = me;
  const mine = bestLine(tmp, pos, me);
  // also value blocking/pressuring the opponent's shape at this square
  const oppTmp = state.stones.slice();
  oppTmp[pos] = other(me);
  const oppLine = bestLine(oppTmp, pos, other(me));
  const k = ownNeighbors(state.stones, pos, me);
  const distCenter = Math.abs(toRow(pos) - (N >> 1)) + Math.abs(toCol(pos) - (N >> 1));
  return 2.2 * mine + 1.4 * oppLine + 0.8 * k - 0.03 * distCenter;
}

function softmaxPick(scored: { p: Pos; v: number }[], temperature: number): Pos {
  if (scored.length === 1) return scored[0].p;
  const max = Math.max(...scored.map((s) => s.v));
  const weights = scored.map((s) => Math.exp((s.v - max) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].p;
  }
  return scored[scored.length - 1].p;
}

/** Greedily place the earned cells to cluster around own stones near the last move. */
function pickCell(s: GameState, me: Player): Pos | null {
  const front = frontierList(s.cells);
  if (front.length === 0) return null;
  let best = front[0];
  let bestScore = -Infinity;
  for (const f of front) {
    const nb = ownNeighbors(s.stones, f, me);
    const near = s.lastStonePos != null
      ? -(Math.abs(toRow(f) - toRow(s.lastStonePos)) + Math.abs(toCol(f) - toCol(s.lastStonePos)))
      : 0;
    const score = nb * 10 + near * 0.5 + Math.random() * 0.5;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function finishTurn(state: GameState, stonePos: Pos, me: Player): AgentMove {
  let s = applyStone(state, stonePos);
  const cells: Pos[] = [];
  let guard = 0;
  while (s.phase === 'CELL' && !s.winner && guard++ < 64) {
    const target = pickCell(s, me);
    if (target == null) break;
    cells.push(target);
    s = applyCell(s, target);
  }
  return { stone: stonePos, cells };
}

export class MockAgent implements CellmokuAgent {
  ready = Promise.resolve();
  private difficulty: Difficulty;
  constructor(difficulty: Difficulty) {
    this.difficulty = difficulty;
  }

  async getMove(state: GameState, config: AgentConfig): Promise<AgentMove> {
    const me = state.currentPlayer;
    const opp = other(me);
    const legal = legalStoneList(state.cells, state.stones);
    if (legal.length === 0) return { stone: -1, cells: [] }; // shouldn't happen

    // 1. take an immediate win
    const winMove = legal.find((p) => winsAt(state, p, me));
    if (winMove !== undefined) return finishTurn(state, winMove, me);

    // 2. block an opponent's immediate win (easy sometimes misses it)
    const doBlock = this.difficulty !== 'easy' || Math.random() > 0.5;
    if (doBlock) {
      const threat = legal.find((p) => winsAt(state, p, opp));
      if (threat !== undefined) return finishTurn(state, threat, me);
    }

    // 3. heuristic score + temperature sampling
    const scored = legal.map((p) => ({ p, v: scoreStone(state, p, me) }));
    const temp = Math.max(1e-3, config.temperature);
    return finishTurn(state, softmaxPick(scored, temp), me);
  }
}
