# API 문서

## 개요

- **Base URL**: 로컬 개발 기준 `http://localhost:3999` (포트는 `.env`의 `PORT`)
- **인증**: 로그인(`/auth/*`) 성공 시 `sessionToken` httpOnly 쿠키가 발급된다. 이후 보호된
  엔드포인트는 이 쿠키만으로 인증하며 별도 헤더가 필요 없다(같은 오리진에서 정적 프론트와
  API를 같이 서빙하므로 CORS 설정도 없다).
- **공통 응답 포맷**:
  - 성공: `{ "result": 0, ...데이터 }` (HTTP 200)
  - 실패: `{ "result": <에러코드>, "message": "..." }` — HTTP status는 에러코드별로 고정(아래
    "에러 코드" 표 참고). 비즈니스 오류를 HTTP 200으로 감싸 내려주지 않는다.
  - 예외: `GET /health`는 `{ "status": "ok" }`, `GET /auth/google/login`·`GET
    /auth/google/callback`·`GET /auth/facebook/login`·`GET /auth/facebook/callback`은
    302 리다이렉트라 이 포맷을 따르지 않는다 — 콜백 라우트는 실패 시에도 JSON 에러 대신
    로그인 화면(`/?loginError=1`)으로 리다이렉트한다(브라우저 최상위 탐색으로 오는 요청이라
    날것 JSON을 보여줄 대상이 없음).
- **서버 권위 원칙**: 강화/합성 성공 확률, 전투 판정(승패·데미지)은 전부 서버가 직접
  계산한다. 클라이언트는 대상 ID(카드 ID, 스테이지 번호 등)만 보내고, 결과값을 클라이언트가
  주장해도 서버는 신뢰하지 않는다.

## 에러 코드

컨텍스트별로 코드 대역이 고정되어 있다 — 새 에러가 추가돼도 대역은 바뀌지 않는다.

### Common (1000번대) — 도메인 무관 공통

