# 23_GAME_DESIGN_ATTENDANCE.md

출석보상 시스템 — GAME_DESIGN.md 5절(재화 체계)/7절(우편 시스템 발송 트리거)에 언급된
"일일 출석 보상"의 상세 정책/설계 문서다. coupon_platform 연동 때와 동일하게, 확정본인
GAME_DESIGN.md 본문은 건드리지 않고 이 문서로 분리한다.

## 개요

**일반출석부(GENERAL)**와 **이벤트출석부(EVENT)** 두 유형으로 구성된다. 둘 다 월간
캘린더형(날짜별 보상 고정 매핑) UI 기반이며, 처리 로직은 거의 동일하고 "종료 후
로테이션 여부"만 다르다.

- **GENERAL**: 시스템 전체에서 항상 최대 1개 라인만 활성. 유저별로 n일 진행 후
  종료되면, 그 시점에 활성화된 정의를 찾아 자동으로 재발급(로테이션)된다.
- **EVENT**: 여러 개가 동시에 병렬로 진행 가능(서로 겹쳐도 무방). n일 진행 후 완전히
  종료되며 재발급되지 않는다. 같은 이벤트를 재오픈하려면 새 비즈니스 키(defId)로
  신규 등록한다(예: `event_chuseok_2026` → `event_chuseok_2027`) — 시스템 차원의
  "재오픈" 기능은 없다.

## 핵심 원칙 — 시드 스냅샷

관리자가 새 출석부 정의(def)를 추가/등록해도 **이미 발급되어 진행 중인 유저의
인스턴스는 절대 영향받지 않는다.** 인스턴스는 발급 시점 def 내용(기간/보상 구성/
캐치업 정책)을 그대로 복사(스냅샷)해서 보관하며, 이후 def 원본이 바뀌어도 무관하게
끝까지 진행된다 — `coupon_redemptions`가 coupon_platform 응답을 발급 시점에 스냅샷해
소스 오브 트루스로 삼는 것과 같은 원칙(`20_COUPON_PLATFORM_INTEGRATION.md`).

- gm_platform 등록 규칙: `enrollableStart`가 이미 지나 발급이 시작된 def는
  **수정 불가**(읽기 전용), 변경이 필요하면 새 def를 append-only로 추가한다.
- GENERAL 라인은 신규 def 등록 시 `enrollableStart`가 현재 활성 GENERAL def의
  `enrollableEnd` 이후여야 한다(겹침 방지 검증).
- EVENT는 재오픈 개념이 없으므로 defId 중복 등록 방지 검증만 하면 된다.

## 데이터 구조 (정책 레벨 — 실제 필드 타입/인덱스는 구현 시 확정)

### 출석부 정의(시드데이터)

**헤더**: `defId`(비즈니스 키), `type`(GENERAL/EVENT), `enrollableStart`,
`enrollableEnd`, `durationDays`, 캐치업 정책.

**날짜별 보상 구성**: `defId`+`day`를 키로 갖는 flat row로 별도 컬렉션 관리(하루에
아이템이 여러 종류면 같은 `(defId, day)`로 행이 여러 개). 아이템 자체는 기존
Inventory/Economy 아이템 마스터를 `itemId`로 참조하고 별도 마스터는 만들지 않는다.
flat row로 뽑은 이유: gm_platform이 데이터 기반 파라미터 등록 방식으로 프론트를
자동 렌더링하는데, "day별 아이템 배열" 같은 1:n 중첩 구조는 기획자가 JSON을 직접
편집해야 해서다.

### 비즈니스 키 vs 내부 PK

