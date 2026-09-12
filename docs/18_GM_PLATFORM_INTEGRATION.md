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
- **시드데이터(마스터데이터) 조회**: `master_*` 컬렉션 6종, 컬렉션당 엔드포인트 하나씩
  (`get-card-templates`/`get-grade-configs`/`get-enhancement-rules`/
  `get-synthesis-rules`/`get-stage-configs`/`get-stage-card-drops`) — 서버가 이미 적재해둔
  `masterDataCache` 싱글톤을 그대로 읽어 반환한다(DB 재조회 없음). **1차는 조회만
  지원하고 수정/삭제는 아직 없다** — 마스터데이터는 잘못 저장되면 게임 전체 밸런스에
  영향을 줘서, 저장 기능은 컬렉션별 값 검증(확률 0~1, 음수 불가 등) 설계를 먼저 한 뒤
  별도로 추가하기로 함.
- **유저고유번호(playerId)별 감사 로그 조회**: 감사 로그 5종을 컬렉션당 엔드포인트로
  분리(`get-auth-logs`/`get-enhancement-logs`/`get-synthesis-logs`/
  `get-battle-stage-logs`/`get-mailbox-logs`). `playerId` 필수, `fromDate`/`toDate`로
  기간 필터.

## 왜 컬렉션당 엔드포인트를 따로 두는가

컬렉션마다 행 모양이 완전히 달라(카드 원형 vs 스테이지 설정 등) gm_platform의 그리드
컬럼 스키마(`api_response`)가 API 하나당 하나로 고정되는 구조와 맞지 않아, 파라미터
하나로 여러 모양을 분기하는 API 하나 대신 컬렉션당 엔드포인트를 따로 둔다 — 시드데이터
6종과 감사 로그 5종 모두 이 원칙을 동일하게 따른다.

## `changes` 필드 평탄화

재화 지급/차감 API는 한때 구현했다가 삭제했다(gm_platform 쪽엔 하드삭제가 없어
`status=0`으로 중지 처리). `changes` 필드는 같은 컬렉션 안에서도 액션마다(예:
log_synthesis의 gradeUpgrade/enhanceMaterial) 모양이 달라 gm_platform 그리드가 원본
객체를 `[object Object]`로 렌더링하는 문제가 있었다 — `getPlayerForGm()`의
`economy.gold` 평탄화와 같은 원리로 `gmService.ts`의 `flattenChanges()`가 중첩 객체를
점(`.`) 표기 키(`changes.cardId`, `changes.attachments.gold`처럼 필요하면 재귀적으로)로
풀어서 반환하도록 고쳤다(필드 종류가 컬렉션/액션마다 달라 수동 나열 대신 재귀 함수로
일반화 — 배열은 그리드 셀에 콤마 목록으로 표시돼도 무방해 더 내려가지 않는다).
gm_platform 쪽 응답 컬럼도 기존 `changes` 컬럼은 `status=0`으로 비활성화하고, 컬렉션별
실제 `changes.*` 필드에 맞는 컬럼을 새로 등록했다.
