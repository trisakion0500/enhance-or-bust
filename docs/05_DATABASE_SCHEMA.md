# 05_DATABASE_SCHEMA.md

컬렉션별 필드/인덱스 상세. 컬렉션 간 관계와 원자성 경계는 `04_DATA_MODEL.md` 참고.

## enhance_or_bust (앱 DB)

### `players`

| 필드 | 타입 | 설명 |
|---|---|---|
| `_id` (`playerId`) | string (UUID) | `randomUUID()`로 발급, 프로바이더 값과 분리된 내부 식별자 |
| `platformType` | string | `"google"` / `"facebook"` / `"test"`(e2e 전용) |
| `platformUserId` | string | 프로바이더별 고유 ID |
| `name`, `picture` | string | 가입 시점 소셜 프로필 스냅샷(이후 재동기화 안 함) |
| `version` | number | 낙관적 락 카운터 |
| `economy.gold` / `economy.enhancementStone` / `economy.diamond` | number | 재화 |
| `clearedStage` | number | 최초 클리어한 최고 스테이지 |
| `inventory[].cardId` | string (UUID) | 카드 인스턴스 ID |
| `inventory[].templateId` | string | 카드 원형 ID(`master_card_templates` 참조, 애플리케이션 레벨 참조 — FK 없음) |
| `inventory[].level` / `inventory[].exp` | number | Progression |
| `inventory[].enhancementLevel` | number | 0~15 |

**인덱스**: `(platformType, platformUserId)` unique.

### `mailbox`

| 필드 | 타입 | 설명 |
|---|---|---|
| `_id` (`mailId`) | string (UUID) | — |
| `playerId` | string | — |
| `title` | string | `mailContent.ts`의 `MAIL_CONTENTS` 레지스트리 기준 |
| `attachments.gold` / `.enhancementStone` / `.diamond` | number? | 있는 것만 채워짐 |
| `attachments.cardTemplateIds` | string[]? | 스테이지 클리어 카드 드랍 |
| `sourceType` | string | 예: `"stage_clear"` |
| `sourceId` | string | 예: `"{playerId}:{stageId}:{clearedAt}"` |
| `createdAt` / `expiresAt` | Date | 발송 7일 후 만료 |
| `claimedAt` | Date? | null이면 미수령 |
| `deletedAt` | Date? | null이면 미삭제(숨김 삭제 플래그) |

**인덱스**: `(sourceType, sourceId)` unique(멱등 발송). `GET /mailbox` 조회는
`(playerId, deletedAt, expiresAt)` 조건으로 필터링.

### `master_card_templates`

| 필드 | 설명 |
|---|---|
| `templateId` | 원형 ID |
| `grade` | N/R/SR/SSR |
| `baseAttack`, `baseHp` | 기본 스탯 |
| `element` | fire/water/grass |
| `version` | 컨텐츠별 독립 버전 |

### `master_grade_configs`

| 필드 | 설명 |
|---|---|
| `grade` | N/R/SR/SSR |
| `maxLevel` | 등급별 레벨 상한 |
| `maxEnhancementLevel` | 등급별 강화 단계 상한 |

### `master_enhancement_rules`

| 필드 | 설명 |
|---|---|
| `minTargetEnhancementLevel` / `maxTargetEnhancementLevel` | 이 규칙이 적용되는 강화 단계 구간 |
| `successRate` | 성공률 |
| `destroyOnFailChance` | 실패 시 파괴 확률 |
| `goldMultiplier`, `stoneCost` | 비용 |

### `master_synthesis_rules`

| 필드 | 설명 |
|---|---|
| `type` | `"gradeUpgrade"` \| `"enhanceMaterial"` |
| `sourceGrade` / `resultGrade` | gradeUpgrade만 |
| `materialCount` | 소모 장수 |
| `successRate` | gradeUpgrade만(enhanceMaterial은 100%) |
| `goldCost` | enhanceMaterial만 |

### `master_stage_configs`

| 필드 | 설명 |
|---|---|
| `stageId` | 스테이지 번호 |
| `monsterHp` / `monsterAttack` / `monsterDefense` / `monsterElement` | 기본 스탯(1.15^stageId로 성장) |
| `rewardGold` / `rewardExp` | 클리어 보상 |
| `enhancementStoneDropRate` / `.Min` / `.Max` | 강화석 드랍 |
| `farmRewardRate` | 파밍(재도전) 보상 축소율 |
| `cardDropRateFirstClear` / `cardDropRateFarm` | 카드 드랍률(최초/파밍 독립) |

### `master_stage_card_drops`

| 필드 | 설명 |
|---|---|
| `stageId`, `templateId` | 자연키(문서당 스테이지-카드원형 조합 1개) |
| `weight` | 가중치 추첨용 |

### `master_data_meta`

| 필드 | 설명 |
|---|---|
| `content` | 컨텐츠(컬렉션) 식별자 |
| `version` | `$inc`로만 증가 |

### `system_change_stream_state`

단일 문서. `resumeToken`(마스터 데이터 워처 재개용).

### `system_batch_runs`

| 필드 | 설명 |
|---|---|
| `_id` | `"{jobName}:{period}"` |
| `claimedAt` | Date |

## enhance_or_bust_log (로그 DB)

### `log_auth` / `log_enhancement` / `log_synthesis` / `log_battle_stage` / `log_mailbox`

공통 스키마: `{ actorId, action, changes, occurredAt }` — `changes`는 액션별 자유 형식
객체(필드 목록은 `08_AUDIT_LOG_POLICY.md`의 액션 표 참고).

**인덱스**: 전부 `(actorId, occurredAt: -1)` — playerId별 최신순 조회(gm_platform 로그
조회 API의 주 쿼리 패턴).

### `stats_daily_active_players`

| 필드 | 설명 |
|---|---|
| `playerId`, `date` | 복합 unique — 플레이어당 하루 1건만 삽입 |

### `attempts_battle_stage`

| 필드 | 설명 |
|---|---|
| `actorId` | playerId |
| `stageId`, `squadCardIds`, `squadTemplateIds` | 시도 정보 |
| `won`, `clearedStage` | 결과 |
| `occurredAt` | — |

**인덱스**: `(actorId, occurredAt: -1)`.
