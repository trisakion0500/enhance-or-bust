# 12_ENHANCEMENT_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 동시성 처리 흐름은
`06_ENHANCEMENT_SYNTHESIS_SCENARIO.md` 참고.

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
