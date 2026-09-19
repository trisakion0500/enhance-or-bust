# 16_PLAYER_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md` 참고.

### `GET /player/me`

로그인한 자기 자신의 재화/clearedStage/보유 카드를 조회한다. 인벤토리 각 카드는
마스터 데이터(카드 원형)와 서버가 미리 조인해 등급/공격력/체력/속성까지 함께 내려준다
— 프론트가 별도로 마스터 데이터를 조회할 필요가 없다. 같은 이유로 전투 출전 스쿼드
최대 장수(`squadMaxSize`, `SQUAD_MAX_SIZE` env 기반)와 합성 규칙 전체
(`synthesisRules`, 마스터 데이터)도 이 응답에 함께 실어 보낸다 — 프론트가 이런 설정/규칙
조회용 별도 엔드포인트를 호출할 필요가 없다. 프론트는 이 엔드포인트 호출 성공 여부로
로그인 여부도 함께 판단한다(별도 whoami 엔드포인트 없음). 이 호출이 곧 로그인 시
출석보상 처리 지점이라(`25_ATTENDANCE_API.md`), 오늘 자동 지급된 출석 보상/GENERAL
신규 발급 여부(`attendanceNotice`)도 응답에 함께 실린다 — 그날 첫 호출에서만 채워지고
이후 호출은 멱등 스킵이라 비어 있다. **인증 필요.**

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
  ],
  "attendanceNotice": {
    "granted": [{ "defId": "general_launch", "type": "GENERAL", "day": 1 }],
    "generalStarted": true
  }
}
```

- `attendanceNotice.granted`: 이번 호출에서 새로 지급(우편 발송)된 출석 보상 목록(GENERAL 최대
  1건 + EVENT N건). 없으면 빈 배열.
- `attendanceNotice.generalStarted`: 이번 호출에서 GENERAL 출석부가 신규 발급(최초/로테이션)됐는지.

**에러**: 9002(미인증), 1001(세션은 유효한데 플레이어 문서가 없는 이례적 상황)
