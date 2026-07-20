import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GameState, Player, Pos, Turn, Draft } from '../game/types';
import {
  initialState,
  applyStone,
  applyCell,
  rebuild,
  planUndo,
  canUndo as engineCanUndo,
  type Mode,
} from '../game/engine';
import { colorOf, type Color } from '../game/view';
import { frontierMask } from '../game/rules';
import { presetFor, type AgentConfig } from '../services/agent/types';
import { logGameResult } from '../services/gameLog';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Status = 'IDLE' | 'DIFFICULTY_SELECT' | 'PLAYING' | 'ENDED';

// losses are derived: played - wins - draws
interface SideStats {
  played: number;
  wins: number;
  draws: number;
}
interface DifficultyStats {
  asFirst: SideStats; // human played black (first)
  asSecond: SideStats; // human played white (second)
}
type VsCpuStats = Record<Difficulty, DifficultyStats> & { engineVersion: string };

const ENGINE_VERSION = '1.0.0+s3i900';

const emptySide = (): SideStats => ({ played: 0, wins: 0, draws: 0 });
const emptyDiff = (): DifficultyStats => ({ asFirst: emptySide(), asSecond: emptySide() });
const emptyVsCpu = (): VsCpuStats => ({
  easy: emptyDiff(),
  medium: emptyDiff(),
  hard: emptyDiff(),
  engineVersion: ENGINE_VERSION,
});

const humanPlayer = (c: Color): Player => (c === 'BLACK' ? 1 : 2);

interface GameStore {
  // ── persisted ──
  vsCpuStats: VsCpuStats;
  twoPlayerGamesStarted: number;
  language: 'ko' | 'en';

  // ── session ──
  status: Status;
  mode: Mode;
  cpuDifficulty: Difficulty;
  humanColor: Color; // VS_CPU: which color the human plays
  game: GameState;
  turns: Turn[];
  draft: Draft | null;
  cursorPos: Pos | null;
  undoCount: number;
  cpuThinking: boolean;
  lastCpuMs: number | null;

  // ── debug tuning (persisted) ──
  agentConfig: AgentConfig;

  // ── actions ──
  setLanguage: (lang: 'ko' | 'en') => void;
  resetStats: () => void;
  setAgentConfig: (patch: Partial<AgentConfig>) => void;
  resetAgentConfig: () => void;
  setLastCpuMs: (ms: number) => void;
  startGame: (mode: Mode) => void;
  chooseDifficulty: (d: Difficulty) => void;
  setCursor: (pos: Pos | null) => void;
  activate: (pos: Pos) => void;
  applyAgentTurn: (stone: Pos, cells: Pos[]) => void;
  setCpuThinking: (v: boolean) => void;
  undo: () => void;
  restart: () => void;
  quitGame: () => void;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      /** Record the finished game's result into stats (VS_CPU only). */
      function recordResult(winner: Player | 'DRAW') {
        const { mode, cpuDifficulty, humanColor, vsCpuStats } = get();
        if (mode !== 'VS_CPU') return;
        const sideKey = humanColor === 'BLACK' ? 'asFirst' : 'asSecond';
        const next = structuredCloneStats(vsCpuStats);
        const side = next[cpuDifficulty][sideKey];
        if (winner === 'DRAW') side.draws += 1;
        else if (winner === humanPlayer(humanColor)) side.wins += 1;
        // loss: no increment (already counted in `played` at start)
        set({ vsCpuStats: next });
      }

      /** True if `pos` is a legal move in the current phase. */
      function isLegal(game: GameState, pos: Pos): boolean {
        if (game.phase === 'STONE') {
          return game.cells[pos] === 1 && game.stones[pos] === 0;
        }
        return frontierMask(game.cells)[pos] === 1;
      }

      /** Fire-and-forget a game record to Supabase (no-op if env unset). */
      function sendGameRecord(endReason: 'WIN' | 'DRAW' | 'RESTART' | 'QUIT') {
        const s = get();
        const w = s.game.winner;
        const winner = w === 1 ? 'BLACK' : w === 2 ? 'WHITE' : w === 'DRAW' ? 'DRAW' : null;
        void logGameResult({
          mode: s.mode,
          cpu_difficulty: s.mode === 'VS_CPU' ? s.cpuDifficulty : null,
          engine_version: s.mode === 'VS_CPU' ? s.vsCpuStats.engineVersion : null,
          winner,
          end_reason: endReason,
          human_color: s.mode === 'VS_CPU' ? s.humanColor : null,
          starting_player: 'BLACK',
          stone_count: s.turns.length + (s.draft ? 1 : 0),
          undo_count: s.undoCount,
          language: s.language,
          history: s.turns,
        });
      }

      /** Apply a single move (stone or cell) to the live state, committing turns. */
      function stepMove(pos: Pos) {
        const { game, turns, draft } = get();
        if (game.winner) return;
        if (!isLegal(game, pos)) return;

        if (game.phase === 'STONE') {
          const newDraft: Draft = { player: game.currentPlayer, stone: pos, cells: [] };
          const next = applyStone(game, pos);
          if (next.phase !== 'CELL' || next.winner) {
            set({ game: next, turns: [...turns, newDraft], draft: null });
          } else {
            set({ game: next, draft: newDraft });
          }
        } else {
          if (!draft) return;
          const newDraft: Draft = { ...draft, cells: [...draft.cells, pos] };
          const next = applyCell(game, pos);
          if (next.phase !== 'CELL') {
            set({ game: next, turns: [...get().turns, newDraft], draft: null });
          } else {
            set({ game: next, draft: newDraft });
          }
        }

        const ended = get().game.winner;
        if (ended) {
          set({ status: 'ENDED', cursorPos: null, cpuThinking: false });
          recordResult(ended);
          sendGameRecord(ended === 'DRAW' ? 'DRAW' : 'WIN');
        }
      }

