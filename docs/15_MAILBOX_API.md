# 15_MAILBOX_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 발송·수령 흐름은
`07_BATTLE_MAILBOX_SCENARIO.md` 참고.

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
