# 23_GAME_DESIGN_ATTENDANCE.md

출석보상 시스템 — GAME_DESIGN.md 5절(재화 체계)/7절(우편 시스템 발송 트리거)에 언급된
"일일 출석 보상"의 상세 정책/설계 문서다. coupon_platform 연동 때와 동일하게, 확정본인
GAME_DESIGN.md 본문은 건드리지 않고 이 문서로 분리한다.

## 개요

**일반출석부(GENERAL)**와 **이벤트출석부(EVENT)** 두 유형으로 구성된다. 둘 다 월간
캘린더형(날짜별 보상 고정 매핑) UI 기반이며, 처리 로직은 거의 동일하다.

- **GENERAL**: 시스템 전체에서 항상 최대 1개 라인만 활성(유저별로는 항상 정확히
  최대 1개 ACTIVE 인스턴스만 보유). 유저별로 n일 진행 후 종료되면, 그 시점에
  활성화된 정의를 찾아 자동으로 재발급을 시도한다.
- **EVENT**: 여러 개가 동시에 병렬로 진행 가능(서로 겹쳐도 무방). n일 진행 후 종료되면
  같은 def로 재발급을 시도한다.

**재발급(로테이션)이 실제로 일어나는지는 `type`이 아니라 `maxRotationCount`가
결정한다** — 아래 "로테이션 가능 횟수" 절 참고. GENERAL/EVENT는 "동시에 몇 개까지
진행 가능한가"(1개 vs N개 병렬)만 구분하는 축이고, 재발급 가능 여부는 완전히 별개
축이다. 같은 이벤트를 새 비즈니스 키로 다시 열고 싶으면(예: `event_chuseok_2026` →
`event_chuseok_2027`) 여전히 새 defId로 신규 등록한다 — `maxRotationCount`는 "같은
defId를 반복 재발급"하는 것이지 "새 defId를 여는" 기능이 아니다.

## 핵심 원칙 — 시드 스냅샷

관리자가 새 출석부 정의(def)를 추가/등록해도 **이미 발급되어 진행 중인 유저의
인스턴스는 절대 영향받지 않는다.** 인스턴스는 발급 시점 def 내용(기간/보상 구성/
캐치업 정책)을 그대로 복사(스냅샷)해서 보관하며, 이후 def 원본이 바뀌어도 무관하게
끝까지 진행된다 — `player_coupon`이 coupon_platform 응답을 발급 시점에 스냅샷해
소스 오브 트루스로 삼는 것과 같은 원칙(`20_COUPON_PLATFORM_INTEGRATION.md`).

- gm_platform 등록 규칙: `enrollableStart`가 이미 지나 발급이 시작된 def는
  **수정 불가**(읽기 전용), 변경이 필요하면 새 def를 append-only로 추가한다.
- GENERAL 라인은 신규 def 등록 시 `enrollableStart`가 현재 활성 GENERAL def의
  `enrollableEnd` 이후여야 한다(겹침 방지 검증).
- EVENT는 재오픈 개념이 없으므로 defId 중복 등록 방지 검증만 하면 된다.

## 데이터 구조 (정책 레벨 — 실제 필드 타입/인덱스는 구현 시 확정)

### 출석부 정의(시드데이터)

**헤더**: `defId`(비즈니스 키), `name`(표시용 이름 — 아래 참고), `type`(GENERAL/EVENT), `targetAudience`(발동 타입 —
아래 절 참고), `returningInactiveDays`(선택, `targetAudience=RETURNING_USER`일 때만
사용), `maxRotationCount`(로테이션 가능 횟수 — 아래 절 참고), `enrollableStart`,
`enrollableEnd`, `durationDays`, 캐치업 정책.

### 표시용 이름(`name`)

`defId`는 키이고, 운영 중 보상 구성이 바뀌면 새 출석부(새 defId)를 발급하는 식으로
쓰므로 사람이 읽는 이름을 별도 필드로 둔다(예: defId `general_launch` → name "일일 출석").
키가 아니라서 중복돼도 무방하다. 발급 시점에 인스턴스 `snapshot.name`으로 복사되어 이후
def 이름이 바뀌어도 이미 발급된 인스턴스/우편은 영향받지 않는다(이름 추가 이전에 발급된
인스턴스는 표시할 때 현재 마스터 def의 이름 → defId 순으로 폴백). 출석 화면 제목과 우편 제목에 쓰인다:
`[{name}] {rotationCount}회차 {day}일차 출석 보상` (캐치업 구매는 끝에 `(캐치업)`).

### 로테이션 가능 횟수(`maxRotationCount`)

