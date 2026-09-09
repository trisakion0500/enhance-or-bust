# CLAUDE.md

이 파일은 이 레포에서 작업하는 Claude Code에게 프로젝트 컨텍스트를 제공한다.

## 프로젝트 개요

- **게임 타이틀**: 강화하다 망함
- **레포명**: enhance-or-bust
- **장르**: 카드 수집형 방치(Idle) RPG
- **구성**: 서버 + 클라이언트 풀스택 프로젝트 (백엔드 전용 아님)

기획 상세는 `docs/design/GAME_DESIGN.md` 참고. 이 문서는 확정 상태이며 임의로 변경하지 않는다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| 백엔드 | Node.js + TypeScript |
| DB | MongoDB |
| 캐시 | Redis |
| 프론트엔드 | 바닐라 JavaScript |
| 아키텍처 | DDD (도메인 주도 설계) |

상세는 `docs/architecture/TECH_STACK.md` 참고.

### Redis 용도 (확정)

TECH_STACK.md의 "캐시/조회 최적화"라는 표현을 아래로 구체화한다.

- 세션/인증 토큰 관리
- 분산 락 — 낙관적 락 재시도 폭주 방지용 짧은 TTL 락 (예: 같은 플레이어의
  강화/합성 연타)
- 랭킹/리더보드(Sorted Set)는 현재 기획 범위 밖 — 랭킹 컨텐츠 추가 시 확장,
  지금 구현 대상 아님

## 로깅 설정 (확정)

- log4js 사용, 설정은 `config/log4js.json`에서 관리 (재빌드 없이 파일만 수정하면 반영)
- 서버 기동 시 `log4js.configure(configPath)`로 로드. `configPath`는 프로젝트
  루트(`process.cwd()`) 기준 절대경로로 계산 — dev(`tsx`, src 실행)/prod(`node`,
  dist 실행) 어느 쪽이든 안정적으로 같은 파일을 찾음
- 실시간 파일 watcher는 두지 않음 — 인스턴스 다수에서 리로드 타이밍 불일치,
  파일시스템 이벤트 불안정(에디터 저장 방식에 따른 중복/누락) 등 관리 비용만
  늘어남. 설정 변경은 기본적으로 프로세스 재시작으로 반영
- 예외적으로 `SIGHUP` 시그널 핸들러만 등록 — 명시적으로 시그널을 보냈을 때만
  `log4js.configure()`를 재호출해 무중단 재로드
- 설정 파일 로드 실패(파일 없음/JSON 문법 오류) 시 기본 콘솔 appender로
  폴백하고 에러 로그를 남김 — 로거 자체가 죽지 않게 함
- 환경별 설정 파일 분리(`log4js.${NODE_ENV}.json` 등)는 아직 하지 않음 —
  필요해지면 그때 도입

## 바운디드 컨텍스트 (DDD)

7개로 분리:

1. **Inventory** — 카드 보유
2. **Enhancement** — 강화
3. **Synthesis** — 합성
4. **Progression** — 레벨업
5. **Economy** — 재화 (골드/강화석/다이아)
6. **Mailbox** — 우편
7. **Battle-Stage** — 전투 판정

각 컨텍스트는 독립된 도메인 모델과 Repository를 가진다. 컨텍스트 간 직접 참조를 피하고
필요 시 도메인 이벤트나 애플리케이션 서비스 계층을 통해 연동한다.

> 참고: Inventory/Progression/Economy/Battle-Stage 4개 컨텍스트는 항상 같은 문서 안에서
> 낙관적 락 하나로 원자적으로 바뀐다 — DDD에서 애그리게잇 경계는 곧 원자성 경계이므로,
> 이 네 컨텍스트는 이미 하나의 애그리게잇(`Player`)이다. 그래서 Repository도 컨텍스트별로
> 나누지 않고 `PlayerRepository` 하나로 둔다. 컨텍스트별 도메인 엔티티/값객체(Card,
> Inventory, Economy 등)는 `Player` 애그리게잇 내부 구성요소로 계속 분리 관리한다 —
> 코드 조직 목적의 논리적 분리일 뿐, 별도 Repository/영속성 경계는 아니다. 상세는 아래
> "MongoDB 데이터 모델링 / 원자성 전략" 섹션 참고.

