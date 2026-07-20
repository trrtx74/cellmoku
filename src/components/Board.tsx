import { useMemo } from 'react';
import styled from 'styled-components';
import { N, BOARD_CELLS, toRow, toCol, type Pos, type Phase } from '../game/types';
import type { BoardView, Color } from '../game/view';

// ── overlay data (populated from step 5 onward) ──────────────────────────────

export interface CursorView {
  pos: Pos;
  kind: 'stone' | 'cell';
  color: Color; // whose ghost to show
}

export interface Band {
  /** cursor cell (arrow flows toward here) */
  to: Pos;
  /** an adjacent own stone the band connects from */
  from: Pos;
}

interface BoardProps {
  view: BoardView;
  cursor?: CursorView | null;
  /** frontier mask (length 225) highlighted during the cell phase */
  placeable?: Uint8Array | null;
  bands?: Band[];
  color?: Color; // active player color (for placeable/ghost tint)
  phase?: Phase;
  onActivate?: (pos: Pos, pointerType: string) => void;
  onHover?: (pos: Pos) => void;
  onLeave?: () => void;
}

// ── styled ────────────────────────────────────────────────────────────────────

const Frame = styled.div`
  position: relative;
  /* fit within both the available width and height (minus navbar/status/controls) */
  width: min(100%, calc(100dvh - 210px));
  aspect-ratio: 1 / 1;
  max-width: 560px;
  /* background: pink; */
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${100 / N / 2}%;
  box-shadow: 0 8px 30px rgba(22, 33, 58, 0.08);
  touch-action: manipulation;

  @media (max-width: 768px) {
    /* width: min(100dvw, 100dvh); */
    width: 105dvw;
  }
`;

const Grid = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(${N}, 1fr);
  grid-template-rows: repeat(${N}, 1fr);
`;

const Tile = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  aspect-ratio: 1 / 1;

  border: 1px solid ${({ theme }) => theme.colors.boardGrid};
`;

// const Lattice = styled.div`
//   position: absolute;
//   inset: 2%;
//   border-radius: 3px;
//   border: 1px solid ${({ theme }) => theme.colors.boardGrid};
//   background: transparent;
// `;

const Cell = styled.div<{ $initial: boolean; $last: boolean; $win: boolean }>`
  position: absolute;
  width: 100%;
  aspect-ratio: 1 / 1;
  /* inset: 5%; */
  scale: 94%;
  border-radius: 22%;
  /* border: 2px solid; */
  border: ${({ $last }) => $last ? '1px solid' : 'none'} ${({ theme }) => theme.colors.primary};
  background: ${({ theme, $initial }) =>
    $initial ? theme.colors.cellInitial : theme.colors.cell};
  box-shadow: ${({ $win, theme }) =>
    $win ? `0 0 0 2px ${theme.colors.primary}, 0 0 12px ${theme.colors.primary}` : 'none'};
  transition: box-shadow ${({ theme }) => theme.transitions.default};
`;

// const GhostCell = styled.div<{ $color: Color }>`
//   position: absolute;
//   inset: 5%;
//   border-radius: 22%;
//   background: ${({ $color }) =>
//     $color === 'BLACK' ? 'rgba(27,35,51,0.18)' : 'rgba(37,99,235,0.14)'};
//   border: 1.5px dashed ${({ theme }) => theme.colors.primary};
// `;

const Placeable = styled.div<{ $ghost?: boolean }>`
  position: absolute;
  width: 100%;
  aspect-ratio: 1 / 1;
  /* inset: 30%; */
  scale: ${({ $ghost }) => ($ghost ? 100 : 30)}%;
  /* inset: ${({ $ghost }) => ($ghost ? 5 : 30)}%; */
  /* border-radius: ${({ $ghost }) => ($ghost ? 22 : 40)}%; */
  background: ${({ theme }) => theme.colors.primary};
  opacity: 0.7;

  transition: 0.1s;
`;

// (usage currently commented out in the JSX below — keep in sync when re-enabling)
// const Tag = styled.div<{ $color: Color }>`
//   position: absolute;
//   top: 9%;
//   left: 9%;
//   width: 22%;
//   height: 22%;
//   border-radius: 30%;
//   background: ${({ theme, $color }) =>
//     $color === 'BLACK' ? theme.colors.stoneBlack : theme.colors.stoneWhite};
//   border: 1px solid
//     ${({ theme, $color }) =>
//       $color === 'BLACK' ? theme.colors.stoneBlack : theme.colors.stoneWhiteBorder};
// `;

const Stone = styled.div<{ $color: Color; $last: boolean; $ghost?: boolean }>`
  position: absolute;
  /* width: ${({ $ghost }) => ($ghost ? 100 : 85)}%; */
  width: 100%;
  aspect-ratio: 1 / 1;
  /* inset: ${({ $ghost }) => ($ghost ? 5 : 15)}%; */
  /* inset: 15%; */
  /* scale: ${({ $ghost }) => ($ghost ? 90 : 75)}%; */
  scale: 75%;
  border-radius: 50%;
  background: ${({ theme, $color }) =>
    $color === 'BLACK' ? theme.colors.stoneBlack : theme.colors.stoneWhite};
  border: ${({ $last }) => $last ? 2 : 1.5}px solid
    ${({ theme, $color }) =>
       $color === 'BLACK' ? '#0B1220' : theme.colors.stoneWhiteBorder};
  /* border: ${({ $last }) => $last ? 2 : 1.5}px solid
    ${({ theme, $color, $last }) =>
      $last
        ? $color === 'BLACK' ? '#7FB0FF' : '#2563EB'
        : $color === 'BLACK' ? '#0B1220' : theme.colors.stoneWhiteBorder}; */
  box-shadow: ${({ $ghost }) =>
    $ghost ? 'none' : '0 2px 4px rgba(22, 33, 58, 0.35)'};
  opacity: ${({ $ghost }) => ($ghost ? 0.4 : 1)};
  transition: opacity ${({ theme }) => theme.transitions.fast};

  /* last-move marker */
  &::after {
    content: '';
    display: ${({ $last }) => ($last ? 'block' : 'none')};
    position: absolute;
    width: 100%;
    aspect-ratio: 1 / 1;
    scale: 45%;
    border-radius: 50%;
    background: ${({ $color }) => ($color === 'BLACK' ? '#7FB0FF' : '#2563EB')};
  }
`;

