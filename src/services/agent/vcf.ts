// Threat/VCF search engine — 1:1 port of py_reference/vcf.py (VCF_IMPL.md).
// Rule-based forced-win detection layered on the neural MCTS. Detects tempo=1
// completion-cell threats and double-threat forced wins; drives move selection
// via hard-proved override. Independent of the network (rules only).
import {
  N,
  BOARD_CELLS,
  WIN_LENGTH,
  inBounds,
  type GameState,
  type Player,
  type Pos,
} from '../../game/types';
import { applyStone, applyCell } from '../../game/engine';
import { frontierList, legalStoneList } from '../../game/rules';

// Win directions — identical to env.WIN_DIRS.
const WIN_DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

/** VCF verdict from the attacker's perspective. Larger = stronger confidence. */
export const ProvedStatus = {
  UNKNOWN: 0, // not decidable by VCF -> defer to network
  SOFT_PROVED_WIN: 1, // forced win only under optimistic fuzzy assumption
  HARD_PROVED_WIN: 2, // forced win even under worst-case fuzzy assumption
} as const;
export type ProvedStatusValue = (typeof ProvedStatus)[keyof typeof ProvedStatus];

type FuzzyMode = 'worst' | 'optimistic';
type FuzzyAssumption = { mode: FuzzyMode; set: ReadonlySet<number> } | null;

/** Node interface for §2.4 tagging (matches the TS MCTS node shape). */
interface TaggableNode {
  children: Map<number, { proved: ProvedStatusValue }>;
}

const other = (p: Player): Player => (p === 1 ? 2 : 1);

/** env.step dispatch on our immutable state. */
function step(s: GameState, action: Pos): GameState {
  return s.phase === 'STONE' ? applyStone(s, action) : applyCell(s, action);
}

const ongoing = (s: GameState): boolean => s.winner === null;
const winsFor = (s: GameState, player: Player): boolean => s.winner === player;

// ── threat primitives (§3) ────────────────────────────────────────────────────

/**
 * vcf._wins_at — assumes stones[pos] === player. Counts consecutive stones
 * through pos in each win direction (overline counts).
 */
export function winsAt(stones: Uint8Array, pos: Pos, player: Player): boolean {
  const r = Math.floor(pos / N);
  const c = pos % N;
  for (const [dr, dc] of WIN_DIRS) {
    let length = 1;
    for (const sign of [1, -1]) {
      let nr = r + sign * dr;
      let nc = c + sign * dc;
      while (inBounds(nr, nc) && stones[nr * N + nc] === player) {
        length++;
        nr += sign * dr;
        nc += sign * dc;
      }
    }
    if (length >= WIN_LENGTH) return true;
  }
  return false;
}

/**
 * vcf.completion_cells — tempo=1 completion cells for `player`: existing empty
 * cells where one stone completes >= WIN_LENGTH. fuzzyAdd/fuzzyRemove apply the
 * directional fuzzy assumption (§8) to the terrain before judging.
 */
export function completionCells(
  cells: Uint8Array,
  stones: Uint8Array,
  player: Player,
  fuzzyAdd: ReadonlySet<number> = EMPTY_SET,
  fuzzyRemove: ReadonlySet<number> = EMPTY_SET,
): Set<number> {
  let c = cells;
  if (fuzzyAdd.size || fuzzyRemove.size) {
    c = cells.slice();
    for (const a of fuzzyAdd) c[a] = 1;
    for (const a of fuzzyRemove) c[a] = 0;
  }
  const s = stones.slice();
  const result = new Set<number>();
  for (let i = 0; i < BOARD_CELLS; i++) {
    if (!c[i] || s[i] !== 0) continue;
    s[i] = player;
    if (winsAt(s, i, player)) result.add(i);
    s[i] = 0;
  }
  return result;
}

const EMPTY_SET: ReadonlySet<number> = new Set();

/** vcf.has_immediate_completion — `player` can win with a single stone now. */
export function hasImmediateCompletion(
  cells: Uint8Array,
  stones: Uint8Array,
  player: Player,
): boolean {
  const s = stones.slice();
  for (let i = 0; i < BOARD_CELLS; i++) {
    if (!cells[i] || s[i] !== 0) continue;
    s[i] = player;
    const won = winsAt(s, i, player);
    s[i] = 0;
    if (won) return true;
  }
  return false;
}

