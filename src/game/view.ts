// Render model derived from game state + turn history (owner tags aren't needed
// for rules, so they live here rather than in the engine).
import { BOARD_CELLS, type GameState, type Player, type Pos, type Turn, type Draft } from './types';
import { initialCells } from './rules';

export type Color = 'BLACK' | 'WHITE';

export const colorOf = (p: Player): Color => (p === 1 ? 'BLACK' : 'WHITE');

/** Per-cell ownership: 'INITIAL' for the starting ring, a color for placed cells. */
export type Owner = Color | 'INITIAL' | null;

/**
 * Ownership map (length 225) derived purely from the turn history + draft.
 * Robust across undo since it never mutates incrementally.
 */
export function cellOwners(turns: Turn[], draft: Draft | null): Owner[] {
  const owners: Owner[] = new Array(BOARD_CELLS).fill(null);
  const ring = initialCells();
  for (let i = 0; i < BOARD_CELLS; i++) if (ring[i]) owners[i] = 'INITIAL';
  for (const t of turns) for (const c of t.cells) owners[c] = colorOf(t.player);
  if (draft) for (const c of draft.cells) owners[c] = colorOf(draft.player);
  return owners;
}

export interface TileView {
  hasCell: boolean;
  isInitial: boolean;
  tag: Color | null; // player-placed cell → tag color; initial/none → null
  stone: Color | null;
  isLastStone: boolean;
  isLastCell: boolean;
  isWin: boolean;
}

export interface BoardView {
  tiles: TileView[];
}

export function buildBoardView(
  state: GameState,
  owners: Owner[],
): BoardView {
  const winSet = state.winLine ? new Set<Pos>(state.winLine) : null;
  const tiles: TileView[] = new Array(BOARD_CELLS);
  for (let i = 0; i < BOARD_CELLS; i++) {
    const owner = owners[i];
    const stoneVal = state.stones[i];
    tiles[i] = {
      hasCell: state.cells[i] === 1,
      isInitial: owner === 'INITIAL',
      tag: owner === 'BLACK' || owner === 'WHITE' ? owner : null,
      stone: stoneVal === 1 ? 'BLACK' : stoneVal === 2 ? 'WHITE' : null,
      isLastStone: state.lastStonePos === i,
      isLastCell: state.lastCellPositions.includes(i),
      isWin: winSet ? winSet.has(i) : false,
    };
  }
  return { tiles };
}
