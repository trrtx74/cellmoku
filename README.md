# Cellmoku (개척 오목)

보드가 동적으로 확장되는 변형 룰 오목을 플레이하는 정적 React 웹 앱.
말을 놓을 뿐 아니라, 획득한 칸으로 보드를 넓혀 나가며 5목을 노립니다.

- **CPU 대결** (난이도 하수/중수/고수) · **2인 대결**
- 데스크탑 / 모바일 / 키보드 조작 지원, 한국어·영어 토글
- 되돌리기(Z) · 다시 시작(R) · 난이도별 선/후공 전적

## 기술 스택
Vite · React 19 · TypeScript · styled-components · zustand · react-icons ·
@supabase/supabase-js (게임 로깅) · vitest (게임 코어 테스트)

## 개발
```bash
npm install
npm run dev          # 개발 서버 (http://localhost:5173/cellmoku/)
npm test             # 게임 코어 단위 테스트
npm run build        # 프로덕션 빌드 → docs/ (GitHub Pages 서빙)
```

`?debug=1` 쿼리로 접속하면 에이전트 튜닝용 디버그 패널이 뜹니다(프로덕션 포함).

## 구조
```
src/
  game/          순수 게임 로직 (React 무의존) — py_reference/env.py 이식, vitest로 고정
    types.ts     좌표·상태 타입
    rules.ts     K 계산·frontier·승리/무승부 판정
    engine.ts    턴 진행·리플레이·되돌리기 계산
    view.ts      렌더용 뷰 모델 (칸 소유자/태그)
    rules.test.ts
  components/     Board · GameBoard · Navbar · StartScreen · DifficultySelect ·
                 GameControls · HelpModal · DebugPanel
  store/         useGameStore.ts (zustand, persist)
  services/
    agent/       CPU 에이전트 — loadAgent()가 목/실 엔진 스위치 지점
    supabase.ts · gameLog.ts   게임 결과 로깅 (env 없으면 자동 비활성)
```

## CPU 에이전트
**실 엔진 통합 완료**: CNN(128ch 8블록, ONNX 9.6MB) + MCTS(턴당 stone/cell 이중
탐색) + VCF(threat 강제승 탐색) — `py_reference/`의 파이썬 구현을 1:1 포팅했으며
golden fixture(관측 인코딩·마스킹 softmax·policy/value)로 파이썬과 수치 일치를
검증합니다. `onnxruntime-web`(WASM EP)은 CPU 대전 시작 시에만 동적 로드되고,
모델/네트워크 로드 실패 시 휴리스틱 mock으로 자동 폴백합니다.

- 변환: `.venv/Scripts/python scripts/export_onnx.py` (.pt → ONNX, int8 자동 판정)
- 검증 fixture: `.venv/Scripts/python scripts/make_golden.py`
- 난이도 프리셋(sims/temperature/VCF)은 `src/services/agent/types.ts` —
  `?debug=1` 패널로 실시간 튜닝 후 확정

## 게임 로깅
게임 종료(승/무)·다시 시작·메뉴 이탈 시 Supabase에 기록합니다.
설정 방법은 [SUPABASE_SETUP.md](SUPABASE_SETUP.md) 참고. 환경변수가 없으면
로깅은 조용히 꺼지고 게임은 정상 동작합니다.
