// Threat/VCF search engine — ported from py_reference/vcf.py (VCF_IMPL.md).
// Rule-based forced-win detection layered on the neural MCTS. Detects tempo=1
// completion-cell threats and double-threat forced wins; drives move selection
// via hard-proved override. Independent of the network (rules only).
//
// Divergence from py_reference: the SOFT (optimistic-assumption) grade is not
// implemented. With threats limited to four-in-a-row and vcfMaxPly=2, SOFT never
// fired in measurement, while grading it cost a second full proof pass on every
// candidate that failed the first — i.e. on nearly all of them. Only the
// worst-case pass remains, which is what HARD soundness rests on anyway.
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

const EMPTY_SET: ReadonlySet<number> = new Set();

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
 * cells where one stone completes >= WIN_LENGTH.
 *
 * `excluded` squares are treated as absent terrain before judging (§8). Used to
 * discount cells the attacker placed neutrally this turn, which a worst-case
 * proof may not rely on.
 */
export function completionCells(
  cells: Uint8Array,
  stones: Uint8Array,
  player: Player,
  excluded: ReadonlySet<number> = EMPTY_SET,
): Set<number> {
  let c = cells;
  if (excluded.size) {
    c = cells.slice();
    for (const a of excluded) c[a] = 0;
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
  /** Cells placed neutrally (py_reference calls this the `fuzzy` set): they serve
   *  neither side's threat, so a worst-case proof must not lean on them. */
  neutral: Set<number>;
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
  const neutral = new Set<number>();
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
      return { ok: false, neutral: new Set(), placed, state: s }; // only hand-off available
    }

    let pick: Pos;
    if (contributor !== null) {
      pick = contributor;
    } else {
      pick = safe[0];
      neutral.add(pick); // serves no threat either way
    }
    s = step(s, pick);
    placed.push(pick);
  }

  return { ok: true, neutral, placed, state: s };
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

/**
 * vcf.eval_after_my_turn — §6.1: attacker's turn ended (currentPlayer is the
 * opponent). Forced win for the attacker, judged worst-case?
 *
 * `neutral`: cells the attacker placed neutrally this turn. They are discounted
 * from the attacker's own threats (can't be relied on) but left intact for the
 * opponent's — the pessimistic direction on both sides.
 */
export function evalAfterMyTurn(
  state: GameState,
  attacker: Player,
  depth: number,
  neutral: ReadonlySet<number> = EMPTY_SET,
): boolean {
  const opp = state.currentPlayer;
  const me = attacker;

  const myComp = completionCells(state.cells, state.stones, me, neutral);
  const oppComp = completionCells(state.cells, state.stones, opp);

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
 * Returns a hard-proved forced-win stone action, or null.
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

    let neutral: ReadonlySet<number> = EMPTY_SET;
    if (s2.phase === 'CELL') {
      const res = resolveCells(s2, attacker);
      if (!res.ok) continue;
      neutral = res.neutral;
      s2 = res.state;
    }
    if (!ongoing(s2)) {
      if (winsFor(s2, attacker)) return stoneA; // cells ended the game
      continue;
    }

    if (evalAfterMyTurn(s2, attacker, depth, neutral)) return stoneA;
  }
  return null;
}

// ── forced defence ────────────────────────────────────────────────────────────

/**
 * The opponent completes 5 on their next turn and we have no completion of our
 * own, so the only non-losing stone occupies a threat square. Returns that
 * square, or null when no defence is called for.
 *
 * Not part of vcfScan: that proves *wins* and is gated by a prefilter counting
 * the mover's own stones, which is irrelevant to defence. Search alone does not
 * guarantee this — with temperature > 0 the visit distribution routinely leaves
 * enough mass off the blocking move to sample a loss (measured ~44% at
 * temperature 1.0), so the block has to bypass sampling entirely.
 *
 * When several threats exist the choice is arbitrary and we take the lowest
 * index: our stone never counts toward the opponent's runs, so blocking one
 * square removes exactly that square from their completion set and nothing
 * else — two live threats are already lost.
 */
export function forcedBlock(state: GameState): Pos | null {
  if (state.phase !== 'STONE' || !ongoing(state)) return null;
  const me = state.currentPlayer;

  // winning outright beats defending (vcfScan runs first and handles it)
  if (completionCells(state.cells, state.stones, me).size > 0) return null;

  const threats = completionCells(state.cells, state.stones, other(me));
  if (threats.size === 0) return null;
  return Math.min(...threats); // completionCells only yields playable squares
}

