import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Stats {
  totalGames: number;
  wins: number;
  draws: number;
}

interface VsCpuStats {
  easy: Stats;
  medium: Stats;
  hard: Stats;
  engineVersion: string;
}

interface GameStore {
  // Session State (Persisted)
  vsCpuStats: VsCpuStats;
  twoPlayerStats: Stats;
  language: 'ko' | 'en';
  setLanguage: (lang: 'ko' | 'en') => void;
  resetHistory: () => void;
  startGame: (mode: 'VS_CPU' | 'VS_HUMAN', cpuDifficulty?: 'easy' | 'medium' | 'hard') => void;
  quitGame: () => void;

  // Current Game State
  status: 'IDLE' | 'PLAYING' | 'ENDED';
  mode: 'VS_CPU' | 'VS_HUMAN';
  cpuDifficulty: 'easy' | 'medium' | 'hard';
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      // Initial Session State
      vsCpuStats: {
        easy: { totalGames: 0, wins: 0, draws: 0 },
        medium: { totalGames: 0, wins: 0, draws: 0 },
        hard: { totalGames: 0, wins: 0, draws: 0 },
        engineVersion: '1.0.0',
      },
      twoPlayerStats: { totalGames: 0, wins: 0, draws: 0 },
      language: 'ko',
      setLanguage: (lang) => set({ language: lang }),
      resetHistory: () =>
        set((state) => {
          if (state.mode === 'VS_CPU' && state.status === 'PLAYING') {
            return {
              vsCpuStats: {
                ...state.vsCpuStats,
                [state.cpuDifficulty]: { totalGames: 1, wins: 0, draws: 0 },
              },
              twoPlayerStats: { totalGames: 0, wins: 0, draws: 0 },
            };
          }
          return {
            vsCpuStats: {
              easy: { totalGames: 0, wins: 0, draws: 0 },
              medium: { totalGames: 0, wins: 0, draws: 0 },
              hard: { totalGames: 0, wins: 0, draws: 0 },
              engineVersion: '1.0.0',
            },
            twoPlayerStats: { totalGames: 0, wins: 0, draws: 0 },
          };
        }),

      startGame: (mode: 'VS_CPU' | 'VS_HUMAN', cpuDifficulty?: 'easy' | 'medium' | 'hard') => {
        set({
          mode,
          cpuDifficulty: cpuDifficulty || 'hard',
          status: 'PLAYING',
        });
      },

      quitGame: () => {
        set({
          status: 'IDLE',
        });
      },

      // Initial Game State
      status: 'IDLE',
      mode: 'VS_CPU',
      cpuDifficulty: 'hard',
    }),
    {
      name: 'cellmoku-storage',
      partialize: (state) => ({
        vsCpuStats: state.vsCpuStats,
        twoPlayerStats: state.twoPlayerStats,
        language: state.language,
      }),
    }
  )
);