시드데이터 컬렉션은 내부 PK(자동 생성)와 비즈니스 키(defId, DB 레벨 unique 인덱스)를
분리한다 — 카드 시드데이터의 `templateId` 패턴과 같은 원칙(PK에 비즈니스 키를 직접
넣으면 운영툴에서 defId를 나중에 수정해야 할 때 PK 불변 제약에 걸림). 단, 기존
`master_*` 컬렉션들은 시드 스크립트가 순차 1회성으로만 쓰기 때문에 DB 레벨 unique
인덱스 없이 upsert만으로 유일성을 지키는 반면(`shared-kernel/collectionNames.ts`
참고 컬렉션들), 이 컬렉션들은 gm_platform이 운영 중 실시간으로 쓰기 때문에 실제
unique 인덱스를 둔다 — 두 그룹의 쓰기 패턴이 다른 데서 오는 의도적인 차이다.

- "이미 시작된 def는 수정 불가" 원칙과 결합하면, defId 수정이 실질적으로 허용되는
  건 아직 시작 전인 def뿐이다.
- defId를 수정하면 날짜별 보상 row 쪽 참조도 함께 일괄 update해야 한다(구현 시 누락
  주의).

### 유저 발급 인스턴스(런타임 데이터)

플레이어별 발급 진행 상태. GENERAL 1개 + EVENT N개를 동시에 보유 가능하므로 플레이어
문서에 embedding하지 않고 별도 컬렉션으로 둔다(Mailbox와 동일 패턴).

**보유 정보**: `playerId`, `defId`, `type`, 발급 시점 def 스냅샷, 캐치업 구매 횟수,
`startDate`, `endDate`, `attendedDays`(아래), `status`(ACTIVE/COMPLETED).

- 유니크 키: `(playerId, defId)`이지만, **ACTIVE 상태인 문서에만 적용되는 partial 유니크
  인덱스**다 — GENERAL은 같은 defId를 영구히 재사용하며 로테이션마다 새 인스턴스를
  발급할 수 있어(완료된 과거 인스턴스는 컬렉션에 그대로 남음), 유니크 제약을 전체
  문서가 아니라 "현재 ACTIVE인 문서 1개"로만 좁혀야 정상적인 순차 로테이션이 막히지
  않는다. 막는 대상은 어디까지나 "동시 로그인 레이스로 같은 순간에 발급이 두 번
  시도되는 것"뿐이다.
- "유저의 현재 ACTIVE GENERAL" 조회: `(playerId, type=GENERAL, status=ACTIVE)`.
  시스템상 항상 최대 1개만 존재해야 한다.

### 출석 여부 저장 방식

`attendedDays`를 배열로 저장하고 `$addToSet`으로 push한다 — 원자적이고 멱등(중복
값 자동 무시)이라 낙관적 락이나 별도 동시성 제어가 필요 없다. 비트마스크 방식은
`durationDays`가 관리자가 자유롭게 정하는 값이라 상한을 미리 못 박기 애매해(상한 없이
가려면 BigInt 처리 필요) 기각했다.

`durationDays`는 `attendance_book_defs`에 명시 필드로 유지하되, gm_platform 저장
시점에 `attendance_rewards`의 해당 `defId` 최대 `day` 값과 일치하는지 검증한다
(불일치 시 저장 거부) — `catchupMaxCount` ↔ 캐치업 가격 row 개수 검증과 동일한 패턴.

## 캐치업(놓친 날짜 구매) 기능

### 구매 조건

- 인스턴스가 `ACTIVE` 상태일 때만(종료 후 구매 불가, 유예기간 없음)
- 구매하려는 날짜가 `day < currentDay`(오늘은 이미 자동지급 대상이라 캐치업 대상에서
  제외)
- 아직 출석 처리 안 된 날짜일 것
- 해당 인스턴스의 캐치업 구매 횟수가 최대 허용 횟수 미만일 것

### 가격 정책

- 재화는 골드만 사용(유무료 구분 없음).
- 가격은 "몇 일차를 사는지"가 아니라 **몇 번째 구매인지**에 붙는다 — 회차별
  flat row로 별도 컬렉션에 명시 등록(`defId` + `purchaseIndex`당 가격 하나).
