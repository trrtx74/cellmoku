import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase 접속 정보는 빌드 시점의 환경변수에서 읽어옵니다.
// publishable key는 공개되어도 무방한 값이며(정적 사이트 번들에 포함됨),
// 실제 보안은 Supabase 대시보드의 RLS(행 수준 보안) 정책으로 강제합니다.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

// 환경변수가 없으면 클라이언트를 만들지 않습니다.
// 이 경우 게임 기록 저장은 조용히 비활성화되고, 게임 플레이에는 영향이 없습니다.
export const supabase: SupabaseClient | null =
  url && publishableKey ? createClient(url, publishableKey) : null;

if (!supabase && import.meta.env.DEV) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not configured.'
  );
}
