# 17_GM_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 연동 배경/인증 방식은
`18_GM_PLATFORM_INTEGRATION.md`와 `09_AUTH_SECURITY.md` 참고.

[gm_platform](https://github.com/trisakion0500/gm_platform)(이전에 직접 개발한 별도
포트폴리오 프로젝트, GM 운영툴)이 GM 운영자 대신 호출하는 엔드포인트. 세션 쿠키가
아니라 `X-API-Key` 헤더(`GM_PLATFORM_API_KEY` env와 대조, `timingSafeEqual`로 비교)로
인증한다. gm_platform의 apiExecution 관례에 맞춰 조회 엔드포인트도 전부 `POST`다. 응답은
gm_platform의 외부 API 규약(`{ result, message, data: [...] }`, `data`는 항상 배열)을
따른다 — gm_platform 쪽에서 이 엔드포인트를 KEY_VALUE/GRID로 등록해 결과를 보여준다.
`X-API-Key` 헤더가 없거나 값이 일치하지 않으면 이유를 구분하지 않고 전부 10001로
응답한다(모든 GM 엔드포인트 공통).

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

### 유저고유번호(playerId)별 감사 로그 조회

감사 로그 5종(`log_auth`/`log_enhancement`/`log_synthesis`/`log_battle_stage`/
`log_mailbox`, `08_AUDIT_LOG_POLICY.md` 참고)을 컬렉션당 엔드포인트 하나씩 `playerId`로
필터해 조회한다. `playerId`는 **필수**다(오타로 조회 대상이 잘못돼도 "로그 없음"과
"플레이어 없음"을 구분하도록, 로그 조회 전에 플레이어 존재를 먼저 확인한다). `fromDate`/
`toDate`(ISO 8601 문자열, 둘 다 선택)로 기간을 좁힐 수 있다 — 둘 다 없으면 최근
`occurredAt` 순 최대 200건. 원본 `changes`는 컬렉션/액션마다(예: log_synthesis의
gradeUpgrade/enhanceMaterial) 필드가 달라, gm_platform 그리드가 1차원으로 그릴 수 있도록
`get-player`의 `economy.gold`와 동일한 방식으로 `changes.cardId`처럼 점(`.`) 표기 키로
재귀 평탄화해 반환한다(중첩 객체만 재귀 — 배열은 그대로 둔다). 해당 컬렉션에서 실행된
액션에 없는 필드는 응답에서 빠진다(행마다 키 구성이 다를 수 있음). **모두 X-API-Key 필요.**

| 엔드포인트 | 대상 컬렉션 | `changes.*` 필드(액션별) |
|---|---|---|
| `POST /gm/get-auth-logs` | `log_auth` | `platformType`(register/login), `starterCardTemplateId`/`initialGold`/`name`(register만) |
| `POST /gm/get-enhancement-logs` | `log_enhancement` | `cardId`, `success`, `destroyed`, `enhancementLevel` |
| `POST /gm/get-synthesis-logs` | `log_synthesis` | `materialCardIds`, `success`, `resultCardId`/`resultTemplateId`(gradeUpgrade만), `targetCardId`/`enhancementLevel`(enhanceMaterial만) |
| `POST /gm/get-battle-stage-logs` | `log_battle_stage` | `stageId`, `clearedStage`, `rewardGold`, `rewardEnhancementStone`, `rewardCardTemplateId`, `mailSourceId` |
| `POST /gm/get-mailbox-logs` | `log_mailbox` | `mailId`, `title`/`sourceType`/`sourceId`(send만), `attachments.gold`/`attachments.enhancementStone`/`attachments.diamond`/`attachments.cardTemplateIds`(send/claim만), `cutoff`/`deletedCount`(cleanupBatch만) |

**요청 body**
```json
{ "playerId": "player-1", "fromDate": "2026-09-01T00:00:00Z", "toDate": "2026-09-30T23:59:59Z" }
```
(`fromDate`/`toDate`는 생략 가능)

**응답 예시** (`POST /gm/get-enhancement-logs`)
```json
{
  "result": 0,
  "message": "OK",
  "data": [
    { "actorId": "player-1", "action": "attempt", "occurredAt": "2026-09-11T09:12:34.000Z",
      "changes.cardId": "card-1", "changes.success": true, "changes.destroyed": false, "changes.enhancementLevel": 6 }
  ]
}
```

**에러**: 10000(playerId 누락/문자열 아님, fromDate/toDate가 문자열이 아니거나 날짜로 파싱 불가), 10002(플레이어 없음)