/**
 * Cell-phase counterpart to forcedBlock: which of the legal cell placements do
 * NOT hand the opponent a new 5-completion?
 *
 * Placing a cell only adds terrain, so it can open a line the opponent was one
 * stone short of — a self-inflicted loss that forcedBlock cannot see, because
 * that only screens stone choices. Greedy play never did this in measurement
 * (0 of 340 placements), but sampling cells with a temperature will.
 *
 * Returns null when the screen does not apply — either the opponent cannot
 * complete five at all, or every option is unsafe and there is nothing to
 * choose between. Callers fall back to the unfiltered legal mask.
 */
export function safeCellMask(state: GameState, legal: Uint8Array): Uint8Array | null {
  const opp = other(state.currentPlayer);

  // cheap gate: fewer than WIN_LENGTH-1 opponent stones can never complete five
  let oppStones = 0;
  for (let i = 0; i < BOARD_CELLS; i++) if (state.stones[i] === opp) oppStones++;
  if (oppStones < WIN_LENGTH - 1) return null;

  const before = completionCells(state.cells, state.stones, opp);
  const safe = new Uint8Array(BOARD_CELLS);
  let any = false;
  for (let a = 0; a < BOARD_CELLS; a++) {
    if (!legal[a]) continue;
    if (opensOpponentThreat(state.cells, state.stones, a, opp, before)) continue;
    safe[a] = 1;
    any = true;
  }
  return any ? safe : null;
}

// ── grading, scan (§8.2, §9) ──────────────────────────────────────────────────

/** vcf.candidate_moves — stone placements (STONE) or frontier cells (CELL). */
export function candidateMoves(state: GameState): Pos[] {
  if (state.phase === 'STONE') return legalStoneList(state.cells, state.stones);
  return frontierList(state.cells);
}

/**
 * vcf.classify_move, reduced to the worst-case pass: apply one candidate, finish
 * the turn, and judge whether it forces a win.
 */
export function isHardProvedWin(state: GameState, action: Pos, depth: number): boolean {
  const attacker = state.currentPlayer;
  let s2 = step(state, action);
  if (!ongoing(s2)) return winsFor(s2, attacker);

  let neutral: ReadonlySet<number> = EMPTY_SET;
  if (s2.phase === 'CELL') {
    const res = resolveCells(s2, attacker);
    if (!res.ok) return false;
    neutral = res.neutral;
    s2 = res.state;
  }
  if (!ongoing(s2)) return winsFor(s2, attacker);
  if (s2.currentPlayer === attacker) return false; // turn must have passed
  return evalAfterMyTurn(s2, attacker, depth, neutral);
}

/** vcf.classify_move_with_seq — on a proof, the full [move, cell, ...] sequence. */
function hardWinSequence(state: GameState, action: Pos, depth: number): Pos[] | null {
  if (!isHardProvedWin(state, action, depth)) return null;

  const attacker = state.currentPlayer;
  const seq: Pos[] = [action];
  const s2 = step(state, action);
  if (s2.phase === 'CELL' && ongoing(s2)) {
    const { placed } = resolveCells(s2, attacker);
    seq.push(...placed);
  }
  return seq;
}

/** vcf._prefilter — cheap gate (§9.5): needs >= WIN_LENGTH-2 own stones. */
function prefilter(state: GameState): boolean {
  const me = state.currentPlayer;
  let count = 0;
  for (let i = 0; i < BOARD_CELLS; i++) if (state.stones[i] === me) count++;
  return count >= WIN_LENGTH - 2;
}

/**
 * vcf.vcf_scan — §9.1 single entry point (STONE or CELL). Returns the SHORTEST
 * forced-win action sequence for this turn, or null. Iterative deepening finds
 * the fewest-ply win first; tempo-0 completions take absolute priority.
 */
export function vcfScan(state: GameState, maxPly: number): Pos[] | null {
  if (!ongoing(state)) return null;
  if (!prefilter(state)) return null;

  // Tempo-0 priority: an existing immediate 5-completion must be played now —
  // otherwise a 'nothing' move that merely preserves a pre-existing double
  // threat can be proved first and skip the actual winning move.
  if (state.phase === 'STONE') {
    const comp = completionCells(state.cells, state.stones, state.currentPlayer);
    if (comp.size > 0) return [Math.min(...comp)];
  }

  for (let ply = 1; ply <= maxPly; ply++) {
    for (const a of candidateMoves(state)) {
      const seq = hardWinSequence(state, a, ply);
      if (seq !== null) return seq; // first proof at this (shallowest) ply
    }
  }
  return null;
}
