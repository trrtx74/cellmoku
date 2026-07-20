import { useMemo, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useGameStore } from '../store/useGameStore';
import { N, toRow, toCol, inBounds, toPos, type Pos } from '../game/types';
import { frontierMask } from '../game/rules';
import { buildBoardView, cellOwners, colorOf } from '../game/view';
import Board, { type CursorView, type Band } from './Board';
import { GameControls } from './GameControls';
import { loadAgent, type CellmokuAgent } from '../services/agent';
import { presetFor } from '../services/agent/types';

// const DEBUG = import.meta.env.DEV;
const DEBUG = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BoardContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 16px;
  gap: 14px;
  position: relative;

  @media (max-width: 768px) {
    justify-content: end;
    padding-bottom: 80px;
  }
`;

const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const Dot = styled.span<{ $color: 'BLACK' | 'WHITE' }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${({ theme, $color }) =>
    $color === 'BLACK' ? theme.colors.stoneBlack : theme.colors.stoneWhite};
  border: 1.5px solid
    ${({ theme, $color }) =>
      $color === 'BLACK' ? '#0B1220' : theme.colors.stoneWhiteBorder};
`;

const ResultOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: rgba(245, 248, 252, 0.82);
  backdrop-filter: blur(3px);
  z-index: 20;
`;

const ResultText = styled.div`
  font-size: 2.4rem;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.primary};
`;

const ResultButton = styled.button`
  padding: 14px 28px;
  font-size: 1.2rem;
  font-weight: 700;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  border-radius: 14px;
  transition: ${({ theme }) => theme.transitions.fast};
  &:hover {
    background: ${({ theme }) => theme.colors.primaryHover};
  }