## 인증 전략 (확정)

- 로그인/회원가입은 구글 로그인 단일 수단만 지원 — 별도 회원가입 폼/비밀번호 없음
- 로그인 플로우는 `GOOGLE_AUTH_FLOW` 환경변수로 택일한다(둘 다 상시 지원, 활성화된
  쪽 라우트만 등록됨). 서비스 요구사항이 아니라 학습 목적으로 둘 다 구현해둔 것 —
  운영상 어느 한쪽이 필요해서 나뉜 게 아니다
  - `id_token`(기본값, Google Identity Services): 프론트가 구글 ID 토큰(credential)을
    받아 `POST /auth/google`로 전달
  - `authorization_code`(OAuth 2.0 Authorization Code Flow): 프론트가
    `GET /auth/google/login`으로 이동 → 구글 동의 화면 → `GET /auth/google/callback`
    (`code` + `state` CSRF 검증) → 서버가 `GOOGLE_CLIENT_SECRET`으로 code를 토큰과 교환.
    Client Secret은 confidential client(서버)만 보관하며 프론트엔 절대 노출하지 않는다
  - 두 플로우 모두 결국 `google-auth-library`의 `verifyIdToken()`으로 서명/audience를
    검증해 `sub`(구글 고유 사용자 ID)를 추출하고(공통 매핑은 `toProfile()`), 이후
    로그인/가입 처리는 `authService.ts`의 `loginOrRegister()`로 합류한다. 클라이언트가
    주장하는 값이 아니라 토큰 자체를 서버가 검증 — 서버 권위 원칙
- `Player.playerId`(`players._id`)는 구글 `sub` 같은 프로바이더 값을 그대로 쓰지 않고
  `randomUUID()`로 발급하는 내부 전용 식별자다. 대신 `platformType`(예: "google")과
  `platformUserId`(구글이면 `sub`) 필드를 별도로 두고, 이 둘의 조합에 MongoDB 복합
  unique 인덱스를 건다(MySQL로 치면 `(platform_type, platform_user_id)` UK와 동일한
  역할 — `MongoPlayerRepository.ensureIndexes()`, 서버 기동 시 1회 호출). `playerId`를
  프로바이더 값과 분리해두는 이유: 나중에 구글 외 다른 로그인 수단이 추가되거나, 여러
  로그인 수단을 한 플레이어에 연결하는 기능이 생겨도 `playerId` 체계 자체는 안 바뀐다
  - 로그인 조회는 `PlayerRepository.findByPlatform(platformType, platformUserId)`로
    한다 — 로그인 시점엔 아직 내부 `playerId`를 모르므로 이게 진입점
  - `randomUUID()`는 인스턴스 간 조율 없이 각자 로컬에서 생성해도 안전(122비트 랜덤,
    충돌 확률상 무해)하고, MySQL `AUTO_INCREMENT`처럼 단일 진실 공급원이 필요 없어
    서비스 서버를 N대로 늘려도 영향 없다. MongoDB가 1대(레플리카셋 포함)인 한 프라이머리가
    하나뿐이라 unique 인덱스가 동시 요청 순서를 항상 일관되게 판정한다
- 최초 로그인 시 신규 Player를 생성(빈 인벤토리, 초기 골드 1000, `clearedStage=0`,
  구글 프로필의 `name`/`email`/`picture` 포함). 이름/프로필 사진은 최초 가입 시 1회만
  가져오고 이후 구글과 재동기화하지 않는다 — 닉네임/프로필 사진을 게임 내에서 바꾸는
  기능이 나중에 추가될 수 있는데, 구글 쪽과 계속 동기화하면 게임 내 변경을 도로 덮어쓰게
  되기 때문. `PlayerRepository.create()`는 삽입 전용(update 아님)이며, 동시 최초 로그인
  레이스로 unique 인덱스 중복 에러(11000)가 나면 조용히 무시한다 — 이때 자신이 만든
  `playerId`가 실제로 저장됐다는 보장이 없으므로, 호출부(`authService.ts`의
  `loginOrRegister()`)는 그 뒤 반드시 `findByPlatform`으로 실제 저장된 `playerId`를
  다시 조회해 세션을 발급한다