/**
 * vcf.opens_opponent_threat — §4.1: does placing a cell (terrain only) at
 * cellAction grow the opponent's completion-cell set?
 */
export function opensOpponentThreat(
  cells: Uint8Array,
  stones: Uint8Array,
  cellAction: Pos,
  opp: Player,
  oppBefore: ReadonlySet<number>,
): boolean {
  const c2 = cells.slice();
  c2[cellAction] = 1;
  const oppAfter = completionCells(c2, stones, opp);
  for (const a of oppAfter) if (!oppBefore.has(a)) return true;
  return false;
}

/**
 * vcf.any_defense_wins_for_opp — §6.2: does blocking one of my completion cells
 * itself complete 5 for the opponent (cross cell)?
 */
export function anyDefenseWinsForOpp(
  cells: Uint8Array,
  stones: Uint8Array,
  myComp: ReadonlySet<number>,
  opp: Player,
): boolean {
  const s = stones.slice();
  for (const cell of myComp) {
    if (!cells[cell] || s[cell] !== 0) continue;
    s[cell] = opp;
    const won = winsAt(s, cell, opp);
    s[cell] = 0;
    if (won) return true;
  }
  return false;
}

// ── turn resolution & recursion (§4, §6) ──────────────────────────────────────

/** vcf._grows_completion — placing a cell at cellAction grows player's set? */
function growsCompletion(
  cells: Uint8Array,
  stones: Uint8Array,
  cellAction: Pos,
  player: Player,
  before: ReadonlySet<number>,
): boolean {
  const c2 = cells.slice();
  c2[cellAction] = 1;
  const after = completionCells(c2, stones, player);
  for (const a of after) if (!before.has(a)) return true;
  return false;
}

interface ResolveResult {
  ok: boolean;
  fuzzy: Set<number>;
  placed: Pos[];
  state: GameState;
}

/**
 * vcf.resolve_cells — §4.2: place this turn's K cells with opponent-threat-first
 * ordering. `state`: stone placed, CELL phase, currentPlayer === attacker.
 */
export function resolveCells(state: GameState, attacker: Player): ResolveResult {
  const me = attacker;
  const opp = other(me);
  const fuzzy = new Set<number>();
  const placed: Pos[] = [];
  let s = state;

  while (s.phase === 'CELL' && ongoing(s)) {
    const frontier = frontierList(s.cells);
    const oppBefore = completionCells(s.cells, s.stones, opp);
    const myBefore = completionCells(s.cells, s.stones, me);

    const safe: Pos[] = [];
    let contributor: Pos | null = null;
    for (const a of frontier) {
      // (1) opponent-threat-first: skip cells that hand the opponent a threat
      if (opensOpponentThreat(s.cells, s.stones, a, opp, oppBefore)) continue;
      safe.push(a);
      // (2) prefer cells that grow MY threat
      if (contributor === null && growsCompletion(s.cells, s.stones, a, me, myBefore)) {
        contributor = a;
      }
    }

    if (safe.length === 0) {
      return { ok: false, fuzzy: new Set(), placed, state: s }; // only hand-off available
    }

    let pick: Pos;
    if (contributor !== null) {
      pick = contributor;
    } else {
      pick = safe[0];
      fuzzy.add(pick); // neutral placement = fuzzy
    }
    s = step(s, pick);
    placed.push(pick);
  }

  return { ok: true, fuzzy, placed, state: s };
}

/**
 * vcf._opp_resolve_pessimistic — opponent places its K cells maximizing its own
 * threat (worst case for the attacker). Returns the turn-ended state.
 */
function oppResolvePessimistic(state: GameState, opp: Player): GameState {
  let s = state;
  while (s.phase === 'CELL' && ongoing(s)) {
    const frontier = frontierList(s.cells);
    const oppBefore = completionCells(s.cells, s.stones, opp);
    let pick: Pos | null = null;
    for (const a of frontier) {
      if (growsCompletion(s.cells, s.stones, a, opp, oppBefore)) {
        pick = a;
        break;
      }
    }
    if (pick === null) pick = frontier[0];
    s = step(s, pick);
  }
  return s;
}