GENERAL/EVENT 공통 필드다 — "몇 번 재발급 가능한가"를 true/false가 아니라 횟수로
관리한다. 최초 발급은 이 값과 무관하게 항상 일어난다(로테이션이 아니라 최초
발급이므로). 그 이후 재발급(로테이션) 가능 여부는 인스턴스 문서의 `rotationCount`
필드(지금까지 이 defId로 발급된 횟수, 최초 발급=1)가 `maxRotationCount`를 넘지 않을
때만 허용된다 — 즉 `maxRotationCount=0`이면 최초 발급(1건) 이후 재발급이 전혀
없고(과거 EVENT의 "재오픈 없음"과 동일한 결과), `maxRotationCount=N`이면 최초 발급
포함 총 N+1번 발급된다. `rotationCount`는 인스턴스 문서에 저장되는 필드다("유저 발급
인스턴스" 절 참고) — 문서를 사이클마다 새로 발급하지 않고 재사용(in-place 리셋)하기
때문에 컬렉션에 과거 이력이 남지 않아, 카운트 쿼리로 대체할 방법이 없다.

"무제한"을 나타내는 별도 값(null 등)은 두지 않는다 — 사실상 무제한이 필요하면(예:
GENERAL 상시 라인) 관리자가 충분히 큰 수(예: 999999)를 직접 입력한다.

- GENERAL도 이 필드로 통일 관리된다. 다만 GENERAL은 "시스템 전체 최대 1개 라인"
  제약이 별개로 있어, 로그인 처리 흐름에서 재발급 시도 전에 먼저
  `findActiveGeneralInstance`로 "이미 ACTIVE인 GENERAL이 있는지"부터 확인한다(활성
  def가 바뀌어 defId가 달라져도 이 체크가 먼저 막아준다) — `maxRotationCount`는 그
  다음에 "이 defId가 몇 번 더 재발급될 수 있는지"만 본다.
- 활성 def가 여전히 `enrollableStart~enrollableEnd` 범위 안이어도, 로테이션 횟수를
  소진한 유저에게는 더 이상 재발급되지 않는다 — 그 지점부턴 관리자가 새 defId를
  append-only로 등록해야 그 유저도 다시 받을 수 있다(GENERAL은 "겹침 방지 검증"이
  이미 이 경우를 append-only 신규 등록으로 처리하도록 요구하고 있어 자연스럽게
  맞아떨어진다).

**날짜별 보상 구성**: `defId`+`day`를 키로 갖는 flat row로 별도 컬렉션 관리(하루에
아이템이 여러 종류면 같은 `(defId, day)`로 행이 여러 개). 아이템 자체는 기존
Inventory/Economy 아이템 마스터를 `itemId`로 참조하고 별도 마스터는 만들지 않는다.
flat row로 뽑은 이유: gm_platform이 데이터 기반 파라미터 등록 방식으로 프론트를
자동 렌더링하는데, "day별 아이템 배열" 같은 1:n 중첩 구조는 기획자가 JSON을 직접
편집해야 해서다.

### 발동 타입(대상자 조건, `targetAudience`)

GENERAL/EVENT(`type`, 로테이션 여부)와 직교하는 별도 축이다 — 예를 들어 "복귀유저 전용
이벤트"는 `type=EVENT` + `targetAudience=RETURNING_USER` 조합으로 표현한다.

**발동가능 기간(`enrollableStart <= 현재 <= enrollableEnd`) 체크는 세 타입 공통
전제 조건**이고, `NEW_USER`/`RETURNING_USER`는 여기에 조건이 하나 더 붙는 구조다.
`enrollableEnd`가 지난 def는 `targetAudience`와 무관하게 발급 후보에서 제외된다(기존
"발급 가능 종료 시각" 규칙 그대로).

| targetAudience | 추가 조건 |
|---|---|
| `ALL_USERS`(기본값) | 없음 — 기간만 체크 |
| `NEW_USER` | `player.createdAt >= def.enrollableStart`(이 def가 열린 뒤에 가입한 유저만) |
| `RETURNING_USER` | `(오늘 - player.lastLoginAt) >= def.returningInactiveDays` |

- 활성 def가 대상 조건에 안 맞으면 그 유저에게는 발급되지 않는다(예: 현재 활성
  GENERAL def가 `NEW_USER` 전용이면, 기존 유저는 그 사이클엔 GENERAL 출석부를 아예
  못 받는다 — 자연스러운 귀결이며 별도 폴백은 없다).
- **구현 선행 필요**: 이 기능은 `Player` 애그리게잇에 아직 없는 필드 2개를 전제로
  한다 — `createdAt`(가입일시), `lastLoginAt`(마지막 로그인일시). 로그인 시각은
  현재 `log_auth` 감사로그에만 남고 게임 로직이 조회 가능한 필드가 아니다.
  `lastLoginAt` 갱신은 `authService.ts`의 `loginOrRegister()`가 아니라
  `GET /player/me`(`playerService.ts`의 `getPlayerSummary()`) 쪽에서 한다 —
  `processLoginAttendance()`가 RETURNING_USER 판정에 "갱신되기 전" 값을 필요로 하는데,
  로그인 시점에 먼저 갱신해버리면 뒤이은 `GET /player/me` 호출에서 그 값이 이미
  "방금"으로 덮여 있어 며칠 지났는지를 항상 0으로 잘못 계산하게 된다. 그래서
  `getPlayerSummary()`가 이전 값을 읽어 `processLoginAttendance()`에 넘긴 뒤에야
  지금 시각으로 갱신한다.
- gm_platform 저장 시점 검증: `targetAudience=RETURNING_USER`면
  `returningInactiveDays` 필수(그 외 타입에서는 의미가 없으므로 값이 있어도 무시하거나
  저장을 거부한다 — 구현 시 택일).

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

**보유 정보**: `playerId`, `defId`, `type`, 발급 시점 def 스냅샷, `rotationCount`(이
defId로 지금까지 발급된 횟수, 최초 발급=1, 리셋마다 +1), 캐치업 구매 횟수,
`startDate`, `endDate`, `attendedDays`(아래), `status`(ACTIVE/COMPLETED).

- 유니크 키: `(playerId, defId)` **완전 유니크 인덱스**(문서 전체 대상, partial 아님) —
  GENERAL/EVENT 모두 사이클마다 새 문서를 발급하지 않고 기존 문서를 **in-place로
  리셋해 재사용**하기 때문에 문서가 정확히 1개만 있으면 된다(아래 "유저 데이터 누적
  방식" 절). 동시 로그인 레이스로 같은 순간에 최초 발급이 두 번 시도되는 경우도 이
  인덱스 하나로 막힌다.
- "유저의 현재 ACTIVE GENERAL" 조회: `(playerId, type=GENERAL, status=ACTIVE)`.
  시스템상 항상 최대 1개만 존재해야 한다.

### 출석 여부 저장 방식

`attendedDays`를 배열로 저장하고 `$addToSet`으로 push한다 — 원자적이고 멱등(중복
값 자동 무시)이라 낙관적 락이나 별도 동시성 제어가 필요 없다. 비트마스크 방식은
`durationDays`가 관리자가 자유롭게 정하는 값이라 상한을 미리 못 박기 애매해(상한 없이
가려면 BigInt 처리 필요) 기각했다.

`durationDays`는 `master_attendance_defs`에 명시 필드로 유지하되, gm_platform 저장
시점에 `master_attendance_rewards`의 해당 `defId` 최대 `day` 값과 일치하는지 검증한다
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
- `master_attendance_defs.catchupMaxCount`와 가격 row 개수가 항상 일치해야 한다 —
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
> 우편이 또 나가는, 좁지만 실재하는 이중 지급 창이 있었다. `player_coupon`의
> `mailGrantedAt`/재처리 배치가 막던 것과 같은 종류의 문제인데, 이 기능은 별도
> 재처리 배치를 두지 않으므로 sourceId 자체를 통일해 player_mailbox 유니크 인덱스 하나로
> 막는 쪽을 택한다.

**결정**: 자동지급/캐치업 구매 모두 **동일한 sourceId**(`{playerId}_{defId}_{day}`)를
쓴다.

1. 구매 조건(위) 검증
2. 현재 구매 횟수 기준 가격 계산
3. 세션 트랜잭션 시작:
   a. 골드 조건부 차감 — `{economy.gold: {$gte: price}}` 필터로 TOCTOU 방지,
      `matchedCount === 0`이면 골드 부족으로 즉시 중단(ClaimMail의 player 쓰기가
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
      - (재발급 자체는 여기서 바로 하지 않는다 — 3단계에서 GENERAL/EVENT 공통으로 처리)
3. ACTIVE 인스턴스가 없는 슬롯(GENERAL 미보유 유저, 방금 완료된 인스턴스, 신규 오픈
   EVENT)에 대해 현재 활성 def 탐색 후 재발급/신규발급 시도(GENERAL/EVENT 공통 로직,
   "로테이션 가능 횟수" 절의 `maxRotationCount` 판정). "현재 활성
   def 탐색"은 발동가능 기간뿐 아니라 targetAudience 조건까지 함께 만족하는 def만
   후보로 삼는다(위 "발동 타입" 절 참고) — 대상 조건에 안 맞으면 발급하지 않는다.
   최초 발급은 완전 unique 키 `(playerId, defId)` 삽입을 `recordReserved()`의
   `$setOnInsert` upsert나 `PlayerRepository.create()`처럼 중복 키(11000) 무해
   무시로 처리하고, 재발급(리셋)은 조건부 `updateOne`으로 처리해 동시 로그인
   레이스에서 이중 발급/이중 리셋되지 않게 한다("유저 데이터 누적 방식" 절 참고).
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

GENERAL/EVENT 모두 `(playerId, defId)`당 인스턴스 문서를 **1개만 유지**한다 — 사이클마다
새 문서를 발급하지 않고, 종료(`COMPLETED`)된 기존 문서를 **in-place로 리셋**해
재사용한다. GENERAL의 `maxRotationCount`가 사실상 무제한(999999)이라, 사이클마다 새
문서를 계속 쌓는 이전 방식은 `player_attendance` 컬렉션이 무한히 커지는 문제가 있어
이 방식으로 바꿨다.

- 리셋 시 필드 갱신: `snapshot`(새 def 스냅샷으로 교체), `catchupPurchaseCount: 0`,
  `startDate`/`endDate`(새 사이클), `attendedDays: []`, `status: ACTIVE`,
  `rotationCount + 1`. `_id`는 그대로 유지된다.
- 동시성: 리셋은 조건부 `updateOne`(필터에 `status: COMPLETED` + 리셋 직전 읽은
  `rotationCount` 값을 포함— 낙관적 락과 동일 원리)으로 처리해, 동시 로그인 레이스로
  두 요청이 동시에 리셋을 시도해도 하나만 성공한다.
- **리셋 직전 옛 사이클의 최종 상태(`attendedDays`/`catchupPurchaseCount`/
  `rotationCount`/기간)는 리셋되는 순간 컬렉션에서 사라진다** — 문서를 재사용하는
  구조상 불가피하며, 그 상태는 감사 로그(`log_attendance`의 `action:"reset"`)에 통째로
  남겨 유일한 흔적으로 삼는다("감사 로그" 절 참고). 최초 발급은 `action:"issue"`로
  구분해서 남긴다.

## 원자성/트랜잭션 전략 (MongoDB)

| 케이스 | 처리 방식 |
|---|---|
| 일반 출석 지급(골드 미사용) | 순차 처리. `$addToSet` 원자 연산 + Mailbox 멱등키(`sourceType`+`sourceId` 유니크 인덱스)로 안전. 세션 트랜잭션 불필요 |
| 캐치업 구매(골드 차감+지급+출석처리) | 세션 기반 멀티도큐먼트 트랜잭션 — ClaimMail(`player_mailbox`+`player`)과 동일 근거, 여기에 인스턴스 컬렉션까지 3개 |
| 출석부 정의(시드) 등록/수정 | 동시성 이슈 거의 없음(gm_platform에서만 쓰기 발생, 시작된 def는 수정 자체를 막음). 낙관적 락 불필요 |

**Mailbox 멱등키**: `sourceType: "attendance"`(GENERAL) / `"attendance_event"`(EVENT),
`sourceId: {playerId}_{defId}_{day}` — 자동지급/캐치업 구매 공통(위 "sourceId 통일"
참고).

## 감사 로그

`log_attendance` 컬렉션에 `attend`/`catchup_purchase`/`issue`/`reset` 4개 액션을
남긴다(CLAUDE.md "감사 로그 / DAU 정책" 표 참고, `08_AUDIT_LOG_POLICY.md`는 아직
갱신 전). `issue`는 최초 발급 1회만, `reset`은 그 이후 로테이션(in-place 리셋)마다
남으며 리셋 직전 옛 사이클의 최종 상태를 담는다(위 "유저 데이터 누적 방식" 절).

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
1개. 상세 스펙은 `25_ATTENDANCE_API.md` 참고.

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
- `targetAudience=RETURNING_USER`면 `returningInactiveDays` 필수(저장 시점 검증)

## 재사용 vs 신규

- **재사용**: Mailbox(보상 지급 경로), Economy(골드 차감), 기존 아이템 마스터 카탈로그
- **신규**: 출석부 정의(시드), 날짜별 보상 구성(시드), 캐치업 회차별 가격(시드),
  유저 발급 인스턴스(런타임)

## 미결정(TBD)

- [ ] 캐치업 회차별 실제 가격 수치(밸런싱)
- [ ] 날짜별 보상 아이템/수량 실제 값(밸런싱)
- [ ] GENERAL 최초 시드 데이터(첫 라인) 실제 값
- [ ] gm_platform 관리화면 상세 UI 스펙
- [x] 실제 컬렉션 스키마(필드 BSON 타입, 인덱스 설계) — `05_DATABASE_SCHEMA.md`
- [x] 감사 로그 정책 반영 여부 — `08_AUDIT_LOG_POLICY.md`
