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

`master_*` 컬렉션 9종을 컬렉션당 엔드포인트 하나씩 그대로 덤프한다. 응답은 서버가 이미
적재해둔 `masterDataCache`를 그대로 읽어 반환한다(DB 재조회 없음). **합성 규칙 1종은
조회만 지원하고 수정/삭제는 아직 없다** — 밸런스 데이터라 잘못 저장되면 게임 전체에 영향을
줄 수 있어 별도 검증 설계 후 추가 예정. **카드 원형/등급 설정/강화 규칙/스테이지 설정/
스테이지 카드 드랍과 출석부 정의 3종은 예외로 저장 API가 있다**(카드 원형은
`save-card-templates`, 등급 설정은 `save-grade-configs`, 강화 규칙은
`save-enhancement-rules`, 스테이지 설정은 `save-stage-configs`, 스테이지 카드 드랍은
`save-stage-card-drops`, 아래 각 절 / 출석부는
`save-attendance-def`/`-rewards`/`-catchup-prices`, 아래 "출석부 저장" 절) — 출석부는
애초에 gm_platform이 운영 중 실시간으로 쓰도록 설계된 컬렉션이라
(`23_GAME_DESIGN_ATTENDANCE.md` "비즈니스 키 vs 내부 PK" 절) 값 검증 규칙이 처음부터
확정돼 있었고, 카드 원형/등급 설정/강화 규칙/스테이지 설정/스테이지 카드 드랍은 gm_platform이
EDITABLE_GRID로 행 추가/수정/삭제를 지원하게 되면서 저장 API를 도입했다. **모두 X-API-Key
필요.**

대부분 요청 body 없음(빈 객체 전송)이지만, 출석 날짜별 보상/캐치업 가격 2종은 선택
파라미터 `defId`로 특정 출석부만 좁혀 조회할 수 있다(생략하면 전체 반환).

| 엔드포인트 | 대상 컬렉션 | 요청 body | 응답 `data` 행 형태 |
|---|---|---|---|
| `POST /gm/get-card-templates` | `master_card_templates` | 없음 | `{ templateId, grade, baseAttack, baseHp, element }` |
| `POST /gm/get-grade-configs` | `master_grade_configs` | 없음 | `{ grade, maxLevel, maxEnhancementLevel }` |
| `POST /gm/get-enhancement-rules` | `master_enhancement_rules` | 없음 | `{ minTargetEnhancementLevel, maxTargetEnhancementLevel, successRate, destroyOnFailChance, goldMultiplier, stoneCost }` |
| `POST /gm/get-synthesis-rules` | `master_synthesis_rules` | 없음 | `{ type, sourceGrade?, resultGrade?, materialCount, successRate?, goldCost? }` (`type`에 따라 필드 일부만 채워짐) |
| `POST /gm/get-stage-configs` | `master_stage_configs` | 없음 | `{ stageId, monsterHp, monsterAttack, monsterDefense, monsterElement, rewardGold, rewardExp, enhancementStoneDropRate, enhancementStoneMin, enhancementStoneMax, farmRewardRate, cardDropRateFirstClear, cardDropRateFarm }` |
| `POST /gm/get-stage-card-drops` | `master_stage_card_drops` | 없음 | `{ stageId, templateId, weight }` |
| `POST /gm/get-attendance-defs` | `master_attendance_defs` | 없음 | `{ _id, defId, name, type, targetAudience, returningInactiveDays?, maxRotationCount, enrollableStart, enrollableEnd, durationDays, catchupMaxCount, createdAt, updatedAt }` |
| `POST /gm/get-attendance-rewards` | `master_attendance_rewards` | `{ defId? }` | `{ defId, day, itemType, amount, cardTemplateId }` |
| `POST /gm/get-attendance-catchup-prices` | `master_attendance_catchup_prices` | `{ defId? }` | `{ defId, purchaseIndex, price }` |

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

**에러**: 대부분 파라미터가 없어 검증 실패 경로 자체가 없다. `get-attendance-rewards`/
`get-attendance-catchup-prices`만 `defId`를 문자열이 아닌 값으로 보내면 10000으로 거부된다.

### 카드 원형 저장