/** vcf._fuzzy_kwargs — fuzzy exclusion set for a given side. */
function fuzzyRemoveFor(fuzzy: FuzzyAssumption, side: 'mine' | 'opp'): ReadonlySet<number> {
  if (!fuzzy || fuzzy.set.size === 0) return EMPTY_SET;
  if (fuzzy.mode === 'worst' && side === 'mine') return fuzzy.set;
  if (fuzzy.mode === 'optimistic' && side === 'opp') return fuzzy.set;
  return EMPTY_SET;
}

/**
 * vcf.eval_after_my_turn — §6.1: attacker's turn ended (currentPlayer is the
 * opponent). Forced win for the attacker under the fuzzy assumption?
 */
export function evalAfterMyTurn(
  state: GameState,
  attacker: Player,
  depth: number,
  fuzzy: FuzzyAssumption = null,
): boolean {
  const opp = state.currentPlayer;
  const me = attacker;

  const myComp = completionCells(
    state.cells, state.stones, me, EMPTY_SET, fuzzyRemoveFor(fuzzy, 'mine'),
  );
  const oppComp = completionCells(
    state.cells, state.stones, opp, EMPTY_SET, fuzzyRemoveFor(fuzzy, 'opp'),
  );

  if (oppComp.size > 0) return false; // (A) opp immediate -> defer
  if (myComp.size >= 2) {
    // (B) double threat + counter-attack check
    return !anyDefenseWinsForOpp(state.cells, state.stones, myComp, opp);
  }
  if (myComp.size === 1) {
    // (C) single threat -> AND recurse
    const [only] = myComp;
    return recurseAfterForcedResponse(state, only, attacker, depth);
  }
  return false; // (D) chain ends
}

/**
 * vcf.recurse_after_forced_response — §6.3: opponent must block my single
 * completion cell; apply the block, opponent resolves cells pessimistically,
 * recurse on the attacker's next turn.
 */
// (python threads `fuzzy` through here but never reads it — dropped in the port)
function recurseAfterForcedResponse(
  state: GameState,
  myCompletion: Pos,
  attacker: Player,
  depth: number,
): boolean {
  const opp = state.currentPlayer;

  let s3 = step(state, myCompletion); // opp blocks with a stone
  if (!ongoing(s3)) return false; // opp wins/draws by blocking

  if (s3.phase === 'CELL') {
    s3 = oppResolvePessimistic(s3, opp); // opp resolves its K cells
  }

  if (!ongoing(s3)) return winsFor(s3, attacker);
  if (s3.phase !== 'STONE' || s3.currentPlayer !== attacker) return false; // structural guard
  if (hasImmediateCompletion(s3.cells, s3.stones, opp)) return false; // counter threat -> defer

  return proveMyTurn(s3, depth - 1) !== null;
}

/**
 * vcf.prove_my_turn — §6.1 OR layer. `state`: attacker's STONE position.
 * Returns a HARD-proved forced-win stone action (worst-case fuzzy) or null.
 */
export function proveMyTurn(state: GameState, depth: number): Pos | null {
  if (depth <= 0 || !ongoing(state) || state.phase !== 'STONE') return null;
  const attacker = state.currentPlayer;

  for (const stoneA of legalStoneList(state.cells, state.stones)) {
    let s2 = step(state, stoneA);
    if (!ongoing(s2)) {
      if (winsFor(s2, attacker)) return stoneA; // stone alone wins (tempo=0)
      continue;
    }

    let fuzzySet: Set<number> = new Set();
    if (s2.phase === 'CELL') {
      const res = resolveCells(s2, attacker);
      if (!res.ok) continue;
      fuzzySet = res.fuzzy;
      s2 = res.state;
    }
    if (!ongoing(s2)) {
      if (winsFor(s2, attacker)) return stoneA; // cells ended the game
      continue;
    }

    if (evalAfterMyTurn(s2, attacker, depth, { mode: 'worst', set: fuzzySet })) {
      return stoneA;
    }
  }
  return null;
}

// ── grading, scan (§8.2, §9) ──────────────────────────────────────────────────

/** vcf.candidate_moves — stone placements (STONE) or frontier cells (CELL). */
export function candidateMoves(state: GameState): Pos[] {
  if (state.phase === 'STONE') return legalStoneList(state.cells, state.stones);
  return frontierList(state.cells);
}

