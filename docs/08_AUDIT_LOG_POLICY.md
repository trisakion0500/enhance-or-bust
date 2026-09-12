# 08_AUDIT_LOG_POLICY.md

감사 로그(audit log) / DAU / 전투 통계 정책. log4js 애플리케이션 로그(요청/응답 페어링,
운영 디버깅용)와는 목적이 다른, 게임 이벤트 감사/통계 전용 기록이다.

## 목적과 저장 위치

상태를 바꾸는 모든 액션에 대해 "언제/누가/어떤 액션/어떤 내용이 추가·수정·삭제됐는지"를
남긴다. 로그 DB(`enhance_or_bust_log`, 앱 DB와 물리 분리 — `04_DATA_MODEL.md`)에
컨텐츠(도메인)별 컬렉션을 분리해서 둔다: `log_auth`/`log_enhancement`/`log_synthesis`/
`log_battle_stage`/`log_mailbox`.

## 공통 스키마

```
{ actorId, action, changes, occurredAt }
```

- `actorId`: playerId. 배치/크론처럼 사람이 아닌 주체가 남기면 `"SYSTEM"` sentinel
  (`shared-kernel/auditLog.ts`의 `SYSTEM_ACTOR`).
- `changes`: 액션마다 내용이 달라 자유 형식 객체.

## 쓰기 시점과 실패 격리

메인 쓰기(players/mailbox)가 성공한 **뒤에만** 호출한다. 이 로그 기록 자체가 실패해도
메인 흐름을 실패시키지 않고 try/catch로 삼키며 실패만 log4js에 남긴다 — 로그 DB는
메인 트랜잭션과 절대 묶이지 않는다(로그 실패가 핵심 기능을 막으면 안 된다는 원칙).

## 상태 변경이 없는 시도는 기록하지 않는다

예를 들어 전투 패배는 감사 로그(`log_*`)엔 안 남는다 — `withOptimisticRetry`의
`shouldSave`가 저장 자체를 스킵하는 경우와 동일 기준이다. **단, 이 기준은 "상태를 바꾼
행위의 감사 추적"이라는 감사 로그 목적에만 해당하고, 통계 목적 컬렉션(DAU/전투 시도)에는
적용되지 않는다.**

## DAU / 전투 통계는 감사 로그와 별개 컬렉션

- **`stats_daily_active_players`**: "무엇이 바뀌었는지"가 아니라 "오늘 활동했는지"만
  필요해 목적이 다르다. `(playerId, date)` unique 인덱스로 `requireAuth`(인증이 필요한
  모든 라우트의 공용 진입점)에서 매 요청마다 호출하지만, 인덱스 덕분에 실제로는
  플레이어당 하루 1건만 남는다(중복 키 에러 11000은 조용히 무시 — SendMail과 동일한
  멱등 삽입 패턴).
- **`attempts_battle_stage`**: 스테이지별 승률/카드 조합 통계는 승리(감사 로그 대상)뿐
  아니라 패배까지 포함해야 계산 가능해, `log_battle_stage`(승리 시에만)와는 목적이
  다르다. `clearStage()`가 `withOptimisticRetry` 밖에서(승패 무관, 매 호출 1건) 직접
  기록하며, 출전 스쿼드의 카드 원형 ID(`squadTemplateIds`)까지 남긴다.

## 대상 액션 목록

"상태"가 `구현됨`인 것만 실제로 `writeAuditLog()` 호출이 코드에 있다.

| 컬렉션 | action | changes | 상태 |
|---|---|---|---|
| `log_auth` | `register` | platformType, starterCardTemplateId, initialGold, name(입력한 닉네임) | 구현됨 |
| `log_auth` | `login` | platformType | 구현됨 |
| `log_auth` | `logout` | (없음 — 세션 종료만) | 구현됨 |
| `log_enhancement` | `attempt` | cardId, success, destroyed, enhancementLevel(결과) | 구현됨 |
| `log_synthesis` | `gradeUpgrade` | materialCardIds, success, resultCardId?, resultTemplateId? | 구현됨 |
| `log_synthesis` | `enhanceMaterial` | targetCardId, materialCardIds, enhancementLevel(결과) | 구현됨 |
| `log_battle_stage` | `clear` | stageId, clearedStage(결과), rewardGold, rewardEnhancementStone, rewardCardTemplateId, mailSourceId — 승리 시에만 | 구현됨 |
| `log_mailbox` | `send` | mailId, title, attachments, sourceType, sourceId — 멱등 스킵(재발송 아님)은 기록 안 함 | 구현됨 |
| `log_mailbox` | `claim` | mailId, attachments(지급된 첨부) | 구현됨 |
| `log_mailbox` | `delete` | mailId | 구현됨 |
| `log_mailbox` | `cleanupBatch` | actorId="SYSTEM", cutoff, deletedCount(0건이면 로그도 생략) | 구현됨 |
| `stats_daily_active_players` | (감사 로그 아님, DAU 전용) | {playerId, date} 유니크 인덱스, 하루 1건 | 구현됨 |
| `attempts_battle_stage` | `attempt` | (감사 로그 아님, 통계 전용) stageId, squadCardIds, squadTemplateIds, won, clearedStage | 구현됨 |

## gm_platform에서의 조회

playerId별로 위 5개 감사 로그 컬렉션을 각각 조회하는 API가 있다 —
`18_GM_PLATFORM_INTEGRATION.md`와 `17_GM_API.md` 참고.
