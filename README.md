# 구역카드 관리 웹앱

회중 구역카드(봉사카드) 진행 관리용 모바일 웹앱입니다.
Supabase(DB/인증) + React(Vite) + GitHub Pages(호스팅).

## 주요 기능

- **봉사 기록** (전도인): 카드 검색 → 인도자/이름/날짜 선택 → 방문한 집 탭하여 체크,
  집별 주의사항(방문거절 등) 설정
- **인도자**: 현재 회차 추천 카드(번호 낮은 순, 집수 표시), 카드별 1~4회차 진행률,
  전도인 배정/회수
- **관리자**: 카드 초기화(1~4회차 기록/배정 삭제) — 관리자 계정으로 로그인해야 보임
- **큰 글씨 모드**: 화면 위 버튼으로 일반/큰 글씨 전환 (기기에 저장됨)

## 개발

```bash
npm install
npm run dev     # 로컬 개발 서버
npm run build   # dist/ 에 빌드
```

`src/config.ts` 에 Supabase URL과 anon key를 넣어야 동작합니다.

## 배포

main 브랜치에 push하면 GitHub Actions가 자동으로 빌드해서 GitHub Pages로 배포합니다.
(저장소 Settings → Pages → Source를 "GitHub Actions"로 설정 필요)

## DB

스키마/데이터 적재 SQL은 별도 폴더(supabase/)에서 관리하며 이 저장소에는 포함하지
않습니다 (개인정보 보호).