- `attendance_book_defs.catchupMaxCount`와 가격 row 개수가 항상 일치해야 한다 —
  gm_platform 저장 시점에 검증(불일치 시 거부), 발급 로직에서도 방어적으로
  `min(catchupMaxCount, 실제 row 개수)` 처리를 권장.
- GENERAL 로테이션/EVENT 종료로 새 인스턴스가 발급되면 구매 횟수도 자동 리셋(인스턴스
  필드이므로).

### 구매 처리 흐름과 sourceId 통일 — 이중 지급 방지

> **설계 검토에서 발견**: 자동지급과 캐치업 지급의 Mailbox `sourceId`를 다르게 두면
> (예: 자동지급 `{playerId}_{defId}_{day}`, 캐치업 `..._purchased`), 자동지급
> Mailbox insert가 성공한 직후 `$addToSet` 실패/크래시 → 자정 경과로 그 후 로그인
> 재시도(같은 날 재시도라면 `sourceId`가 같아 idempotent 스킵으로 안전했겠지만, 날짜가
> 넘어가면 재시도 대상 자체가 사라짐)가 그 날짜를 "미출석"으로 오인 → 유저가 그 날짜를
> 골드 주고 캐치업 구매하면 서로 다른 `sourceId`라 이미 나간 자동지급 우편과 별개로
> 우편이 또 나가는, 좁지만 실재하는 이중 지급 창이 있었다. `coupon_redemptions`의
> `mailGrantedAt`/재처리 배치가 막던 것과 같은 종류의 문제인데, 이 기능은 별도
> 재처리 배치를 두지 않으므로 sourceId 자체를 통일해 mailbox 유니크 인덱스 하나로
> 막는 쪽을 택한다.

**결정**: 자동지급/캐치업 구매 모두 **동일한 sourceId**(`{playerId}_{defId}_{day}`)를
쓴다.

1. 구매 조건(위) 검증
2. 현재 구매 횟수 기준 가격 계산
3. 세션 트랜잭션 시작:
   a. 골드 조건부 차감 — `{economy.gold: {$gte: price}}` 필터로 TOCTOU 방지,
      `matchedCount === 0`이면 골드 부족으로 즉시 중단(ClaimMail의 players 쓰기가
      트랜잭션 내에서 `version` 낙관적 락 대신 조건부 `$inc`만 쓰는 것과 동일한 이유 —
      트랜잭션 자체가 write-conflict 직렬화를 해준다, `mongoMailboxRepository.ts`
      `claimMail()` 참고)
   b. Mailbox insert(sourceId는 위와 동일 키) — 반환값이 `false`(이미 발송됨, 자동지급이
      먼저 나갔던 좁은 레이스)면 **여기서 트랜잭션을 abort하고 "이미 지급된 날짜"
      에러로 응답** — 골드를 이미 조건부 차감했더라도 트랜잭션 abort로 자동 롤백되어
      안전
   c. 인스턴스 `$addToSet` + 캐치업 구매 횟수 증가
4. 커밋

## 로그인 시 처리 흐름 (GENERAL/EVENT 공통 단일 함수)

날짜 경계("오늘") 판단은 서버 로컬 타임존을 따른다 — `dailyActive.ts`의
`todayDateString()`(로컬 `getFullYear`/`getMonth`/`getDate` 조립, `toISOString()` 안
씀)과 동일한 패턴을 재사용한다.

> **트리거 지점 결정**: `GET /player/me`(게임 화면 초기화 겸 로그인 확인 엔드포인트)에
> 건다. `markDailyActive()`처럼 `requireAuth`에 fire-and-forget으로 얹으면 프론트가
> "방금 지급됐다"를 동기적으로 알 방법이 없어 아래 "알림/안내"의 자동지급 토스트
> 요구사항과 맞지 않는다 — `GET /player/me` 응답 안에서 동기적으로 처리하고, 응답에
> 오늘 새로 지급된 보상/GENERAL 로테이션 발생 여부를 실어 프론트가 그 응답 하나로
> 알럿을 띄울 수 있게 한다. 이 엔드포인트는 페이지 진입/새로고침마다 호출되므로 로직은
> 멱등해야 하는데(이미 오늘 처리됐으면 즉시 스킵), 위 "로그인 시 처리 흐름"의 각
> 단계(출석 미처리 여부 확인, `$addToSet`)가 이미 그 전제로 설계돼 있어 별도 처리
> 없이 그대로 재사용 가능하다.