// const BandSvg = styled.svg`
//   position: absolute;
//   inset: 6%;
//   width: 88%;
//   height: 88%;
//   pointer-events: none;
//   overflow: visible;
// `;

const BandLayer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
`;

const BandDiv = styled.div<{
  $left: number;
  $top: number;
  $length: number;
  $thickness: number;
  $angle: number;
}>`
  position: absolute;
  left: ${({ $left }) => $left}%;
  top: ${({ $top }) => $top}%;
  width: ${({ $length }) => $length}%;
  height: ${({ $thickness }) => $thickness}%;
  transform: translateY(-50%) rotate(${({ $angle }) => $angle}deg);
  transform-origin: 0% 50%;

  border-radius: 999px;
  background-color: rgba(37, 99, 235, 0.15);
  overflow: hidden;
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='24' viewBox='0 0 20 24'%3E%3Cpath d='M0 4 L10 12 L0 20' stroke='%232563EB' stroke-width='16' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: repeat-x;
    background-size: 20px 100%;
    /* background-size: ${({ $thickness }) => $thickness * 10}px 100%; */
    animation: flow 0.6s linear infinite;
  }

  @keyframes flow {
    from { background-position: 0 0; }
    to   { background-position: 20px 0; }
  }
`;

// ── component ──────────────────────────────────────────────────────────────────

const Board = ({
  view,
  cursor,
  placeable,
  bands,
  color,
  phase,
  onActivate,
  onHover,
  onLeave,
}: BoardProps) => {
  const indices = useMemo(() => Array.from({ length: BOARD_CELLS }, (_, i) => i), []);

  return (
    <Frame>
      <Grid onMouseLeave={onLeave}>
        {indices.map((i) => {
          const t = view.tiles[i];
          const showGhostStone = cursor?.kind === 'stone' && cursor.pos === i;
          const showGhostCell = cursor?.kind === 'cell' && cursor.pos === i;
          const isPlaceable = placeable?.[i] === 1;
          return (
            <Tile
              key={i}
              onPointerDown={onActivate ? (e) => onActivate(i, e.pointerType) : undefined}
              onPointerMove={
                onHover ? (e) => { if (e.pointerType !== 'touch') onHover(i); } : undefined
              }
            >
              {/* <Lattice /> */}
              {t.hasCell && <Cell $initial={t.isInitial} $last={t.isLastCell && phase === 'STONE'} $win={t.isWin} />}
              {/* {t.tag && <Tag $color={t.tag} />} */}
              {isPlaceable && !t.hasCell && <Placeable $ghost={showGhostCell}/>}
              {/* {showGhostCell && color && <GhostCell $color={color} />} */}
              {t.stone && <Stone $color={t.stone} $last={t.isLastStone} />}
              {showGhostStone && color && !t.stone && (
                <Stone $color={color} $last={false} $ghost />
              )}
            </Tile>
          );
        })}
        {bands && bands.length > 0 && color && (
          <BandLayer>
            {bands.map((b, idx) => {
              const fr = toRow(b.from);
              const fc = toCol(b.from);
              const tr = toRow(b.to);
              const tc = toCol(b.to);

              const cellPct = 100 / N;
              const x1 = (fc + 0.5) * cellPct;
              const y1 = (fr + 0.5) * cellPct;
              const x2 = (tc + 0.5) * cellPct;
              const y2 = (tr + 0.5) * cellPct;

              const dx = x2 - x1;
              const dy = y2 - y1;
              const length = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx) * (180 / Math.PI);

              return (
                <BandDiv
                  key={idx}
                  $left={x1}
                  $top={y1}
                  $length={length}
                  $thickness={cellPct * 0.2}
                  $angle={angle}
                />
              );
            })}
          </BandLayer>
        )}
      </Grid>
      {/* {bands && bands.length > 0 && color && (
        <BandSvg viewBox={`0 0 ${N} ${N}`}>
          <defs>
            <linearGradient id="bandflow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2563EB" stopOpacity="0.15" />
              <stop offset="1" stopColor="#2563EB" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          {bands.map((b, idx) => {
            const fr = toRow(b.from);
            const fc = toCol(b.from);
            const tr = toRow(b.to);
            const tc = toCol(b.to);
            return (
              <line
                key={idx}
                x1={1 + 0.5}
                y1={1 + 0.5}
                x2={1 + 0.5}
                y2={10 + 0.5}
                stroke="url(#bandflow)"
                strokeWidth={0.28}
                strokeLinecap="round"
                strokeDasharray="0.35 0.3"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="0"
                  to="-0.65"
                  dur="0.6s"
                  repeatCount="indefinite"
                />
              </line>
            );
          })}
        </BandSvg>
      )} */}
    </Frame>
  );
};

export default Board;