`POST /gm/save-card-templates` — gm_platform EDITABLE_GRID(`response_view_type=3`)에서
행 추가/수정/삭제를 그대로 지원한다. `data` 배열을 `master_card_templates` 컬렉션의
**최종 상태**로 취급하는 전체 교체 방식이다: payload에 있는 `templateId`는 추가/수정
(upsert), 기존에 있었는데 payload에서 빠진 `templateId`는 삭제 후보로 본다.

삭제 후보 중 하나라도 아직 참조되는 중이면(플레이어 보유 카드 / 스테이지 카드 드랍 /
출석 보상) **아무것도 저장하지 않고** 요청 전체를 거부한다(10003) — 부분 반영으로
어떤 행은 저장되고 어떤 행은 스킵됐는지 gm_platform 화면에서 구분할 방법이 마땅치 않아,
하나라도 걸리면 전체를 되돌리는 쪽을 택했다. 이 경우 운영자는 그 카드를 삭제 목록에서
빼고(행을 다시 채워 payload에 포함) 재시도해야 한다.

**요청 body**
```json
{
  "data": [
    { "templateId": "N_01", "grade": "N", "element": "fire", "baseAttack": 15, "baseHp": 100 },
    { "templateId": "SSR_01", "grade": "SSR", "element": "water", "baseAttack": 130, "baseHp": 400 }
  ]
}
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "templateId", "grade", "baseAttack", "baseHp", "element" }, ... ] }`
(저장 후 `master_card_templates` 전체)

**에러**: 10000(행 형식 오류 — templateId 빈값, grade/element가 허용 값 밖, baseAttack/baseHp가
1 이상 정수 아님, payload 내 templateId 중복), 10003(삭제 후보가 아직 참조 중)

### 등급 설정 저장

`POST /gm/save-grade-configs` — gm_platform EDITABLE_GRID에서 행 편집을 지원한다. 카드
원형/강화 규칙과 달리 `grade`가 `Grade` 타입 자체로 고정된 4종 리터럴(N/R/SR/SSR)이라
행을 추가하거나 지울 수 없다 — **순수 upsert**이며, `data` 배열은 항상 이 4종을 정확히
하나씩만 포함해야 한다(누락/중복/모르는 값은 전부 거부). gm_platform 쪽 `grade` 컬럼도
카드 원형 저장 화면과 동일한 공통코드 그룹(`CARD_GRADE`)을 참조하도록 등록해, 두 화면에서
등급 표기가 갈리지 않게 했다.

`maxLevel`은 1 이상 정수, `maxEnhancementLevel`은 0 이상 정수여야 한다.

**요청 body**
```json
{
  "data": [
    { "grade": "N", "maxLevel": 20, "maxEnhancementLevel": 5 },
    { "grade": "R", "maxLevel": 40, "maxEnhancementLevel": 10 },
    { "grade": "SR", "maxLevel": 60, "maxEnhancementLevel": 15 },
    { "grade": "SSR", "maxLevel": 60, "maxEnhancementLevel": 15 }
  ]
}
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "grade", "maxLevel", "maxEnhancementLevel" }, ... ] }`
(저장 후 `master_grade_configs` 전체, 항상 4행)

**에러**: 10000(행 형식 오류 — maxLevel/maxEnhancementLevel 정수 아님·범위 밖, N/R/SR/SSR
4종 집합과 불일치)

### 강화 규칙 저장

`POST /gm/save-enhancement-rules` — gm_platform EDITABLE_GRID에서 행 추가/수정/삭제를
지원한다. `data` 배열을 `master_enhancement_rules` 컬렉션의 **최종 상태**로 취급하는
전체 교체 방식은 카드 원형과 같지만, 카드 원형과 달리 이 규칙을 ID로 참조하는 다른
컬렉션이 없어(강화 시도 시점에 목표 단계로 즉석 조회할 뿐) **삭제 가드가 없다** — 삭제
후보는 참조 여부와 무관하게 그냥 지워진다.

행 식별(자연키)은 `minTargetEnhancementLevel`이다. 검증: `min`/`max`는 1 이상 정수이고
`max >= min`, `successRate`/`destroyOnFailChance`는 0~1, `goldMultiplier`/`stoneCost`는
0 이상 정수, `minTargetEnhancementLevel` 중복 금지, **구간이 서로 겹치면 거부**(예: 1~10과
5~8) — 서버가 목표 단계에 해당하는 규칙을 배열에서 첫 매치로 찾기 때문에, 구간이 겹치면
실제로 어떤 규칙이 적용될지 예측할 수 없어진다.