```
1. 유저의 모든 ACTIVE 인스턴스 조회 (GENERAL 최대 1개 + EVENT N개)
2. 각 인스턴스별:
   a. 오늘 출석 미처리 상태면:
      - 오늘자 보상 즉시 Mailbox 지급 (자동즉시지급, 수령 버튼 없음)  ← 반드시 먼저
      - $addToSet으로 attendedDays에 오늘 날짜 추가                  ← 반드시 나중
        (순서를 바꾸면 크래시 시 그 날짜 보상이 영구 유실됨 — 재시도 자체가
        "미출석" 여부로 판단되므로, 먼저 출석 마킹부터 해버리면 다음 로그인이
        "이미 출석했다"고 오인해 다시는 지급을 시도하지 않는다)
   b. 오늘 >= endDate 면:
      - status = COMPLETED (문서는 그대로 남김, 별도 로그 이관 없음)
      - type === GENERAL이면 로테이션 시도: 현재 활성 GENERAL def 탐색 → 새 인스턴스
        발급 (unique 키 (playerId, defId) 삽입을 `recordReserved()`의 `$setOnInsert`
        upsert나 `PlayerRepository.create()`처럼 중복 키(11000) 무해 무시로 처리 —
        동시 로그인 레이스에서 이중 발급되지 않게)
      - type === EVENT면 여기서 종료, 재발급 없음
3. ACTIVE 인스턴스가 없는 슬롯(GENERAL 미보유 유저, 신규 오픈 EVENT)에 대해
   현재 활성 def 탐색 후 신규 발급 (2b의 로테이션 발급과 같은 로직 재사용 —
   중복 구현하지 않는다)
```

### 출석 패턴

날짜별 개근 체크 방식이라 연속 출석형이 아니다. 중간에 접속을 안 해도 리셋되지
않고, 그날 보상만 유실된다(캐치업 구매로만 복구 가능).

```
1일차 접속 → 1일차 보상 지급
2일차 접속 → 2일차 보상 지급
3일차 미접속 → 아무 일도 없음 (3일차 보상 유실, 리셋 없음, 이후 캐치업 구매로만 복구 가능)
4일차 접속 → 4일차 보상 정상 지급
```

## 유저 데이터 누적 방식

GENERAL/EVENT 모두 사이클/이벤트마다 새 인스턴스 document를 발급한다(기존 document
리셋 재사용 안 함). 종료된 인스턴스는 `status: COMPLETED`로 컬렉션에 그대로 남기고
별도 로그 컬렉션으로 이관하지 않는다 — 운영 복잡도를 낮추기 위한 결정, 컬렉션이
계속 커지는 건 감수(조회는 `(playerId, status)` 인덱스로 필터링돼 영향 적음).

## 원자성/트랜잭션 전략 (MongoDB)

| 케이스 | 처리 방식 |
|---|---|
| 일반 출석 지급(골드 미사용) | 순차 처리. `$addToSet` 원자 연산 + Mailbox 멱등키(`sourceType`+`sourceId` 유니크 인덱스)로 안전. 세션 트랜잭션 불필요 |
| 캐치업 구매(골드 차감+지급+출석처리) | 세션 기반 멀티도큐먼트 트랜잭션 — ClaimMail(`mailbox`+`players`)과 동일 근거, 여기에 인스턴스 컬렉션까지 3개 |
| 출석부 정의(시드) 등록/수정 | 동시성 이슈 거의 없음(gm_platform에서만 쓰기 발생, 시작된 def는 수정 자체를 막음). 낙관적 락 불필요 |

