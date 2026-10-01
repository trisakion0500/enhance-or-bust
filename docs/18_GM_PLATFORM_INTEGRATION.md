# 18_GM_PLATFORM_INTEGRATION.md

이전에 직접 개발한 별도 포트폴리오 프로젝트(GM 운영툴)인
[`gm_platform`](https://github.com/trisakion0500/gm_platform)과의 연동 — GM 운영자가 gm_platform 화면에서
이 서버(enhanceOrBust)의 플레이어 데이터를 조회할 수 있게 하는 전용 컨텍스트
(`src/contexts/gm/`)다.

## 작업 범위 원칙

**`gm_platform`의 소스는 이 프로젝트 작업 범위에서 절대 건드리지 않는다** — 읽기(레퍼런스
확인)나 그 서버의 살아있는 REST API 호출(데이터 등록/조회)만 허용되고, 파일 수정은 전부
이 레포(`enhanceOrBust`) 안에서만 이루어진다.

## 인증

세션 쿠키가 아니라 `X-API-Key` 헤더(`GM_PLATFORM_API_KEY` env, `gmApiKeyAuth.ts`가
`timingSafeEqual`로 비교)로 하며, 라우트별로 개별 적용한다 — `router.use()`로 걸지 않는
이유: 이 라우터가 프리픽스 없이 `app.use()`로 마운트되는 구조상, 다른 컨텍스트 라우터의
`router.use(requireAuth)`가 경로 매칭과 무관하게 먼저 걸려버리는 문제가 있었다. 그래서
`gmRoutes`를 다른 라우터보다 먼저 마운트하고, `gmApiKeyAuth`도 라우트별로 붙인다
(`server.ts`/`gmRoutes.ts` 주석 참고). 상세는 `09_AUTH_SECURITY.md`.

## 응답 규약

gm_platform의 apiExecution은 등록된 API를 항상 `POST {api_base_url}{endpoint}`로
호출하므로 조회 엔드포인트도 GET이 아니라 POST다. 응답도 gm_platform의 외부 API 규약
(`{ result, message, data: [...] }`, `data`는 항상 배열 — KEY_VALUE는 `data[0]`, GRID는
`data` 전체를 행 목록으로 사용)을 따른다. 에러 코드는 새 대역 10000번대(`GM`)를 쓴다.

## 구현된 엔드포인트

전체 목록/요청·응답 예시는 `17_GM_API.md` 참고. 요약:

- **플레이어 조회**: `POST /gm/get-player`(단건/전체, 최대 200명), `POST
  /gm/get-player-cards`(보유 카드, playerId 필수)
- **재화/카드 지급**: `POST /gm/grant-mail` — 골드/강화석/다이아/카드를 한 번에 우편으로
  지급한다(기존 보상 지급과 동일하게 Mailbox 경유, `sourceType: "gm_grant"`). `reason`(지급
  사유) 필수 — 플레이어에겐 노출 안 하고 감사 로그에만 남기며, actorId도 플레이어 본인이
  아니라 `"GM"` sentinel로 구분한다. 과거 한때 있었다가 지운 `GRANT_CURRENCY`/`GRANT_CARD`
  (status=0으로 중지)를 재화/카드 지급 하나로 통합한 버전 — **지급만 다루고 회수(차감)는
  다루지 않는다**(회수는 즉시반영이 필요한 별개 성격이라 범위 밖, 상세는 `17_GM_API.md`).
- **시드데이터(마스터데이터) 조회**: `master_*` 컬렉션 13종, 컬렉션당 엔드포인트 하나씩
  (`get-card-templates`/`get-grade-configs`/`get-enhancement-rules`/
  `get-synthesis-rules`/`get-stage-configs`/`get-stage-card-drops`/
  `get-random-box-grade-rate-def`/`get-random-box-grade-rate`/`get-random-box-custom-def`/
  `get-random-box-custom-pool`/`get-attendance-defs`/`get-attendance-rewards`/
  `get-attendance-catchup-prices`) — 서버가 이미 적재해둔 `masterDataCache` 싱글톤을 그대로
  읽어 반환한다(DB 재조회 없음). **13종 전부 저장 API가 있다**(아래).
- **카드 원형 저장**: `POST /gm/save-card-templates` — gm_platform이 `[기획]카드 데이터`
  API를 EDITABLE_GRID(`response_view_type=3`)로 바꾸며 행 추가/수정/삭제를 지원하게 돼
  먼저 도입했다. `data` 배열을 컬렉션의 최종 상태로 보는 전체 교체 방식(추가/수정은
  upsert, payload에서 빠진 기존 templateId는 삭제 후보)이다. 삭제 후보가 하나라도 아직
  참조 중이면(플레이어 보유 카드 / 스테이지 카드 드랍 / 출석 보상) 아무것도 쓰지 않고
  요청 전체를 새 에러 코드 `GM.REFERENCED_CANNOT_DELETE`(10003)로 거부한다 — 부분 반영
  시 어떤 행이 저장/스킵됐는지 gm_platform 화면에서 구분하기 어려워, 하나라도 걸리면
  전체를 되돌리는 쪽을 택했다. 상세는 `17_GM_API.md` "카드 원형 저장" 절.
- **등급 설정 저장**: `POST /gm/save-grade-configs` — `[기획]등급 설정` API도 EDITABLE_GRID로
  바꾸며 뒤이어 도입했다. `grade`가 `Grade` 타입 자체로 고정된 4종 리터럴(N/R/SR/SSR)이라
  카드 원형/강화 규칙과 달리 행을 추가/삭제할 수 없는 순수 upsert다 — payload는 항상 이
  4종을 정확히 하나씩만 포함해야 하고, 그 외는 `GM.VALIDATION_FAILED`(10000)로 거부한다.
  gm_platform 쪽 `grade` 컬럼도 카드 원형 저장 화면과 동일한 공통코드 그룹(`CARD_GRADE`)을
  참조하도록 등록했다. 상세는 `17_GM_API.md` "등급 설정 저장" 절.
- **강화 규칙 저장**: `POST /gm/save-enhancement-rules` — `[기획]강화 규칙` API도 같은
  이유로 EDITABLE_GRID로 바꾸며 뒤이어 도입했다. 전체 교체 방식은 카드 원형과 같지만, 이
  규칙은 다른 컬렉션이 ID로 참조하지 않아(강화 시도 시점에 목표 단계로 즉석 조회) 삭제
  가드가 없다 — 대신 자연키(`minTargetEnhancementLevel`) 중복과 구간 겹침(예: 1~10과
  5~8)을 GM.VALIDATION_FAILED(10000)로 막는다. 상세는 `17_GM_API.md` "강화 규칙 저장" 절.
- **합성 규칙 저장**: `POST /gm/save-synthesis-rules` — `[기획]합성 규칙` API도 EDITABLE_GRID로
  바꾸며 뒤이어 도입했다. 등급 설정과 같은 이유(고정된 리터럴 집합)로 순수 upsert다 — 등급
  승급(`sourceGrade` N/R/SR 각 하나, SSR은 상위 등급이 없어 제외)+강화 재료(싱글턴 1행),
  정확히 4행이어야 한다. `resultGrade`는 GAME_DESIGN.md 3절의 고정 순서(N→R→SR→SSR)를
  벗어나면 거부한다 — GM이 자유롭게 지정하게 두면 N 3장으로 SSR을 만드는 등 설계와 어긋난
  조합이 저장될 수 있어, materialCount/successRate만 튜닝 가능하게 하고 승급 경로는 코드로
  잠갔다(2026-09-30 AskUserQuestion으로 확인). gm_platform 쪽 `type` 컬럼은 공통코드 그룹
  `CRAFTING_RULES`를, `sourceGrade`/`resultGrade` 컬럼은 카드 원형/등급 설정과 동일한
  `CARD_GRADE`를 참조하도록 등록했다. 상세는 `17_GM_API.md` "합성 규칙 저장" 절.
- **스테이지 설정 저장**: `POST /gm/save-stage-configs` — `[기획]스테이지 설정` API도 같은
  이유로 EDITABLE_GRID로 바꾸며 뒤이어 도입했다. 전체 교체 방식은 카드 원형과 같고, 삭제
  후보의 `stageId`를 스테이지 카드 드랍(`master_stage_card_drops`)이 아직 참조 중이면
  GM.REFERENCED_CANNOT_DELETE(10003)로 거부하는 삭제 가드가 있다 — 스테이지 카드 드랍 저장이
  `stageId` 실재 여부를 검증하는 것과 같은 불변조건(고아 드랍 행 방지)을 반대 방향에서 지킨다.
  자연키는 `stageId` 단일 필드. 상세는 `17_GM_API.md` "스테이지 설정 저장" 절.
- **스테이지 카드 드랍 저장**: `POST /gm/save-stage-card-drops` — `[기획]스테이지 카드 드랍`
  API도 같은 이유로 EDITABLE_GRID로 바꾸며 뒤이어 도입했다. 전체 교체 방식/삭제 가드 없음은
  강화 규칙과 동일하지만, 자연키가 `(stageId, templateId)` 복합키이고 stageId는
  `master_stage_configs`에, templateId는 `master_card_templates`에 실제로 있는 값이어야
  한다(고아 드랍 행 방지) — 하나라도 없으면 GM.VALIDATION_FAILED(10000)로 거부한다. 상세는
  `17_GM_API.md` "스테이지 카드 드랍 저장" 절.
- **랜덤박스 저장**(4종, gm_platform 화면 메뉴 4개로 분리): `POST
  /gm/save-random-box-grade-rate-def`(등급비율 상자 정의) / `POST
  /gm/save-random-box-grade-rate`(상자별 등급 확률, `boxId`별 rate 합=100 검증) / `POST
  /gm/save-random-box-custom-def`(커스텀 상자 정의) / `POST
  /gm/save-random-box-custom-pool`(상자별 원형 가중치). 정의 2종(`-grade-rate-def`/
  `-custom-def`)은 카드 원형과 동일한 전체 교체+삭제 가드(각각 확률/가중치 행이 아직
  참조 중이면 GM.REFERENCED_CANNOT_DELETE)다. 확률/가중치 2종(`-grade-rate`/`-custom-pool`)은
  스테이지 카드 드랍과 동일하게 전체 교체(삭제 가드 없음)이며, 상위 `boxId`가 정의 컬렉션에
  실재해야 한다(고아 행 방지). `grade` 값은 등급을 코드에 고정하지 않는 설계라 어떤 문자열이든
  허용한다 — 카드 원형/등급 설정의 `CARD_GRADE` 공통코드와 달리 gm_platform 쪽에도 코드 그룹을
  연결하지 않았다. 상세는 `17_GM_API.md` "랜덤박스 저장" 절.
- **출석부 저장**(gm_platform 화면에서 메뉴 3개로 분리): `POST /gm/save-attendance-def`(정의,
  `id` 유무로 신규/수정) → `POST /gm/save-attendance-rewards`(하루 단위 보상, 수량 입력칸) →
  `POST /gm/save-attendance-catchup-prices`(회차 단위 가격). 이미 시작된 출석부는 수정 불가,
  gm_platform에는 3개 모두 승인 필요로 등록했다. 상세는 `17_GM_API.md` "출석부 저장 (3단계)"
  절과 `23_GAME_DESIGN_ATTENDANCE.md` 참고.
- **유저고유번호(playerId)별 감사 로그 조회**: 감사 로그 6종을 컬렉션당 엔드포인트로
  분리(`get-auth-logs`/`get-enhancement-logs`/`get-synthesis-logs`/
  `get-battle-stage-logs`/`get-mailbox-logs`/`get-attendance-logs`). `playerId` 필수,
  `fromDate`/`toDate`로 기간 필터.

## 왜 컬렉션당 엔드포인트를 따로 두는가

컬렉션마다 행 모양이 완전히 달라(카드 원형 vs 스테이지 설정 등) gm_platform의 그리드
컬럼 스키마(`api_response`)가 API 하나당 하나로 고정되는 구조와 맞지 않아, 파라미터
하나로 여러 모양을 분기하는 API 하나 대신 컬렉션당 엔드포인트를 따로 둔다 — 시드데이터
6종과 감사 로그 5종 모두 이 원칙을 동일하게 따른다.

## `changes` 필드 평탄화

재화 지급/차감 API는 한때 구현했다가 삭제했다(gm_platform 쪽엔 하드삭제가 없어
`status=0`으로 중지 처리) — 지급은 이후 `grant-mail`(위 "구현된 엔드포인트" 절)로 다시
도입됐고, 차감(회수)은 여전히 없다. `changes` 필드는 같은 컬렉션 안에서도 액션마다(예:
log_synthesis의 gradeUpgrade/enhanceMaterial) 모양이 달라 gm_platform 그리드가 원본
객체를 `[object Object]`로 렌더링하는 문제가 있었다 — `getPlayerForGm()`의
`economy.gold` 평탄화와 같은 원리로 `gmService.ts`의 `flattenChanges()`가 중첩 객체를
점(`.`) 표기 키(`changes.cardId`, `changes.attachments.gold`처럼 필요하면 재귀적으로)로
풀어서 반환하도록 고쳤다(필드 종류가 컬렉션/액션마다 달라 수동 나열 대신 재귀 함수로
일반화 — 배열은 그리드 셀에 콤마 목록으로 표시돼도 무방해 더 내려가지 않는다).
gm_platform 쪽 응답 컬럼도 기존 `changes` 컬럼은 `status=0`으로 비활성화하고, 컬렉션별
실제 `changes.*` 필드에 맞는 컬럼을 새로 등록했다.
