# 19_FRONTEND.md

`public/` 아래, 빌드 스텝 없이 브라우저가 그대로 읽는 순수 ES 모듈 + 플레인 CSS. 카드
이미지/애니메이션은 만들지 않는다(GAME_DESIGN.md "최소 UI" 원칙 — 전투 결과는 텍스트/
숫자 중심).

## 화면 구성

싱글 페이지(SPA-lite) — 라우팅 라이브러리 없이 로그인 후 JS로 섹션만 토글한다.

```
loginScreen     구글/페이스북 로그인 버튼
registerScreen  닉네임 입력 폼(신규 가입, 디폴트는 플랫폼 제공 닉네임)
gameScreen
  header        닉네임/골드/강화석/다이아/clearedStage/로그아웃
  nav (탭)      인벤토리 / 강화 / 합성 / 전투 / 우편함
  tabPanel × 5  선택된 탭만 보이고 나머지는 hidden
```

`GET /player/me` 하나로 로그인 여부 확인과 게임 화면 초기 데이터(재화/clearedStage/
보유 카드)를 겸한다 — 별도 whoami 엔드포인트 없음.

## JS 모듈 매핑 (바운디드 컨텍스트 1:1 대응)

| 파일 | 대응 컨텍스트/역할 |
|---|---|
| `public/js/api.js` | 공용 `fetch` 래퍼(`credentials:"include"` 고정, JSON 파싱, 비정상 응답은 `{status, result, message}`로 throw) + `escapeHtml()`(XSS 방어) |
| `public/js/app.js` | 진입점 — 로그인 초기화(GIS/Authorization Code), 로드 시 `GET /player/me`로 로그인/게임 화면 분기, 탭 전환, 공유 `state.player` + `refreshPlayer()` |
| `public/js/inventory.js` | Inventory — 보유 카드 표 렌더(등급/공격/체력/속성/레벨/EXP/강화단계) |
| `public/js/enhancement.js` | Enhancement — 카드별 강화 버튼, 성공/실패/파괴 결과 텍스트 표시 |
| `public/js/synthesis.js` | Synthesis — 등급 승급 합성 + 강화 재료 합성 두 폼(체크박스 선택 시 남은 장수/성공률/비용 힌트 갱신) |
| `public/js/battle.js` | Battle-Stage — 스테이지 번호 입력 + 인벤토리에서 최대 `squadMaxSize`장 체크박스 스쿼드 선택 + 도전 버튼 → 라운드 로그/승패/보상 텍스트 표시 |
| `public/js/mailbox.js` | Mailbox — 목록 + 수령/삭제 버튼, 실패(특히 7004 인벤토리 초과) 메시지 표시 |

- 상태를 바꾸는 액션(강화/합성/전투 도전/우편 수령) 뒤에는 `app.js`의
  `refreshPlayer()` 하나가 헤더/인벤토리/전투/우편함 패널을 전부 다시 그린다 — 각
  패널이 따로 로컬 상태를 들고 있지 않다.
- 합성 규칙(소재 장수/성공률/골드)은 프론트에 하드코딩하지 않고 `GET /player/me`
  응답의 `synthesisRules`(마스터 데이터, `squadMaxSize`와 동일 패턴)를 그대로 쓴다 —
  최종 검증은 항상 서버가 한다(서버 권위 원칙).
- `innerHTML`로 동적 값을 꽂는 모든 지점은 `api.js`의 `escapeHtml()`로 이스케이프한다
  (`09_AUTH_SECURITY.md` "웹 취약점 방어" 참고).

## 정적 자산

`public/favicon*.png`/`favicon.ico`/`apple-touch-icon.png` — 표준 favicon 세트.
`public/css/style.css` — 레이아웃/여백 정도의 최소 스타일, 장식 없음.