- 세션은 랜덤 opaque 토큰을 발급해 Redis에 `session:<token> → playerId` 형태로
  TTL(기본 7일, `SESSION_TTL_SEC`)과 함께 저장한다(Redis 용도 절의 "세션/인증 토큰 관리"
  그대로). JWT처럼 자체 서명된 토큰이 아니라, Redis에서 지우면 즉시 무효화할 수 있다
- 세션 토큰은 httpOnly 쿠키(`sessionToken`)로 내려준다. 프론트(정적 파일)와 API를 같은
  오리진에서 같이 서빙하므로 CORS 설정이 필요 없다
- 로그인 이후 요청을 세션으로 인증하는 미들웨어 `requireAuth`(`src/shared-kernel/sessionAuth.ts`)가
  `sessionToken` 쿠키를 Redis 세션과 대조해 `req.playerId`를 세팅한다. 전역 `app.use`가 아니라
  보호가 필요한 라우터에 개별적으로 붙이는 방식 — 강화 라우터(`enhancementRoutes.ts`)가 첫
  적용 사례이며, 새 보호 라우트를 추가할 때마다 그 라우터에 `router.use(requireAuth)`로 붙인다
- 앱(모바일) 확장 시: iOS/Android는 구글 콘솔에 플랫폼별 Client ID를 추가 등록하되, 앱에서
  ID 토큰을 요청할 때 이 웹 Client ID를 대상(audience)으로 지정하는 게 구글 권장 방식이라
  (`serverClientId`/`serverClientID` 옵션) 서버 코드는 변경 없이 그대로 동작한다. 그래서
  audience 배열 지원 같은 선제적 변경은 지금 하지 않는다

## 핵심 게임 규칙 요약

- **카드 등급**: N(60%, 공10-20) / R(30%, 25-40) / SR(8%, 50-80) / SSR(2%, 100-150)
- **강화**: +0~15단계, 1단계당 공격력 +5%
  - +0~5: 100% 성공
  - +6~10: 70% 성공, 실패해도 카드 유지
  - +11~15: 40% 성공, 실패 시 10% 확률로 카드 파괴
- **합성**: 동일 등급 3장 → 상위 등급 1장 (성공률 80%), 또는 동일 카드 2장+골드 → 강화+1 (100% 안전)
- **레벨업**: 최대 60레벨, 필요 EXP = 50 × level^1.5, 레벨당 공격력 +2%
- **스테이지**: 100개. 출전 스쿼드(최대 5장, 공유 체력 풀) vs 몬스터(체력/공격력/방어력/원소,
  기본값 × 1.15^스테이지번호로 지수 증가)의 라운드제 턴 전투. 원소 3종(fire/water/grass)
  상성으로 데미지 1.2배/0.8배. `clearedStage` 이하 재도전(파밍) 가능하되 보상은
  `farmRewardRate`만큼 축소, `clearedStage+1` 초과는 진입 차단. **서버가 카드 스탯 기준으로
  직접 시뮬레이션 판정**하며 클라이언트가 보내는 전투 결과는 신뢰하지 않는다. 상세는
  `docs/design/GAME_DESIGN.md` 6절.
- **우편**: 발송 후 7일 만료, 중복 수령 방지 필요

## 현재 상태

