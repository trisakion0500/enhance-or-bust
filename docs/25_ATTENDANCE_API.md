# 25_ATTENDANCE_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 출석보상의 정책/설계 배경은
`23_GAME_DESIGN_ATTENDANCE.md` 참고.

플레이어가 출석 현황을 보고, 놓친 날짜를 골드로 구매(캐치업)하는 엔드포인트. 세션 쿠키로
인증한다(`requireAuth`, 라우터 전체). **오늘 출석 보상의 자동 지급은 이 라우터가 아니라
`GET /player/me`(`16_PLAYER_API.md`)의 로그인 처리에서 일어난다** — 지급은 우편(Mailbox)으로
발송되고, 플레이어는 `POST /mailbox/:mailId/claim`으로 수령해야 재화/카드가 반영된다.

### `GET /attendance`

플레이어의 현재 출석부 진행 상태(GENERAL 1건 + EVENT 목록)를 조회한다. 날짜별 상태와 캐치업
가능 여부는 전부 서버가 계산해 내려주고, 프론트는 그대로 렌더링만 한다(직접 계산 금지).
**인증 필요.**

**응답**
```json
{
  "result": 0,
  "general": {
    "defId": "general_launch",
    "name": "일일 출석",
    "type": "GENERAL",
    "startDate": "2026-09-19",
    "endDate": "2026-10-19",
    "days": [
      { "day": 1, "state": "ATTENDED", "rewards": [{ "itemType": "gold", "amount": 100, "cardTemplateId": null }] },
      { "day": 2, "state": "CATCHUP_AVAILABLE", "rewards": [{ "itemType": "gold", "amount": 200, "cardTemplateId": null }] }
    ],
    "catchup": { "remainingPurchases": 3, "nextPrice": 200, "canAfford": true }
  },
  "events": []
}
```

- `general`: 진행 중인 GENERAL 출석부. 발급 대상이 없으면 `null`.
- `events`: 진행 중인 EVENT 출석부 목록 — `endDate` 오름차순(곧 끝나는 이벤트가 먼저).
- `name`: 표시용 이름(발급 시점 스냅샷). `defId`는 키다.
- `days[].state`:

  | 값 | 의미 |
  |---|---|
  | `ATTENDED` | 출석 처리됨(정상 수령 또는 캐치업 구매) |
  | `TODAY` | 오늘 |
  | `FUTURE` | 아직 오지 않음(보상은 미리 공개) |
  | `CATCHUP_AVAILABLE` | 놓쳤고 캐치업 구매 가능 |
  | `CATCHUP_UNAVAILABLE` | 놓쳤지만 구매 횟수를 소진해 구매 불가 |

- `catchup.nextPrice`: 다음 구매 가격. 구매 횟수를 소진했으면 `null`. `canAfford`는 보유 골드로
  다음 구매가 가능한지.

**에러**: 9002(미인증), 1001(세션은 유효한데 플레이어 문서가 없는 이례적 상황)

### `POST /attendance/:defId/catchup`

놓친 날짜 하나를 골드로 구매한다. **인증 필요.** 골드 차감 + 보상 우편 발송 + 출석 처리를
세션 기반 멀티도큐먼트 트랜잭션으로 묶어 원자적으로 처리한다. 보상은 즉시 지급되지 않고
우편으로 발송된다(제목 `[{name}] {rotationCount}회차 {day}일차 출석 보상(캐치업)`).

**요청 body**
```json
{ "day": 2 }
```
`day`는 출석부 내 일차(1-based, 캘린더 날짜가 아님)이며 숫자여야 한다.

**응답**
```json
{
  "result": 0,
  "price": 200,
  "attachments": { "gold": 200 }
}
```
`price`는 이번 구매에서 실제로 차감된 골드, `attachments`는 우편으로 발송된 내용이다.

**에러**

| Result Code | HTTP | 설명 |
|---|---|---|
| 9002 | 401 | 미인증 |
| 12000 | 400 | `day`가 숫자가 아니거나 유효 범위 밖(1 미만, 오늘 이상 — 오늘은 자동 지급 대상이라 구매 불가) |
| 12001 | 404 | 존재하지 않는 출석부(이 플레이어에게 발급된 적 없음) |
| 12002 | 409 | 이미 출석 처리(지급)된 날짜 |
| 12003 | 409 | 골드 부족 |
| 12004 | 409 | 캐치업 구매 가능 횟수 소진 |
| 12005 | 409 | 이미 종료된 출석부 |
| 12999 | 500 | 일시적인 서버 오류 |

**멱등/이중 지급 방지**: 자동 지급과 캐치업 구매가 같은 우편 `sourceId`
(`{playerId}_{defId}_{day}`)를 써서 `player_mailbox`의 `(sourceType, sourceId)` 유니크 인덱스
하나로 이중 지급을 막는다. 자동 지급이 이미 나간 날짜를 구매하려 하면 우편 삽입이 멱등
스킵되며 12002로 거부되고, 그 순간 차감한 골드도 트랜잭션 abort로 함께 롤백된다.

### 로그인 시 자동 지급 알림 (`GET /player/me`)

`GET /player/me` 응답의 `attendanceNotice`(`granted[]`/`generalStarted`)가 자동 지급 결과를
알린다 — 필드 설명은 `16_PLAYER_API.md`. 그날 첫 호출에서만 채워지고 이후 호출은 멱등
스킵되어 비어 있다.