`;

// 8 directions for band detection
const DIRS_8 = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
] as const;

const GameBoard = () => {
  const {
    game, turns, draft, status, mode, humanColor, cpuThinking, language,
    cpuDifficulty, agentConfig, cursorPos,
    activate, setCursor, undo, restart, quitGame, applyAgentTurn, setCpuThinking,
    setLastCpuMs,
  } = useGameStore();

  // ── CPU agent (VS_CPU) ──
  const agentRef = useRef<CellmokuAgent | null>(null);
  const ensureAgent = useCallback((): CellmokuAgent => {
    if (!agentRef.current) agentRef.current = loadAgent(cpuDifficulty);
    return agentRef.current;
  }, [cpuDifficulty]);

  // preload the agent when a CPU game starts (so it's ready while the human thinks)
  useEffect(() => {
    agentRef.current = null;
    if (mode === 'VS_CPU' && status === 'PLAYING') ensureAgent();
  }, [mode, status, cpuDifficulty, ensureAgent]);

  // drive the CPU's turn (atomic: one think delay, then stone + all cells)
  useEffect(() => {
    if (mode !== 'VS_CPU' || status !== 'PLAYING' || game.winner) return;
    const cpuPlayer = humanColor === 'BLACK' ? 2 : 1;
    if (game.currentPlayer !== cpuPlayer || game.phase !== 'STONE') return;

    let cancelled = false;
    setCpuThinking(true);
    (async () => {
      const agent = ensureAgent();
      await agent.ready;
      const cfg = DEBUG ? agentConfig : presetFor(cpuDifficulty);
      const cur = useGameStore.getState().game;
      const t0 = performance.now();
      const move = await agent.getMove(cur, cfg);
      const elapsed = performance.now() - t0;
      if (DEBUG) setLastCpuMs(Math.round(elapsed));
      // pad instant (VCF / tiny-sims) moves up to a natural think pause
      await sleep(Math.max(0, 500 - elapsed));
      if (cancelled) return;
      applyAgentTurn(move.stone, move.cells);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, humanColor, cpuDifficulty, game.currentPlayer, game.phase, game.winner]);

  const isLegalPos = useCallback(
    (pos: Pos): boolean => {
      if (game.phase === 'STONE') return game.cells[pos] === 1 && game.stones[pos] === 0;
      return frontierMask(game.cells)[pos] === 1;
    },
    [game],
  );

  const view = useMemo(
    () => buildBoardView(game, cellOwners(turns, draft)),
    [game, turns, draft],
  );

  const placeable = useMemo(
    () => (game.phase === 'CELL' && !game.winner ? frontierMask(game.cells) : null),
    [game],
  );

  const activeColor = colorOf(game.currentPlayer);

  const isHumanTurn =
    mode === 'VS_HUMAN' ||
    (!cpuThinking && game.currentPlayer === (humanColor === 'BLACK' ? 1 : 2));

  // cursor ghost + bands (only shown on a legal target)
  const cursor: CursorView | null = useMemo(() => {
    if (cursorPos == null || game.winner || !isHumanTurn) return null;
    if (!isLegalPos(cursorPos)) return null;
    return { pos: cursorPos, kind: game.phase === 'STONE' ? 'stone' : 'cell', color: activeColor };
  }, [cursorPos, game.phase, game.winner, activeColor, isHumanTurn, isLegalPos]);

  const bands: Band[] = useMemo(() => {
    if (cursorPos == null || game.phase !== 'STONE' || game.winner || !isHumanTurn) return [];
    if (game.cells[cursorPos] !== 1 || game.stones[cursorPos] !== 0) return [];
    const r = toRow(cursorPos);
    const c = toCol(cursorPos);
    const out: Band[] = [];
    for (const [dr, dc] of DIRS_8) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && game.stones[toPos(nr, nc)] === game.currentPlayer) {
        out.push({ from: toPos(nr, nc), to: cursorPos });
      }
    }
    return out;
  }, [cursorPos, game, isHumanTurn]);

  const handleActivate = (pos: Pos, pointerType: string) => {
    if (!isHumanTurn) return;
    if (pointerType === 'touch') {
      // first tap moves the cursor, second tap on the same cell places
      if (cursorPos === pos) {activate(pos); setCursor(null);}
      else setCursor(pos);
    } else {
      {activate(pos); setCursor(null);}
    }
  };

  const handleHover = (pos: Pos) => {
    if (!isHumanTurn) return;
    setCursor(pos);
  };

  // ── keyboard controls ──
  const confirmRestart = useCallback(() => {
    const msg = language === 'ko' ? '다시 시작하시겠습니까?' : 'Restart the game?';
    if (window.confirm(msg)) restart();
  }, [language, restart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'r') { e.preventDefault(); confirmRestart(); return; }
      if (key === 'z') { e.preventDefault(); undo(); return; }
      if (status !== 'PLAYING' || game.winner || !isHumanTurn) return;

      const move = (dr: number, dc: number) => {
        e.preventDefault();
        const base = cursorPos ?? game.lastStonePos ?? toPos(N >> 1, N >> 1);
        const nr = Math.min(N - 1, Math.max(0, toRow(base) + dr));
        const nc = Math.min(N - 1, Math.max(0, toCol(base) + dc));
        setCursor(toPos(nr, nc));
      };
      switch (key) {
        case 'arrowup': case 'w': move(-1, 0); break;
        case 'arrowdown': case 's': move(1, 0); break;
        case 'arrowleft': case 'a': move(0, -1); break;
        case 'arrowright': case 'd': move(0, 1); break;
        case 'enter': case ' ':
          e.preventDefault();
          if (cursorPos != null) activate(cursorPos);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, game, isHumanTurn, cursorPos, activate, setCursor, undo, confirmRestart]);

  // ── status text ──
  const phaseText = (() => {
    if (game.winner) return '';
    if (!isHumanTurn) return language === 'ko' ? 'CPU가 생각 중…' : 'CPU is thinking…';
    if (game.phase === 'STONE') {
      return language === 'ko' ? '말을 놓을 위치를 선택하세요' : 'Place a stone';
    }
    const left = game.remainingK;
    return language === 'ko'
      ? `획득한 칸 배치 (${left}개 남음)`
      : `Place earned cells (${left} left)`;
  })();

  const resultText = (() => {
    if (!game.winner) return '';
    if (game.winner === 'DRAW') return language === 'ko' ? '무승부' : 'Draw';
    if (mode === 'VS_CPU') {
      const humanWon = game.winner === (humanColor === 'BLACK' ? 1 : 2);
      return humanWon
        ? (language === 'ko' ? '승리!' : 'You win!')
        : (language === 'ko' ? '패배' : 'You lose');
    }
    const who = game.winner === 1 ? (language === 'ko' ? '흑' : 'Black') : (language === 'ko' ? '백' : 'White');
    return language === 'ko' ? `${who} 승리` : `${who} wins`;
  })();

  return (
    <BoardContainer>

      <GameControls />

      <StatusBar>
        {!game.winner && <Dot $color={activeColor} />}
        <span>{phaseText}</span>
      </StatusBar>

      <Board
        view={view}
        cursor={cursor}
        placeable={placeable}
        bands={bands}
        color={activeColor}
        phase={game.phase}
        onActivate={handleActivate}
        onHover={handleHover}
        onLeave={() => setCursor(null)}
      />
      
      {status === 'ENDED' && (
        <ResultOverlay>
          <ResultText>{resultText}</ResultText>
          <div style={{ display: 'flex', gap: 12 }}>
            <ResultButton onClick={restart}>
              {language === 'ko' ? '다시 시작' : 'Play again'}
            </ResultButton>
            <ResultButton onClick={quitGame} style={{ background: '#64748B' }}>
              {language === 'ko' ? '메뉴로' : 'Menu'}
            </ResultButton>
          </div>
        </ResultOverlay>
      )}
    </BoardContainer>
  );
};

export default GameBoard;