**요청 body**
```json
{
  "data": [
    { "minTargetEnhancementLevel": 1, "maxTargetEnhancementLevel": 5, "successRate": 1.0, "destroyOnFailChance": 0, "goldMultiplier": 100, "stoneCost": 1 },
    { "minTargetEnhancementLevel": 6, "maxTargetEnhancementLevel": 10, "successRate": 0.7, "destroyOnFailChance": 0, "goldMultiplier": 300, "stoneCost": 2 }
  ]
}
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "minTargetEnhancementLevel", "maxTargetEnhancementLevel", "successRate", "destroyOnFailChance", "goldMultiplier", "stoneCost" }, ... ] }`
(저장 후 `master_enhancement_rules` 전체)

**에러**: 10000(행 형식 오류 — min/max 정수 아님, max<min, 확률 범위 밖, 비용 음수, 자연키
중복, 구간 겹침)

### 스테이지 설정 저장

`POST /gm/save-stage-configs` — gm_platform EDITABLE_GRID에서 행 추가/수정/삭제를 지원한다.
`data` 배열을 `master_stage_configs` 컬렉션의 **최종 상태**로 취급하는 전체 교체 방식은
카드 원형과 같다. 삭제 후보의 `stageId`를 스테이지 카드 드랍(`master_stage_card_drops`)이
아직 참조하고 있으면(고아 드랍 행 방지 — 스테이지 카드 드랍 저장이 저장 시점에 `stageId`
실재 여부를 검증하는 것과 같은 불변조건을 반대 방향에서 지킨다) **아무것도 저장하지 않고**
요청 전체를 10003으로 거부한다 — 카드 원형과 동일하게, 부분 반영 시 어떤 행이 저장/스킵됐는지
구분하기 어려워 전체 롤백을 택했다.

행 식별(자연키)은 `stageId` 단일 필드다. 검증: `stageId`는 1 이상 정수, `monsterHp`/
`monsterAttack`은 1 이상 정수, `monsterDefense`는 0 이상 정수, `monsterElement`는
fire/water/grass 중 하나, `rewardGold`/`rewardExp`는 0 이상 정수,
`enhancementStoneDropRate`/`farmRewardRate`/`cardDropRateFirstClear`/`cardDropRateFarm`은
0~1, `enhancementStoneMin`/`enhancementStoneMax`는 0 이상 정수이고 `max >= min`.

**요청 body**
```json
{
  "data": [
    { "stageId": 1, "monsterHp": 29, "monsterAttack": 3, "monsterDefense": 1, "monsterElement": "water",
      "rewardGold": 10, "rewardExp": 5, "enhancementStoneDropRate": 0.5, "enhancementStoneMin": 1,
      "enhancementStoneMax": 2, "farmRewardRate": 0.5, "cardDropRateFirstClear": 0.3, "cardDropRateFarm": 0.15 }
  ]
}
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "stageId", "monsterHp", "monsterAttack", "monsterDefense", "monsterElement", "rewardGold", "rewardExp", "enhancementStoneDropRate", "enhancementStoneMin", "enhancementStoneMax", "farmRewardRate", "cardDropRateFirstClear", "cardDropRateFarm" }, ... ] }`
(저장 후 `master_stage_configs` 전체)

**에러**: 10000(행 형식 오류 — 범위/enum 밖, stageId 중복, min>max), 10003(삭제 후보를
스테이지 카드 드랍이 아직 참조 중)

### 스테이지 카드 드랍 저장

`POST /gm/save-stage-card-drops` — gm_platform EDITABLE_GRID에서 행 추가/수정/삭제를
지원한다. `data` 배열을 `master_stage_card_drops` 컬렉션의 **최종 상태**로 취급하는
전체 교체 방식은 카드 원형과 같지만, 강화 규칙과 마찬가지로 이 행 자체를 ID로 참조하는
다른 컬렉션이 없어(스테이지 클리어 시점에 즉석 조회할 뿐) **삭제 가드가 없다**.

