# 13_SYNTHESIS_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 동시성 처리 흐름은
`06_ENHANCEMENT_SYNTHESIS_SCENARIO.md` 참고.

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
