import { supabase } from './supabase';

// 익명 클라이언트 식별자: 개인정보 없이 "같은 브라우저에서 온 기록"인지만 구분합니다.
const CLIENT_ID_KEY = 'cellmoku-client-id';

function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export interface GameRecord {
  mode: 'VS_CPU' | 'VS_HUMAN';
  cpu_difficulty: 'easy' | 'medium' | 'hard' | null;
  engine_version: string | null;
  winner: 'BLACK' | 'WHITE' | 'DRAW' | null; // null = 중단(quit/restart 중)
  end_reason: 'WIN' | 'DRAW' | 'RESTART' | 'QUIT';
  human_color: 'BLACK' | 'WHITE' | null; // VS_CPU에서 사람의 색
  starting_player: 'BLACK' | 'WHITE';
  stone_count: number; // 총 착수 수
  undo_count: number;
  language: string;
  // 전체 진행 로그(수 분석용). Supabase에서는 jsonb 컬럼에 저장.
  history: unknown;
}

/**
 * 게임 결과를 Supabase에 저장합니다.
 * 네트워크 오류 등이 나도 게임 흐름을 절대 막지 않도록 완전히 격리합니다.
 */
export async function logGameResult(record: GameRecord): Promise<void> {
  if (!supabase) return; // 환경변수 미설정 시 조용히 무시

  try {
    const { error } = await supabase.from('cellmoku_games').insert({
      ...record,
      client_id: getClientId(),
    });
    if (error && import.meta.env.DEV) {
      console.warn('[supabase] 게임 기록 저장 실패:', error.message);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[supabase] 게임 기록 저장 중 예외:', e);
    }
  }
}
