# 14_BATTLE_STAGE_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 클리어→우편 발송 흐름은
`07_BATTLE_MAILBOX_SCENARIO.md` 참고.

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