**Mailbox 멱등키**: `sourceType: "attendance"`(GENERAL) / `"attendance_event"`(EVENT),
`sourceId: {playerId}_{defId}_{day}` — 자동지급/캐치업 구매 공통(위 "sourceId 통일"
참고).

## 감사 로그 (TBD)

`08_AUDIT_LOG_POLICY.md`의 대상 액션 표에 아직 이 기능이 없다. `log_coupon`과 같은
급으로 상태변경 액션(`attend`/`catchup_purchase`/`issue`)을 감사 로그에 남길지는
구현 착수 전 정책 확정 및 표 추가가 필요하다.

## 프론트엔드 요구사항

### 출석현황표(달력 UI)

날짜별 상태는 서버가 계산해서 내려준다(프론트 직접 계산 금지 — 로직 중복/버그
위험): 정상 수령 / 놓쳤고 캐치업 구매 가능 / 놓쳤지만 구매 불가(횟수 소진 또는
인스턴스 종료) / 오늘 / 미래(잠김). 미래 날짜 보상도 미리 공개한다(동기부여 목적).

### 캐치업 구매 버튼

노출 정보: 이번 구매 가격, 남은 구매 가능 횟수, 보유 골드 대비 구매 가능 여부.
에러 케이스 3종 구분: 골드 부족 / 최대 구매 횟수 소진 / 인스턴스 이미 종료(로테이션
타이밍 겹침 등) — API 에러코드도 이 3종을 구분해서 내려준다.

### 알림/안내

- 로그인 시 자동지급 알림: 버튼 없이 자동 지급되므로 토스트/알럿 필수.
- GENERAL 로테이션 안내: 로테이션 발생 당일에만 "새로운 출석부가 시작됐습니다" 노출
  (그날만, 상시 배너 아님).
- EVENT 종료임박 뱃지는 적용하지 않는다.

### 탭 구조

GENERAL/EVENT 별도 탭. EVENT 다건 진행 시 정렬은 `endDate` 오름차순(곧 끝나는
이벤트가 위로). 이벤트가 없어도 탭은 유지하고 빈 상태로 표시.

### API

최소 2개: 인스턴스별 날짜 상태/보상/캐치업 정보 조회용 1개, 캐치업 구매 처리용
1개. 상세 스펙은 구현 착수 시 별도 API 문서(`24_ATTENDANCE_API.md` 등)로 확정한다.

## gm_platform 관리 규칙 요약

- GENERAL: 신규 def 등록 시 `enrollableStart > 현재 활성 GENERAL def.enrollableEnd`
  검증
- EVENT: defId 중복 등록 방지만 검증
- 이미 `enrollableStart`가 지난 def는 수정 불가(읽기 전용), 변경은 append-only
  신규 등록으로만
- defId 수정(아직 시작 전 def에 한해 허용) 시 보상 row/캐치업 가격 row 참조도 함께
  일괄 update
- 캐치업 가격 row 개수와 `catchupMaxCount` 필드값 일치 검증(저장 시점)
- `durationDays` 필드값과 보상 row의 해당 defId 최대 `day`값 일치 검증(저장 시점)

## 재사용 vs 신규

- **재사용**: Mailbox(보상 지급 경로), Economy(골드 차감), 기존 아이템 마스터 카탈로그
- **신규**: 출석부 정의(시드), 날짜별 보상 구성(시드), 캐치업 회차별 가격(시드),
  유저 발급 인스턴스(런타임)

## 미결정(TBD)

- [ ] 캐치업 회차별 실제 가격 수치(밸런싱)
- [ ] 날짜별 보상 아이템/수량 실제 값(밸런싱)
- [ ] GENERAL 최초 시드 데이터(첫 라인) 실제 값
- [ ] gm_platform 관리화면 상세 UI 스펙
- [ ] 실제 컬렉션 스키마(필드 BSON 타입, 인덱스 설계)
- [ ] 감사 로그 정책 반영 여부(`08_AUDIT_LOG_POLICY.md`)