- 기획 문서(GAME_DESIGN.md), README, TECH_STACK.md는 완성되어 있음
- 부트스트랩(Mongo/Redis 연결, log4js 로깅, 에러 핸들링 스켈레톤, Express 서버 골격),
  Player 애그리게잇(Inventory/Economy) + MongoPlayerRepository(낙관적 락), 마스터
  데이터 5종 캐시/Change Stream 워처(지수 백오프 포함)/시드 스크립트, 구글 로그인
  연동 신규가입/로그인(`GOOGLE_AUTH_FLOW`로 `id_token`/`authorization_code` 선택,
  최초 가입 시 이름/이메일/프로필 사진 저장) + Redis 세션 발급, 세션 인증 미들웨어
  (`requireAuth`), 강화 API(`POST /enhancement/:cardId`, `requireAuth` 적용 — 낙관적
  락 충돌 시 애플리케이션 레벨 재조회·재시도), 합성 API(`POST /synthesis/grade-upgrade`
  — 동일 등급 3장 소모, 80% 성공, 실패 시 소재 1장만 소모; `POST
  /synthesis/enhance-material` — 대상 카드 외 동일 원형 2장+골드 소모, 100% 성공으로
  대상 카드 강화 단계 +1. 강화/합성/전투-스테이지 셋 다 재조회·재시도 루프가 동일해
  `shared-kernel/optimisticPlayerWrite.ts`의 `withOptimisticRetry()` 공용 헬퍼로 통합
  — Redis 짧은 TTL 락(`redisLock.ts`의 `withPlayerLock()`, 플레이어 단위, TTL 5초)으로
  전체를 감싸 같은 플레이어의 연타가 낙관적 락 재시도 폭주로 이어지는 것을 막는다. 락
  획득 실패(짧게 3회·150ms 재시도 후 포기) 시 대기하지 않고 즉시 `COMMON.LOCKED`(429)로
  거부(fail-fast) — 정합성은 이미 `version` 낙관적 락이 보장하므로 이 락은 순수 부하
  최적화이고, 대기시켜 처리량을 늘리기보다 연타 자체를 막는 쪽을 택함), 전투/
  스테이지 API(`POST /battle-stage/:stageId/clear` — 출전 스쿼드 vs 몬스터 라운드제
  시뮬레이션. 승리 시 EXP(출전 카드에만)와 `clearedStage`(최초 클리어 `clearedStage+1`일
  때만 갱신, 파밍 승리는 갱신 안 함)는 Player 애그리게잇에 즉시 반영하고, 골드/확률적
  강화석(파밍 재도전 시 `farmRewardRate`만큼 축소)은 `sendMail()`로 우편 발송한다 —
  `save()` 성공 후에만 발송하고, 낙관적 락 재시도 전체에서 같은 `sourceId`를 재사용해
  중복 발송을 막는다(SendMail 멱등 처리 재활용). 패배 시 상태 변경 없이 저장 생략), Mailbox
  도메인(`sendMail()` — (sourceType, sourceId) 유니크 인덱스로 멱등 발송, HTTP API 없이
  다른 Use-case가 내부 호출(스테이지 클리어가 첫 실사용 사례); `POST /mailbox/:mailId/claim`
  — mailbox+players 두 컬렉션을 세션 기반 멀티도큐먼트 트랜잭션으로 묶어 우편 상태 변경과
  Economy/Inventory 첨부물 지급을 원자적으로 처리; `GET /mailbox` — 만료되지 않은 목록
  조회; 발송 트리거(컨텐츠)별 제목/만료일은 `mailContent.ts`의 `MAIL_CONTENTS`
  레지스트리로 관리 — 트리거마다 정책이 달라질 수 있어 전역 고정값 대신 컨텐츠별로
  분리), 만료 우편 정리 배치(`node-cron`으로 매월 1일 00시(`MAILBOX_CLEANUP_CRON`)
  실행 — 수령 여부와 무관하게 `expiresAt`이 `MAILBOX_CLEANUP_RETENTION_MONTHS`(기본
  3개월) 이전인 우편만 삭제. 즉시/암묵적 TTL 삭제는 여전히 안 함(수령한 우편도 최근
  수개월은 데이터 가치가 있다는 원칙 유지) — 이 배치는 그 유예기간이 지난 뒤에만
  명시적으로 도는 정리다. cutoff는 실행 시각(`now`)에서 개월 수를 빼지 않고 "이번 달
  1일 00:00:00.000"을 기준점으로 고정한 뒤 개월 수만 빼서 계산 — 크론이 지연 발동해도
  cutoff가 실행 시각에 흔들리지 않게 함. 인스턴스 다중화 대비 중복 실행 방지는 Redis 분산락 대신
  `batch_runs` 컬렉션에 `{jobName}:{period}`를 `_id`로 유니크 삽입하는 방식(멱등
  발송과 동일 원리) — 서버 종료 시 `mailboxCleanupTask.stop()`으로 크론도 함께
  정지)까지 구현됨. Redis 분산락(강화/합성/전투-스테이지 대상, 우편(Mailbox)의
  `claimMail()`은 대상 아님 — `$inc` 원자 증가만 써서 애초에 재시도 루프 자체가 없어
  락이 불필요)도 위 문단에 통합해 구현됨