| 코드 | HTTP | 메시지 |
|---|---|---|
| 1000 | 400 | 요청 값이 올바르지 않습니다. |
| 1001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 1002 | 409 | 다른 요청과 충돌해 처리하지 못했습니다. 다시 시도해주세요. (낙관적 락 충돌 재시도 초과) |
| 1003 | 429 | 처리 중인 요청이 있습니다. 잠시 후 다시 시도해주세요. (같은 플레이어의 동시 요청, Redis 락) |
| 1999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Inventory (2000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 2000 | 400 | 요청 값이 올바르지 않습니다. |
| 2001 | 404 | 요청한 리소스를 찾을 수 없습니다. (카드 미보유) |
| 2999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Enhancement (3000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 3000 | 400 | 요청 값이 올바르지 않습니다. |
| 3001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 3002 | 409 | 이미 최대 강화 단계입니다. |
| 3999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Synthesis (4000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 4000 | 400 | 요청 값이 올바르지 않습니다. |
| 4001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 4002 | 409 | 이미 최대 강화 단계입니다. |
| 4003 | 409 | 더 이상 승급할 수 없는 등급입니다. |
| 4999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Progression (5000번대) — 현재 API 응답 경로엔 노출되지 않음(레벨업은 Battle-Stage 클리어 내부 로직)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 5000 | 400 | 요청 값이 올바르지 않습니다. |
| 5001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 5999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Economy (6000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 6000 | 400 | 요청 값이 올바르지 않습니다. |
| 6001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 6002 | 409 | 재화가 부족합니다. |
| 6999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Mailbox (7000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 7000 | 400 | 요청 값이 올바르지 않습니다. |
| 7001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 7002 | 409 | 이미 수령한 우편입니다. |
| 7003 | 409 | 만료된 우편입니다. |
| 7004 | 409 | 인벤토리가 초과되어 더 이상 카드를 수령할 수 없습니다. |
| 7005 | 409 | 수령하지 않은 우편은 삭제할 수 없습니다. |
| 7999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Battle-Stage (8000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 8000 | 400 | 요청 값이 올바르지 않습니다. |
| 8001 | 404 | 요청한 리소스를 찾을 수 없습니다. |
| 8002 | 409 | 아직 도전할 수 없는 스테이지입니다. |
| 8999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### Auth (9000번대)

| 코드 | HTTP | 메시지 |
|---|---|---|
| 9000 | 400 | 요청 값이 올바르지 않습니다. |
| 9001 | 401 | 구글 로그인 검증에 실패했습니다. |
| 9002 | 401 | 로그인이 필요합니다. (세션 쿠키 없음/만료 — 모든 보호된 엔드포인트에 공통) |
| 9003 | 401 | 페이스북 로그인 검증에 실패했습니다. |
| 9999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

### GM (10000번대) — gm_platform 연동 전용

| 코드 | HTTP | 메시지 |
|---|---|---|
| 10000 | 400 | 요청 값이 올바르지 않습니다. |
| 10001 | 401 | 인증에 실패했습니다. |
| 10002 | 404 | 요청한 플레이어를 찾을 수 없습니다. |
| 10999 | 500 | 일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요. |

---

## Auth

### `GET /health`

헬스체크. 인증 불필요.

**응답**
```json
{ "status": "ok" }
```

### `GET /auth/config`

프론트가 로그인 UI를 초기화할 때 쓰는 공개 설정 조회. 인증 불필요.

**응답**
```json
{ "googleClientId": "xxxxx.apps.googleusercontent.com", "authFlow": "id_token" }
```

### `POST /auth/google`

`GOOGLE_AUTH_FLOW=id_token`(기본값)일 때만 등록된다. Google Identity Services가 발급한
ID 토큰으로 로그인하거나(최초 호출 시) 신규가입한다. 인증 불필요.

**요청 body**
```json
{ "credential": "<구글이 발급한 ID 토큰(JWT)>" }
```

**응답**: `{ "result": 0 }` + `Set-Cookie: sessionToken=...` (httpOnly, 7일)

**에러**: 9000(credential 누락), 9001(토큰 검증 실패)

### `GET /auth/google/login`

`GOOGLE_AUTH_FLOW=authorization_code`일 때만 등록된다. CSRF 방지용 `state`를 쿠키에
저장한 뒤 구글 동의 화면으로 302 리다이렉트한다. 인증 불필요.

### `GET /auth/google/callback`

위와 동일 조건에서만 등록. 구글이 `code`/`state`와 함께 리다이렉트해오면 `state`를
검증하고, `code`를 토큰과 교환해 로그인/가입을 완료한 뒤 세션 쿠키를 발급하고 `/`로
302 리다이렉트한다. 인증 불필요(이 요청 자체가 로그인 완료 시점).

**실패 시**: JSON 에러 대신 `/?loginError=1`로 302 리다이렉트한다(`state` 불일치,
토큰 교환/검증 실패 등 사유 무관 — 실패 원인은 서버 로그에만 남긴다). 프론트는 이
쿼리 파라미터를 보고 로그인 화면에 실패 메시지를 표시한다.

### `GET /auth/facebook/login`

토글 없이 항상 등록된다(페이스북엔 구글의 `id_token`/GIS에 대응하는 수단이 없어
Authorization Code Flow 하나만 지원). CSRF 방지용 `state`를 구글과 같은 쿠키에 저장한
뒤 페이스북 동의 화면으로 302 리다이렉트한다. 인증 불필요.

### `GET /auth/facebook/callback`

페이스북이 `code`/`state`와 함께 리다이렉트해오면 `state`를 검증하고, `code`를 access
token/프로필과 교환해 로그인/가입을 완료한 뒤 세션 쿠키를 발급하고 `/`로 302
리다이렉트한다. 인증 불필요(이 요청 자체가 로그인 완료 시점).

**실패 시**: 구글 콜백과 동일하게 `/?loginError=1`로 302 리다이렉트한다.

### `POST /auth/logout`

세션 쿠키를 지우고 로그아웃한다. 인증 불필요 — 세션 쿠키가 없거나 이미 만료돼도 그냥
성공 처리한다(멱등: 이미 로그아웃된 상태로 두 번 호출해도 에러가 아니다).

**응답**: `{ "result": 0 }` + 세션 쿠키 삭제

---

## Enhancement

### `POST /enhancement/:cardId`

카드 강화를 한 번 시도한다. 재화는 성공/실패와 무관하게 소모되며, +11~15 구간
실패 시에만 10% 확률로 카드가 파괴된다. **인증 필요.**

**Path 파라미터**: `cardId` — 강화할 보유 카드 ID

**응답**
```json
{
  "result": 0,
  "success": true,
  "destroyed": false,
  "enhancementLevel": 6,
  "gold": 12000,
  "enhancementStone": 340
}
```

| 필드 | 설명 |
|---|---|
| `success` | 이번 시도 성공 여부 |
| `destroyed` | 카드 파괴 여부(+11~15 구간 실패 시에만 발생 가능) |
| `enhancementLevel` | 시도 후 강화 단계(파괴 시 시도 직전 단계) |
| `gold` / `enhancementStone` | 시도 후 남은 재화 |

**에러**: 9002(미인증), 2001(카드 없음), 3002(이미 최대 강화 단계), 6002(재화 부족),
1002(재시도 초과 낙관적 락 충돌), 1003(동시 요청, 락 획득 실패)

---

## Synthesis

### `POST /synthesis/grade-upgrade`

동일 등급 카드 N장(규칙이 정한 장수, 마스터데이터 기준)을 소모해 상위 등급 카드
승급을 시도한다(성공률 80%). 실패해도 소재 중 1장만 소모되고 나머지는 그대로 남는다.
**인증 필요.**

**요청 body**
```json
{ "materialCardIds": ["card-1", "card-2", "card-3"] }
```

**응답(성공)**
```json
{ "result": 0, "success": true, "resultCardId": "card-9", "resultTemplateId": "tpl-sr-003" }
```

**응답(실패)**
```json
{ "result": 0, "success": false }
```

**에러**: 9002(미인증), 4000(카드 ID 중복/개수 불일치/등급 혼합), 4001(카드 없음),
4003(승급 가능한 상위 등급 없음), 1002, 1003

### `POST /synthesis/enhance-material`

대상 카드 외 동일 원형 카드 N장 + 골드를 소모해 대상 카드의 강화 단계를 +1 시킨다.
100% 성공, 파괴 없음 — Enhancement 컨텍스트의 확률적 강화와는 별개 경로다. **인증 필요.**

**요청 body**
```json
{ "targetCardId": "card-1", "materialCardIds": ["card-2", "card-3"] }
```

**응답**
```json
{ "result": 0, "enhancementLevel": 4, "gold": 8000 }
```

**에러**: 9002(미인증), 4000(대상이 재료 목록에 포함/카드 ID 중복/개수 불일치),
4001(카드 없음), 4002(대상이 이미 최대 강화 단계), 6002(재화 부족), 1002, 1003

---

## Battle-Stage

### `POST /battle-stage/:stageId/clear`

출전 스쿼드(1~`squadMaxSize`장, `SQUAD_MAX_SIZE` env 기반 — 기본값 5, `GET /player/me`
응답의 `squadMaxSize`로 확인 가능. 공유 체력 풀)로 스테이지에 도전한다. 서버가 카드 스탯 기준으로
라운드제 전투를 직접 시뮬레이션해 판정한다. `clearedStage` 이하 스테이지는 파밍
재도전(보상 축소)이 가능하고, `clearedStage+1` 초과는 진입이 차단된다. **인증 필요.**

**Path 파라미터**: `stageId` — 도전할 스테이지 번호(1 이상 정수)

**요청 body**
```json
{ "squadCardIds": ["card-1", "card-2", "card-3"] }
```

**응답**
```json
{
  "result": 0,
  "won": true,
  "rounds": [
    { "round": 1, "damageDealtToMonster": 320, "monsterHpAfter": 680, "damageTakenBySquad": 150, "squadHpAfter": 850 }
  ],
  "rewardGold": 500,
  "rewardEnhancementStone": 3,
  "rewardCardTemplateId": "SSR_03",
  "expGained": [
    { "cardId": "card-1", "exp": 40, "leveledUp": true, "levelsGained": 1 }
  ],
  "clearedStage": 12,
  "gold": 12000,
  "enhancementStone": 340
}
```

| 필드 | 설명 |
|---|---|
| `won` | 승리 여부(라운드 상한 도달 시에도 false) |
| `rounds` | 라운드별 진행 로그 |
| `rewardGold` / `rewardEnhancementStone` | 이번에 **우편으로 발송된** 보상(패배 시 0) — `gold`/`enhancementStone` 잔액에는 아직 반영 안 됨, 우편 수령(`POST /mailbox/:mailId/claim`) 후 반영 |
| `rewardCardTemplateId` | 이번에 **우편으로 발송된** 드랍 카드 원형 ID(드랍 실패 또는 패배 시 `null`) — 우편 수령 시 레벨 1/EXP 0/강화 0단계로 새 카드 인스턴스 생성 |
| `expGained` | 출전 카드별 EXP 획득 결과 — EXP는 우편 경유 없이 즉시 반영됨 |
| `clearedStage` | 이 시도 이후 최종 `clearedStage`(최초 클리어가 아니면 변화 없음) |
| `gold` / `enhancementStone` | 이 시도 시점 지갑 잔액(위 보상 반영 전) |

**에러**: 9002(미인증), 8000(출전 카드 0장/`squadMaxSize` 초과/중복, stageId 형식 오류),
8001(카드/스테이지 없음), 8002(`clearedStage+1` 초과 스테이지), 1002, 1003

---

## Mailbox

발송(SendMail)은 HTTP API가 없다 — 스테이지 클리어 등 다른 Use-case가 서버 내부에서만
호출한다(예: 스테이지 클리어 보상은 골드/강화석을 우편으로 발송).

### `GET /mailbox`

만료되지 않은 우편 목록을 최신순으로 조회한다. **인증 필요.**

**응답**
```json
{
  "result": 0,
  "mails": [
    {
      "mailId": "mail-1",
      "playerId": "player-1",
      "title": "스테이지 클리어 보상",
      "attachments": { "gold": 500, "enhancementStone": 3 },
      "sourceType": "stage_clear",
      "sourceId": "9c3b...-uuid",
      "createdAt": "2026-09-01T00:00:00.000Z",
      "expiresAt": "2026-09-08T00:00:00.000Z",
      "claimedAt": null
    }
  ]
}
```

### `POST /mailbox/:mailId/claim`

우편 첨부물(골드/강화석/다이아/카드)을 수령한다. mailbox+players 컬렉션을 트랜잭션으로
묶어 우편 상태 변경과 재화/인벤토리 지급을 원자적으로 처리한다. **인증 필요.**

**Path 파라미터**: `mailId` — 수령할 우편 ID

**응답**
```json
{ "result": 0, "mail": { "mailId": "mail-1", "claimedAt": "2026-09-02T03:00:00.000Z", "...": "..." } }
```

**에러**: 9002(미인증), 7001(우편 없음/소유자 아님), 7002(이미 수령), 7003(만료됨),
7004(카드 첨부물 수령 시 인벤토리 슬롯 상한(`INVENTORY_SLOT_CAP`) 초과 — 우편은 미수령
상태 그대로 남아 슬롯을 비운 뒤 다시 시도 가능)

### `DELETE /mailbox/:mailId`

우편을 숨김 삭제한다(`deletedAt` 플래그만 세팅 — 실제 문서 삭제 아님, 이후 `GET
/mailbox` 목록에서 제외됨). **수령(claimedAt)한 우편만 삭제 가능** — 미수령 우편을
삭제하면 첨부물을 잃을 수 있어 거부한다. **인증 필요.**

**Path 파라미터**: `mailId` — 삭제할 우편 ID

**응답**: `{ "result": 0 }`

**에러**: 9002(미인증), 7001(우편 없음/소유자 아님), 7005(미수령 우편은 삭제 불가)

## Player

### `GET /player/me`

로그인한 자기 자신의 재화/clearedStage/보유 카드를 조회한다. 인벤토리 각 카드는
마스터 데이터(카드 원형)와 서버가 미리 조인해 등급/공격력/체력/속성까지 함께 내려준다
— 프론트가 별도로 마스터 데이터를 조회할 필요가 없다. 같은 이유로 전투 출전 스쿼드
최대 장수(`squadMaxSize`, `SQUAD_MAX_SIZE` env 기반)와 합성 규칙 전체
(`synthesisRules`, 마스터 데이터)도 이 응답에 함께 실어 보낸다 — 프론트가 이런 설정/규칙
조회용 별도 엔드포인트를 호출할 필요가 없다. 프론트는 이 엔드포인트 호출 성공 여부로
로그인 여부도 함께 판단한다(별도 whoami 엔드포인트 없음). **인증 필요.**

**응답**
```json
{
  "result": 0,
  "name": "닉네임",
  "picture": "https://.../pic.png",
  "economy": { "gold": 1000, "enhancementStone": 3, "diamond": 0 },
  "clearedStage": 5,
  "inventory": [
    {
      "cardId": "card-1", "templateId": "N_01", "grade": "N",
      "baseAttack": 15, "baseHp": 100, "element": "fire",
      "level": 3, "exp": 40, "enhancementLevel": 0
    }
  ],
  "squadMaxSize": 5,
  "synthesisRules": [
    { "type": "gradeUpgrade", "sourceGrade": "N", "resultGrade": "R", "materialCount": 3, "successRate": 0.8 },
    { "type": "gradeUpgrade", "sourceGrade": "R", "resultGrade": "SR", "materialCount": 3, "successRate": 0.8 },
    { "type": "gradeUpgrade", "sourceGrade": "SR", "resultGrade": "SSR", "materialCount": 3, "successRate": 0.8 },
    { "type": "enhanceMaterial", "materialCount": 2, "goldCost": 500 }
  ]
}
```

**에러**: 9002(미인증), 1001(세션은 유효한데 플레이어 문서가 없는 이례적 상황)

---

## GM

gm_platform(별도 사내 운영툴 프로젝트)이 GM 운영자 대신 호출하는 엔드포인트. 세션 쿠키가
아니라 `X-API-Key` 헤더(`GM_PLATFORM_API_KEY` env와 대조, `timingSafeEqual`로 비교)로
인증한다. gm_platform의 apiExecution 관례에 맞춰 조회 엔드포인트도 전부 `POST`다. 응답은
gm_platform의 외부 API 규약(`{ result, message, data: [...] }`, `data`는 항상 배열)을
따른다 — gm_platform 쪽에서 이 엔드포인트를 KEY_VALUE/GRID로 등록해 결과를 보여준다.

### `POST /gm/get-player`

`playerId`로 플레이어 한 명을 조회하거나, `playerId`를 생략하면 전체 플레이어를 조회한다
(최대 200명, 무제한 스캔 방지). 재화(`economy.gold`/`economy.enhancementStone`/
`economy.diamond`)는 gm_platform 그리드가 1차원으로 렌더링할 수 있도록 점(`.`) 표기로
평탄화되어 있다. **X-API-Key 필요.**

**요청 body**
```json
{ "playerId": "player-1" }
```

**응답**
```json
{
  "result": 0,
  "message": "OK",
  "data": [
    {
      "playerId": "player-1", "name": "닉네임", "platformType": "google", "platformUserId": "116...",
      "economy.gold": 1000, "economy.enhancementStone": 3, "economy.diamond": 0,
      "clearedStage": 5, "cardCount": 4
    }
  ]
}
```

**에러**: 10000(playerId가 문자열이 아님), 10002(playerId 지정 조회인데 없음)

### `POST /gm/get-player-cards`

`playerId`로 보유 카드 목록을 조회한다. 각 카드는 `GET /player/me`의 인벤토리와 동일하게
마스터 데이터(카드 원형)와 조인해 등급/공격력/체력/속성까지 포함한다. `playerId`는
**필수**다(`get-player`와 달리 전체 조회 모드가 없음). **X-API-Key 필요.**

**요청 body**
```json
{ "playerId": "player-1" }
```

**응답**
```json
{
  "result": 0,
  "message": "OK",
  "data": [
    { "cardId": "card-1", "templateId": "N_01", "grade": "N", "baseAttack": 15, "baseHp": 100,
      "element": "fire", "level": 3, "exp": 40, "enhancementLevel": 0 }
  ]
}
```

**에러**: 10000(playerId 누락/문자열 아님), 10002(플레이어 없음)

### 시드데이터(마스터데이터) 조회

`master_*` 컬렉션 6종을 컬렉션당 엔드포인트 하나씩 그대로 덤프한다. 요청 body 없음(빈
객체 전송), 응답은 서버가 이미 적재해둔 `masterDataCache`를 그대로 읽어 반환한다(DB
재조회 없음). **1차는 조회만 지원하고 수정/삭제는 아직 없다** — 밸런스 데이터라 잘못
저장되면 게임 전체에 영향을 줄 수 있어 별도 검증 설계 후 추가 예정. **모두 X-API-Key
필요.**

| 엔드포인트 | 대상 컬렉션 | 응답 `data` 행 형태 |
|---|---|---|
| `POST /gm/get-card-templates` | `master_card_templates` | `{ templateId, grade, baseAttack, baseHp, element }` |
| `POST /gm/get-grade-configs` | `master_grade_configs` | `{ grade, maxLevel, maxEnhancementLevel }` |
| `POST /gm/get-enhancement-rules` | `master_enhancement_rules` | `{ minTargetEnhancementLevel, maxTargetEnhancementLevel, successRate, destroyOnFailChance, goldMultiplier, stoneCost }` |
| `POST /gm/get-synthesis-rules` | `master_synthesis_rules` | `{ type, sourceGrade?, resultGrade?, materialCount, successRate?, goldCost? }` (`type`에 따라 필드 일부만 채워짐) |
| `POST /gm/get-stage-configs` | `master_stage_configs` | `{ stageId, monsterHp, monsterAttack, monsterDefense, monsterElement, rewardGold, rewardExp, enhancementStoneDropRate, enhancementStoneMin, enhancementStoneMax, farmRewardRate, cardDropRateFirstClear, cardDropRateFarm }` |
| `POST /gm/get-stage-card-drops` | `master_stage_card_drops` | `{ stageId, templateId, weight }` |

**응답 예시** (`POST /gm/get-grade-configs`)
```json
{
  "result": 0,
  "message": "OK",
  "data": [
    { "grade": "N", "maxLevel": 20, "maxEnhancementLevel": 5 },
    { "grade": "R", "maxLevel": 40, "maxEnhancementLevel": 10 }
  ]
}
```

**에러**: 없음(파라미터가 없어 검증 실패 경로 자체가 없음)