      return {
        vsCpuStats: emptyVsCpu(),
        twoPlayerGamesStarted: 0,
        language: 'ko',

        status: 'IDLE',
        mode: 'VS_CPU',
        cpuDifficulty: 'hard',
        humanColor: 'BLACK',
        game: initialState(),
        turns: [],
        draft: null,
        cursorPos: null,
        undoCount: 0,
        cpuThinking: false,
        lastCpuMs: null,

        agentConfig: presetFor('hard'),

        setLanguage: (lang) => set({ language: lang }),

        resetStats: () =>
          set({ vsCpuStats: emptyVsCpu(), twoPlayerGamesStarted: 0 }),

        setAgentConfig: (patch) =>
          set({ agentConfig: { ...get().agentConfig, ...patch } }),

        resetAgentConfig: () =>
          set({ agentConfig: presetFor(get().cpuDifficulty) }),

        setLastCpuMs: (ms) => set({ lastCpuMs: ms }),

        startGame: (mode) => {
          if (mode === 'VS_CPU') {
            set({ mode, status: 'DIFFICULTY_SELECT' });
          } else {
            set({
              mode,
              status: 'PLAYING',
              game: initialState(),
              turns: [],
              draft: null,
              cursorPos: null,
              undoCount: 0,
              cpuThinking: false,
              twoPlayerGamesStarted: get().twoPlayerGamesStarted + 1,
            });
          }
        },

        chooseDifficulty: (d) => {
          const stats = get().vsCpuStats[d];
          const started = stats.asFirst.played + stats.asSecond.played;
          const humanColor: Color = started % 2 === 0 ? 'BLACK' : 'WHITE';

          // pre-count this game (mid-quit counts as a loss)
          const next = structuredCloneStats(get().vsCpuStats);
          next[d][humanColor === 'BLACK' ? 'asFirst' : 'asSecond'].played += 1;

          set({
            mode: 'VS_CPU',
            cpuDifficulty: d,
            humanColor,
            vsCpuStats: next,
            status: 'PLAYING',
            game: initialState(),
            turns: [],
            draft: null,
            cursorPos: null,
            undoCount: 0,
            cpuThinking: humanColor === 'WHITE', // CPU (black) moves first
          });
        },

        setCursor: (pos) => set({ cursorPos: pos }),

        activate: (pos) => {
          const { status, mode, game, humanColor, cpuThinking } = get();
          if (status !== 'PLAYING' || game.winner) return;
          if (mode === 'VS_CPU') {
            if (cpuThinking) return;
            if (game.currentPlayer !== humanPlayer(humanColor)) return;
          }
          stepMove(pos);
        },

        applyAgentTurn: (stone, cells) => {
          // CPU plays a full turn: stone then each earned cell.
          stepMove(stone);
          for (const c of cells) {
            if (get().game.phase !== 'CELL') break;
            stepMove(c);
          }
          set({ cpuThinking: false });
        },

        setCpuThinking: (v) => set({ cpuThinking: v }),

        undo: () => {
          const { turns, draft, mode, status } = get();
          if (status !== 'PLAYING') return;
          const plan = planUndo(turns, draft, mode);
          if (!plan) return;
          const game = rebuild(plan.turns, plan.draft);
          set({
            turns: plan.turns,
            draft: plan.draft,
            game,
            cursorPos: null,
            undoCount: get().undoCount + 1,
          });
        },

        restart: () => {
          const { mode, cpuDifficulty, status } = get();
          if (status === 'PLAYING') sendGameRecord('RESTART'); // abandon current game
          if (mode === 'VS_CPU') {
            get().chooseDifficulty(cpuDifficulty);
          } else {
            get().startGame('VS_HUMAN');
          }
        },

        quitGame: () => {
          if (get().status === 'PLAYING') sendGameRecord('QUIT'); // abandon current game
          set({
            status: 'IDLE',
            game: initialState(),
            turns: [],
            draft: null,
            cursorPos: null,
            cpuThinking: false,
          });
        },
      };
    },
    {
      name: 'cellmoku-storage',
      partialize: (state) => ({
        vsCpuStats: state.vsCpuStats,
        twoPlayerGamesStarted: state.twoPlayerGamesStarted,
        language: state.language,
        agentConfig: state.agentConfig,
      }),
    }
  )
);

// selectors / helpers exported for components
export const canUndoNow = (s: GameStore): boolean =>
  s.status === 'PLAYING' &&
  !(s.mode === 'VS_CPU' && s.cpuThinking) &&
  engineCanUndo(s.turns, s.draft, s.mode);

export const cpuColor = (s: Pick<GameStore, 'humanColor'>): Color =>
  s.humanColor === 'BLACK' ? 'WHITE' : 'BLACK';

export { colorOf, humanPlayer };
export type { Color };

function structuredCloneStats(v: VsCpuStats): VsCpuStats {
  return {
    easy: cloneDiff(v.easy),
    medium: cloneDiff(v.medium),
    hard: cloneDiff(v.hard),
    engineVersion: v.engineVersion,
  };
}
function cloneDiff(d: DifficultyStats): DifficultyStats {
  return {
    asFirst: { ...d.asFirst },
    asSecond: { ...d.asSecond },
  };
}