- 스테이지 클리어 보상에 확률적 카드 드랍 추가 — 스테이지별 카드 드랍 가중치는
  `master_stage_card_drops` 컬렉션(문서당 (stageId, templateId) 하나, "마스터 데이터
  로딩/리로드 전략" 절 참고)에서 뽑고, 드랍 확률은 `master_stage_configs`의
  `cardDropRateFirstClear`/`cardDropRateFarm`으로 최초 클리어/파밍 재도전이 독립
  관리된다. 골드/강화석과 동일하게 우편(Mailbox) 경유로 발송
  (`battleStageService.ts`의 `pickWeightedCardTemplate()`, `cardDrop.ts`,
  `masterDataCache.getCardDropTable()`)
- 인벤토리 슬롯 상한(`INVENTORY_SLOT_CAP`, 기본 200) 적용 — 우편 수령(ClaimMail) 시
  카드 첨부물이 있으면 상한 초과 여부를 검증해 초과 시 `MAILBOX.INVENTORY_FULL`
  (7004)로 거부하고 우편은 미수령 상태로 남긴다(all-or-nothing). 스테이지 진입
  시점의 사전 차단은 없음 — 자세한 경계는 "Inventory 슬롯 상한 구현 노트" 참고
- 미구현: EXP의 Mailbox 경유 전환(카드 성장은 우편의 일반 전리품 모델과 안 맞아
  의도적으로 제외 — 즉시 지급 유지)

## MongoDB 데이터 모델링 / 원자성 전략 (확정)

원칙: 같이 원자적으로 바뀌어야 하는 필드는 같은 문서에 묶고, 독립적으로 바뀌는 것은 분리한다.

### players 컬렉션 (단일 문서, 낙관적 락 — 트랜잭션 없음)

플레이어 하나의 상태를 문서 하나에 통합. `version` 필드로 낙관적 동시성 제어
(조건부 업데이트 실패 시 재시도).

- **Inventory**: 카드 배열 embedding. 강화/합성(카드 3장 삭제+1장 생성 포함)도
  배열의 `$pull`/`$push`로 단일 문서 업데이트로 처리
- **Progression**: 카드 인스턴스별 `level`/`exp` 필드(Inventory 배열의 각 카드 서브도큐먼트에
  포함). 계정(플레이어) 단위 레벨은 현재 기획 범위 밖 — 필요해지면 GAME_DESIGN.md에 정식
  추가 후 도입
- **Economy**: 골드/강화석/다이아 필드. 강화/합성 시 재화 차감이 카드 상태 변경과
  항상 같이 일어나므로 Inventory와 같은 문서에 통합
- **Battle-Stage**: `clearedStage` 필드만 저장. 판정(카드 스탯 합산 vs 필요 전투력
  비교) 자체는 저장 없는 순수 계산 로직

### mailbox 컬렉션 (별도 컬렉션)

**수령(ClaimMail)**: 우편 상태 변경 + Economy/Inventory 지급을 세션 기반
멀티도큐먼트 트랜잭션으로 묶음. players 컬렉션과 분리되어 있으므로 이 케이스는
트랜잭션이 필요.

**발송(SendMail — 스테이지 클리어 보상, 강화 파괴 환급 등)**: players + mailbox
두 컬렉션에 걸친 쓰기이지만 트랜잭션으로 묶지 않고 멱등키 방식으로 처리.

- mailbox 문서에 `sourceType` + `sourceId` 조합 유니크 인덱스로 중복 발송 차단
  (예: `sourceType: "stage_clear"`, `sourceId: "{playerId}:{stageId}:{clearedAt}"`)
- 쓰기 순서: players update 먼저 → 성공 시 mailbox insert. 재시도 시 유니크
  인덱스 충돌로 중복 삽입 방지
- players 컨텍스트는 원래 원칙(트랜잭션 없이 낙관적 락)을 그대로 유지 — mailbox
  insert만 멱등 처리로 안전성 확보

## Inventory 슬롯 상한 구현 노트

정책(상한 존재 여부, 차단/무조건지급 원칙)은 `docs/design/GAME_DESIGN.md`의
"인벤토리 슬롯 정책" 절이 원본이다. 여기는 구현 방식만 다룬다.

- players 문서에 카드를 배열로 embedding하는 구조라 MongoDB 문서 16MB 제한과
  직결됨 — 슬롯 상한은 이 리스크에 대한 방어이기도 함
- 상한 수치는 `INVENTORY_SLOT_CAP` 환경변수로 관리(기본값 200) —
  `src/config/env.ts`의 `config.inventorySlotCap`
- 카드가 늘어나는 유일한 경로인 스테이지 클리어 카드 드랍(6절)은 우편(Mailbox)
  경유로 지급된다. "차단"(사전 검증)과 "결과 지급"의 경계가 여기서는 스테이지
  진입 시점이 아니라 **우편 수령(ClaimMail) 시점**이다:
  - **SendMail(발송)**: 상한과 무관하게 무조건 발송 — 아직 인벤토리를 건드리지
    않으므로 체크할 대상이 없음
  - **ClaimMail(수령)**: 카드 첨부물이 있을 때만 `현재 인벤토리 수 + 첨부 카드 수
    > INVENTORY_SLOT_CAP`을 검증한다(`mongoMailboxRepository.ts`의 `claimMail()`
    트랜잭션 안). 초과하면 `MAILBOX.INVENTORY_FULL`(7004)로 거부하고, 우편은
    미수령 상태 그대로 남는다(동봉된 골드 등도 함께 거부 — all-or-nothing).
    유저가 슬롯을 비운 뒤 다시 수령을 시도하면 되고, 우편 만료 기한(7일) 안에
    비우지 못하면 결과적으로 카드를 잃을 수 있다 — 골드/강화석과 달리 카드는
    상한 때문에 유실될 수 있는 유일한 보상 종류
  - 스테이지 진입 시점의 사전 차단(진입 자체 거부)은 두지 않는다 — 드랍 여부가
    전투 결과에 달려 있어 진입 시점엔 알 수 없고, 위 수령 시점 검증으로 이미
    걸러지기 때문

## 마스터 데이터 로딩/리로드 전략 (확정)

- 컨텐츠별 별도 컬렉션 분리: `master_card_templates`, `master_grade_configs`,
  `master_enhancement_rules`, `master_synthesis_rules`, `master_stage_configs`,
  `master_stage_card_drops` 등(컨텐츠 종류 증가를 전제) — `master_` 프리픽스로 런타임
  쓰기 컬렉션(players, mailbox)과 구분한다
- 이 분리 원칙은 스테이지 문서 내부 배열도 예외가 아니다: 카드 드랍 테이블은 처음에
  `master_stage_configs` 문서 안에 배열(`cardDropTable`)로 넣었다가, "행 단위로 늘어나는
  데이터는 운영툴 엑셀 업로드/개별 관리가 쉽도록 별도 컬렉션으로 분리한다"는 판단에 따라
  `master_stage_card_drops`(자연키 `(stageId, templateId)`, 문서당 카드 원형 하나의
  가중치)로 다시 분리했다. 앞으로도 "스테이지 하나에 종속되지만 개수가 늘어나는 목록"
  형태의 데이터가 생기면 배열로 내장하지 않고 이 패턴(전용 컬렉션 + 부모 ID를 포함한
  자연키)을 따른다
- 서버 기동 시 전체를 메모리에 로드하는 싱글톤 캐시 구조
- 리로드는 MongoDB Change Streams로 처리. 컬렉션마다 워처를 두지 않고 DB 레벨
  Change Stream 워처 1개로 전체 감시 → `event.ns.coll`로 컨텐츠 구분 후 해당
  리로드 핸들러만 실행
- 각 컨텐츠(컬렉션) 문서는 자체 `version` 필드를 독립적으로 가짐. 여러 컨텐츠의
  버전을 하나의 합성 버전 문자열로 합치지 않음 (결합도만 높아지고 실익 없음)
  - DB 버전 저장 위치는 별도 `master_data_meta` 컬렉션(`{content, version}` 1문서씩,
    쓰기 시 `$inc`). resume token은 `change_stream_state` 컬렉션(단일 문서)에 저장
- 안전망: Change Stream은 at-most-once push이며 콜백 처리 오류나 connection 끊김
  시 이벤트를 놓칠 수 있음
  - 콜백은 try/catch로 감싸서 이벤트 하나의 처리 실패가 스트림 전체를 죽이지 않게 함
  - connection 재연결 대비 resume token 저장 후 `resumeAfter`로 재개. 재연결 재시도는
    지수 백오프(1초→2초→4초...60초 상한, 이후 60초 간격 유지)로 재시도 폭주를 방지하고,
    이벤트를 정상 수신하면 백오프를 리셋
  - 주기적 폴링(예: 수 분 간격)으로 각 컨텐츠의 DB 버전과 메모리 캐시 버전을
    비교해 어긋나면 강제 리로드 (Change Streams가 주 채널, 폴링은 fallback)

## 테스트 전략 (확정)

- E2E만 작성한다. 단위 테스트는 아직 없음 — 도메인 로직이 라우트 하나당 서비스 함수 하나로
  단순해서 API 레벨 검증이 곧 로직 검증과 크게 다르지 않고, 실제로 값어치가 큰 건 라우트→
  미들웨어→서비스→DB까지 이어지는 전체 경로가 맞물려 돌아가는지다
- Node 내장 테스트 러너(`node:test`, `node:assert/strict`)만 쓴다. Jest/Vitest/Mocha 같은
  테스트 프레임워크나 supertest 같은 HTTP 어서션 라이브러리를 추가하지 않음 — Node 22 기준
  내장 러너와 전역 `fetch`만으로 충분
- mock이나 인메모리 DB 대역 라이브러리(mongodb-memory-server 등)를 쓰지 않고, 로컬 개발용
  실제 Mongo/Redis에 그대로 붙는다. `createServer()`(DI로 조립만 하고 `listen()`은 안 하는
  팩토리, `server.ts`)를 임시 포트로 띄워 `fetch`로 호출
- 각 테스트가 자기 테스트 데이터(플레이어 등)를 직접 만들고 `finally`에서 직접 지운다 —
  테스트 간 공유 상태 없이 독립적으로 격리. `platformType: "test"`로 실제 구글 로그인 유저와
  구분되게 만듦
- 파일 네이밍: `*.e2e.test.ts`, 대상 라우트 파일 옆에 둔다(예: `enhancementRoutes.ts` ↔
  `enhancementRoutes.e2e.test.ts`). `npm test`가 `tsx --test`로 이 패턴을 전부 실행

## 작업 시 유의사항

- 기획(GAME_DESIGN.md) 내용은 이미 확정본이므로 코드 스캐폴딩 중 임의로 규칙을 바꾸지 말 것
- 위 아키텍처 결정에 없는 설계는 임의로 정하지 말고 사용자에게 먼저 확인
- 서버 권위(server-authoritative) 원칙 유지: 특히 Battle-Stage 판정, 강화/합성 확률 처리는
  전부 서버에서 검증 및 실행되어야 하며 클라이언트 입력값을 신뢰하지 않는다