행 식별(자연키)은 `(stageId, templateId)` 복합키다. 검증: `stageId`는 1 이상 정수이고
`master_stage_configs`에 실제로 있는 값이어야 하며, `templateId`는 빈 문자열이 아니고
`master_card_templates`에 실제로 있는 값이어야 한다(존재하지 않는 스테이지/카드 원형을
가리키는 고아 드랍 행 방지 — 출석부 보상 저장의 카드 원형 존재 검증과 동일 원칙),
`weight`는 0보다 큰 유한한 수여야 한다. `(stageId, templateId)` 중복은 거부한다.

**요청 body**
```json
{
  "data": [
    { "stageId": 1, "templateId": "N_01", "weight": 6 },
    { "stageId": 1, "templateId": "R_01", "weight": 3 }
  ]
}
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "stageId", "templateId", "weight" }, ... ] }`
(저장 후 `master_stage_card_drops` 전체)

**에러**: 10000(행 형식 오류 — stageId/weight 범위 밖, templateId 빈값, `(stageId,
templateId)` 중복, 존재하지 않는 stageId/templateId 참조)

### 출석부 저장 (3단계)

출석부는 정의 → 날짜별 보상 → 캐치업 회차별 가격 순서로 API 3개에 나눠 저장한다(gm_platform
화면에서 메뉴도 3개로 분리). 세 API 모두 **X-API-Key 필요**이고, 이미 `enrollableStart`가
지난(시작된) 출석부는 어느 것으로도 수정할 수 없다(12008). 보상/캐치업 가격은 부분 patch가
아니라 보상은 그 일차의 행 전체를, 캐치업 가격은 그 회차 1건을 저장하는 단위다. 정의만
저장하고 보상/캐치업 가격을 아직 채우지 않은(또는 일부만 채운) 출석부도 DB에는 존재할 수
있다 — 시작 시각 전까지 나머지 단계를 마쳐야 한다(서버가 이를 강제하는 게이트는 없음).

#### 1단계 `POST /gm/save-attendance-def`

출석부 정의 본문을 등록(신규 defId)하거나 수정(기존 def, 아직 시작 전인 def만)한다.

- `id`(내부 PK)가 있으면 수정, 없으면 신규 등록으로 처리한다 — `defId`는 수정 중 바뀔 수
  있어 식별자로 쓰지 않는다. `get-attendance-defs` 응답의 `_id` 필드를 그대로 이 `id`로
  보내면 된다(신규 등록 시엔 이 필드를 아예 생략).
- `enrollableStart`/`enrollableEnd`는 ISO 8601 문자열.
- `targetAudience: "RETURNING_USER"`일 때만 `returningInactiveDays` 필수(그 외 타입은
  값을 보내도 저장 시 무시된다).
- GENERAL은 다른 GENERAL def와 `[enrollableStart, enrollableEnd]` 기간이 겹치면 거부된다
  (EVENT는 병렬 진행이 정상이라 겹침 검사 없음).