/** vcf._prove_move_under — apply one candidate, finish the turn, judge. */
function proveMoveUnder(
  state: GameState,
  action: Pos,
  depth: number,
  mode: FuzzyMode,
): boolean {
  const attacker = state.currentPlayer;
  let s2 = step(state, action);
  if (!ongoing(s2)) return winsFor(s2, attacker);

  let fuzzySet: Set<number> = new Set();
  if (s2.phase === 'CELL') {
    const res = resolveCells(s2, attacker);
    if (!res.ok) return false;
    fuzzySet = res.fuzzy;
    s2 = res.state;
  }
  if (!ongoing(s2)) return winsFor(s2, attacker);
  if (s2.currentPlayer === attacker) return false; // turn must have passed
  return evalAfterMyTurn(s2, attacker, depth, { mode, set: fuzzySet });
}

/** vcf.classify_move — HARD (worst-case) > SOFT (optimistic) > UNKNOWN. */
export function classifyMove(
  state: GameState,
  action: Pos,
  depth: number,
): ProvedStatusValue {
  if (proveMoveUnder(state, action, depth, 'worst')) return ProvedStatus.HARD_PROVED_WIN;
  if (proveMoveUnder(state, action, depth, 'optimistic')) return ProvedStatus.SOFT_PROVED_WIN;
  return ProvedStatus.UNKNOWN;
}

/** vcf.classify_move_with_seq — on HARD, also return [move, cell, ...] for injection. */
function classifyMoveWithSeq(
  state: GameState,
  action: Pos,
  depth: number,
): [ProvedStatusValue, Pos[] | null] {
  const status = classifyMove(state, action, depth);
  if (status !== ProvedStatus.HARD_PROVED_WIN) return [status, null];

  const attacker = state.currentPlayer;
  const seq: Pos[] = [action];
  const s2 = step(state, action);
  if (s2.phase === 'CELL' && ongoing(s2)) {
    const { placed } = resolveCells(s2, attacker);
    seq.push(...placed);
  }
  return [status, seq];
}

/** vcf._prefilter — cheap gate (§9.5): needs >= WIN_LENGTH-2 own stones. */
function prefilter(state: GameState): boolean {
  const me = state.currentPlayer;
  let count = 0;
  for (let i = 0; i < BOARD_CELLS; i++) if (state.stones[i] === me) count++;
  return count >= WIN_LENGTH - 2;
}

function tagChildren(
  root: TaggableNode | null,
  grades: Map<number, ProvedStatusValue>,
): void {
  if (!root) return;
  for (const [a, status] of grades) {
    const child = root.children.get(a);
    if (child) child.proved = status;
  }
}

/**
 * vcf.vcf_scan — §9.1 single entry point (STONE or CELL). Returns the SHORTEST
 * HARD forced-win action sequence for this turn, or null. Iterative deepening
 * finds the fewest-ply win first; tempo-0 completions take absolute priority.
 */
export function vcfScan(
  state: GameState,
  root: TaggableNode | null,
  maxPly: number,
): Pos[] | null {
  if (!ongoing(state)) return null;
  if (!prefilter(state)) return null;

  // Tempo-0 priority: an existing immediate 5-completion must be played now —
  // otherwise a 'nothing' move that merely preserves a pre-existing double
  // threat can be graded HARD first and skip the actual winning move.
  if (state.phase === 'STONE') {
    const comp = completionCells(state.cells, state.stones, state.currentPlayer);
    if (comp.size > 0) {
      const a = Math.min(...comp);
      tagChildren(root, new Map([[a, ProvedStatus.HARD_PROVED_WIN]]));
      return [a];
    }
  }

  let grades = new Map<number, ProvedStatusValue>();
  for (let ply = 1; ply <= maxPly; ply++) {
    grades = new Map();
    let hardSeq: Pos[] | null = null;
    for (const a of candidateMoves(state)) {
      const [status, seq] = classifyMoveWithSeq(state, a, ply);
      grades.set(a, status);
      if (status === ProvedStatus.HARD_PROVED_WIN && hardSeq === null) {
        hardSeq = seq; // first HARD at this (shallowest) ply
      }
    }
    if (hardSeq !== null) {
      tagChildren(root, grades);
      return hardSeq;
    }
  }

  tagChildren(root, grades); // deepest-ply grades (soft/unknown)
  return null;
}