- 이 단계에서는 `durationDays`/`catchupMaxCount`와 보상/캐치업 행의 일치를 검사하지 않는다
  (행은 나중에 저장되고, 기존 행이 있는 def의 `durationDays`를 바꾸는 수정까지 막으면 "def를
  먼저 고쳐야 행을 저장할 수 있는" 순환이 된다) — 2·3단계는 저장하는 `day`/`purchaseIndex`가
  이 값의 범위 안인지만 검사한다. 이미 저장된 행이 줄어든 `durationDays`/`catchupMaxCount`
  범위를 벗어나게 되는 수정도 서버가 막지 않는다(그리드로 확인).
- defId를 바꾸는 수정이면 그 defId를 참조하던 보상/캐치업 행의 defId도 함께 바뀐다.
- 삭제 API는 없다 — "이미 시작된 def는 수정 불가, append-only로 새 def 등록" 정책상
  정의 자체를 지울 일이 없다.

**요청 body**
```json
{
  "defId": "general_launch_2", "name": "일일 출석 2기",
  "type": "GENERAL", "targetAudience": "ALL_USERS",
  "maxRotationCount": 999999,
  "enrollableStart": "2026-10-01T00:00:00.000Z", "enrollableEnd": "2027-10-01T00:00:00.000Z",
  "durationDays": 7, "catchupMaxCount": 2
}
```

**응답**
```json
{
  "result": 0,
  "message": "OK",
  "data": [
    { "_id": "...", "defId": "general_launch_2", "name": "일일 출석 2기", "type": "GENERAL",
      "targetAudience": "ALL_USERS", "maxRotationCount": 999999,
      "enrollableStart": "2026-10-01T00:00:00.000Z", "enrollableEnd": "2027-10-01T00:00:00.000Z",
      "durationDays": 7, "catchupMaxCount": 2, "createdAt": "...", "updatedAt": "..." }
  ]
}
```

**에러**: 10000(형식 검증 실패), 12001(`id`로 수정 대상을 지정했는데 없음),
12006(GENERAL 기간 겹침), 12007(defId 중복), 12008(이미 시작된 def 수정 시도)

#### 2단계 `POST /gm/save-attendance-rewards`

출석부의 **한 일차** 보상을 통째로 교체 저장한다 — gm_platform 입력칸이 배열을 다루지 못해
아이템 종류별 수량 칸으로 나눴다(JSON 입력 없음). 그 일차의 기존 행은 전부 지우고 입력값으로
다시 채우며 다른 일차는 건드리지 않는다. 수량(`gold`/`enhancementStone`/`diamond`/`cardCount`)은
0 이상 정수이고 비우면 0(그 아이템 없음)이다 — 전부 비우면 그 일차 보상이 삭제된다. 카드는
`cardTemplateId`와 `cardCount`(1 이상)를 함께 줘야 하고(하루 카드 1종), 원형은 카드 마스터에
있어야 한다. `day`는 1~그 출석부의 `durationDays`여야 한다. 모든 일차를 다 채웠는지는 서버가
강제하지 않는다(하루씩 저장하는 구조라 저장 시점에 알 수 없음 — `get-attendance-rewards` 그리드로
확인). 응답은 저장 후 그 출석부의 보상 행 전체(day 오름차순, GRID).

**요청 body**
```json
{ "defId": "general_launch_2", "day": 7, "gold": 100, "diamond": 2, "cardTemplateId": "N_01", "cardCount": 1 }
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "_id", "defId", "day", "itemType", "amount", "cardTemplateId" }, ... ] }`

**에러**: 10000(형식/수량/카드 원형 검증 실패), 12001(defId의 출석부 없음), 12008(이미 시작된
출석부), 12009(`day`가 1~`durationDays` 범위 밖)

#### 3단계 `POST /gm/save-attendance-catchup-prices`

출석부의 캐치업 **한 회차** 가격을 저장한다(그 회차가 없으면 만들고, 있으면 가격만 바꿈).
`purchaseIndex`는 1~그 출석부의 `catchupMaxCount`, `price`는 0 이상 정수. 모든 회차를 다
채웠는지는 서버가 강제하지 않는다(`get-attendance-catchup-prices` 그리드로 확인). 응답은 저장
후 그 출석부의 캐치업 가격 행 전체(purchaseIndex 오름차순, GRID).

**요청 body**
```json
{ "defId": "general_launch_2", "purchaseIndex": 1, "price": 300 }
```

**응답**: `{ "result": 0, "message": "OK", "data": [ { "_id", "defId", "purchaseIndex", "price" }, ... ] }`

**에러**: 10000(형식/가격 검증 실패), 12001(defId의 출석부 없음), 12008(이미 시작된 출석부),
12009(`purchaseIndex`가 1~`catchupMaxCount` 범위 밖)

### 유저고유번호(playerId)별 감사 로그 조회

감사 로그 6종(`log_auth`/`log_enhancement`/`log_synthesis`/`log_battle_stage`/
`log_mailbox`/`log_attendance`, `08_AUDIT_LOG_POLICY.md` 참고)을 컬렉션당 엔드포인트 하나씩 `playerId`로
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
| `POST /gm/get-attendance-logs` | `log_attendance` | `defId`, `type`, `day`/`attachments.*`(attend/catchup_purchase만), `price`(catchup_purchase만), `startDate`/`endDate`(issue만), `rotationCount`/`startDate`/`endDate`/`attendedDays`/`catchupPurchaseCount`(reset만 — 리셋 직전 옛 사이클 최종 상태) |

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
