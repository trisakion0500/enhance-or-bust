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
- 모든 Redis 키는 `shared-kernel/redisKeys.ts`의 빌더 함수(`redisSessionKey()`/
  `redisLockKey()`)로만
  만든다 — 호출부마다 `config.redisKeyPrefix`를 직접 붙이면 새 키 추가 시 프리픽스를
  빠뜨리는 실수가 나올 수 있어 한 곳으로 모음. 새 Redis 용도가 추가되면 이 파일에 빌더
  함수를 먼저 추가하고 재사용한다

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
- 클러스터(다중 인스턴스) 구동 대비 — 파일 계열 appender(`file`/`dateFile`)의
  `filename`에 인스턴스 식별자 suffix를 붙인다(`logger.ts`의 `withInstanceSuffix()`).
  여러 인스턴스가 같은 로그 파일에 동시에 쓰면 줄이 섞이거나 파일이 깨질 수 있어서다.
  식별자는 PM2 클러스터 모드가 자동으로 심어주는 `NODE_APP_INSTANCE`, 또는 Docker/k8s
  등 오케스트레이터가 명시적으로 주입하는 `INSTANCE_ID` 순으로 찾는다 — 이 값은 설정
  서비스가 아니라 부트스트랩 극초반에 `process.env`에서 직접 읽는다(로깅 설정 로드
  자체가 다른 모듈보다 먼저 실행돼 설정 서비스가 아직 준비되지 않았을 수 있음). 순수 OS
  `HOSTNAME`은 로컬 단일 인스턴스 개발 머신에도 항상 값이 있어 판단 기준으로 쓰지 않음
  (잘못 쓰면 단일 인스턴스에서도 불필요하게 파일명이 바뀐다). 둘 다 없으면(로컬 단일
  인스턴스) suffix 없이 기존 파일명(`logs/app.log`) 그대로 쓴다 — 지금 이 프로젝트는
  단일 인스턴스 전제라 실제로는 항상 이 경로를 탄다

## 감사 로그 / DAU 정책 (확정)

- 목적: 상태를 바꾸는 모든 액션에 대해 "언제/누가/어떤 액션/어떤 내용이 추가·수정·삭제됐는지"를
  남긴다. log4js 애플리케이션 로그(요청/응답 페어링)와는 별개 — 저건 운영 디버깅용, 이건
  게임 이벤트 감사/통계용
- 저장 위치: 로그 DB(`enhance_or_bust_log`, `infra/mongoLog.ts`)에 컨텐츠(도메인)별 컬렉션을
  분리해서 둔다(마스터데이터 로딩 전략의 "컨텐츠별 별도 컬렉션" 원칙과 동일) —
  `log_auth`/`log_enhancement`/`log_synthesis`/`log_battle_stage`/`log_mailbox`
- 공통 스키마: `{actorId, action, changes, occurredAt}`. `actorId`는 playerId, 배치/크론처럼
  사람이 아닌 주체가 남기면 `"SYSTEM"` sentinel(`shared-kernel/auditLog.ts`의 `SYSTEM_ACTOR`).
  `changes`는 액션마다 내용이 달라 자유 형식 객체로 둔다
- 쓰기 시점: 메인 쓰기(players/mailbox)가 성공한 뒤에만 호출. 이 로그 기록 자체가 실패해도
  메인 흐름을 실패시키지 않고 try/catch로 삼키며 실패만 log4js에 남긴다(개발 컨벤션 7장 —
  로그 DB는 메인 트랜잭션과 절대 묶이지 않음, 로그 실패가 핵심 기능을 막으면 안 됨)
- 상태 변경이 없는 시도(예: 전투 패배)는 감사 로그(`*_logs`)엔 안 남긴다 — `withOptimisticRetry`의
  `shouldSave`가 저장 자체를 스킵하는 경우와 동일 기준. 단, 이 기준은 "상태를 바꾼 행위의
  감사 추적"이라는 감사 로그 목적에만 해당하고, 통계 목적 컬렉션(DAU/전투 시도)에는 적용되지
  않는다 — 아래 두 항목 참고
- DAU는 감사 로그와 별개 컬렉션(`stats_daily_active_players`)으로 집계한다 — "무엇이 바뀌었는지"가
  아니라 "오늘 활동했는지"만 필요해 목적이 다르다. `(playerId, date)` 유니크 인덱스로 인증된
  요청의 공용 진입점(`requireAuth`)에서 하루 1건만 삽입(SendMail과 동일한 멱등 삽입 패턴 —
  중복 키 에러 11000은 조용히 무시)
- 전투 스테이지 승률/카드 조합 통계도 감사 로그와 별개 컬렉션(`attempts_battle_stage`)으로
  집계한다 — "스테이지별 승률이 얼마인가"는 승리(감사 로그 대상)뿐 아니라 패배까지 포함해야
  계산 가능해, `log_battle_stage`(승리 시에만 기록)와는 목적이 다르다. `clearStage()`가
  `withOptimisticRetry` 밖에서(승패 무관, 매 호출 1건) 직접 기록하며, 출전 스쿼드의 카드
  원형 ID(`squadTemplateIds`)까지 남겨 어떤 카드 조합으로 이겼는지/졌는지 분석할 수 있게 한다
- 대상 액션 목록 — "상태"가 `구현됨`인 것만 실제로 `writeAuditLog()` 호출이 코드에 있다.
  나머지는 정책만 확정, 코드는 아직 없음(각 컨텍스트에 감사 로그를 추가할 때 이 표를
  그대로 구현 기준으로 삼는다):

  | 컬렉션 | action | changes | 상태 |
  |---|---|---|---|
  | `log_auth` | `register` | platformType, starterCardTemplateId, initialGold, name(입력한 닉네임) | 구현됨 |
  | `log_auth` | `login` | platformType | 구현됨 |
  | `log_auth` | `logout` | (없음 — 세션 종료만) | 구현됨 |
  | `log_enhancement` | `attempt` | cardId, success, destroyed, enhancementLevel(결과) | 구현됨 |
  | `log_synthesis` | `gradeUpgrade` | materialCardIds, success, resultCardId?, resultTemplateId? | 구현됨 |
  | `log_synthesis` | `enhanceMaterial` | targetCardId, materialCardIds, enhancementLevel(결과) | 구현됨 |
  | `log_battle_stage` | `clear` | stageId, clearedStage(결과), rewardGold, rewardEnhancementStone, rewardCardTemplateId, mailSourceId — 승리(=저장 발생) 시에만 | 구현됨 |
  | `log_mailbox` | `send` | mailId, title, attachments, sourceType, sourceId — 멱등 스킵(재발송 아님)은 기록 안 함 | 구현됨 |
  | `log_mailbox` | `claim` | mailId, attachments(지급된 첨부) | 구현됨 |
  | `log_mailbox` | `delete` | mailId | 구현됨 |
  | `log_mailbox` | `cleanupBatch` | actorId="SYSTEM", cutoff, deletedCount(0건이면 상태 변경 없어 로그도 생략) | 구현됨 |
  | `stats_daily_active_players` | (감사 로그 아님, DAU 전용) | {playerId, date} 유니크 인덱스, 하루 1건 | 구현됨 |
  | `attempts_battle_stage` | `attempt` | (감사 로그 아님, 통계 전용) stageId, squadCardIds, squadTemplateIds, won, clearedStage — 승패 무관 매 시도 | 구현됨 |

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

- 로그인/회원가입은 소셜 로그인만 지원(구글/페이스북) — 별도 회원가입 폼/비밀번호 없음
- 구글 로그인 플로우는 `GOOGLE_AUTH_FLOW` 환경변수로 택일한다(둘 다 상시 지원, 활성화된
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
- 페이스북 로그인은 Authorization Code Flow 하나만 지원한다(`GET /auth/facebook/login` →
  페이스북 동의 화면 → `GET /auth/facebook/callback`, `code`+`state` CSRF 검증은 구글과
  같은 `oauthState` 쿠키를 재사용) — 구글과 달리 `GOOGLE_AUTH_FLOW` 같은 토글이 없고 항상
  등록된다. 페이스북엔 구글 GIS에 대응하는 서명된 ID 토큰 발급 수단이 없어(opaque access
  token만 줌) 이중 플로우 자체가 성립하지 않는다. "검증"은 서명 확인이 아니라 그 access
  token으로 실제 Graph API(`/me`)를 호출해봐서 성공하는지로 대신한다(`facebookAuth.ts`의
  `exchangeFacebookAuthCode()`). 공식 Node SDK가 없어(Meta 공식 패키지는 Business/광고
  API용이고 로그인과 무관, 커뮤니티 패키지는 유지보수 끊김) 새 의존성 추가 없이 Node 22
  전역 `fetch`로 REST 호출 2번(코드 교환, 프로필 조회)만 직접 구현했다
- 리다이렉트 기반 프로바이더(구글 authorization_code, 페이스북, 향후 네이버 등)는
  `socialAuthProvider.ts`의 `SocialAuthProvider` 인터페이스(`{platformType,
  generateAuthUrl(state), exchangeAuthCode(code)}`, 클래스 상속이 아니라 플레인 객체 —
  이 코드베이스 전체가 클래스 계층 없이 함수 위주라 상속을 새로 들이면 이질적)로
  다형성을 둔다. 각 프로바이더의 infra 모듈(`googleAuth.ts`의 `googleAuthCodeProvider`,
  `facebookAuth.ts`의 `facebookAuthProvider`)이 이 인터페이스를 구현한 객체를 export하고,
  `authRoutes.ts`는 `socialProviders` 배열(레지스트리)을 순회하며
  `GET /auth/:platformType/login`/`GET /auth/:platformType/callback`을 한 루프에서
  등록한다 — `authService.ts`의 `loginWithSocialProvider(provider, code, playerRepository)`도
  프로바이더별 분기 없이 이 인터페이스 하나로 처리한다. **새 프로바이더 추가 시 손댈
  범위는 (1) `config/env.ts`에 자격증명 3줄, (2) 새 infra 모듈(동의 URL 생성 +
  code→프로필 교환 + provider 객체 export) 하나, (3) `authRoutes.ts`의 레지스트리 배열에
  한 줄 추가뿐** — 라우트/`authService.ts`는 더 건드리지 않는다. 구글 GIS(id_token, POST
  방식)만 예외로 이 레지스트리 밖에 별도 분기로 남는다(리다이렉트 기반이 아니라 인터페이스
  자체가 안 맞음, 학습 목적 특수 케이스). 프로필도 원본 필드명이 달라도(`sub`/`id`,
  `picture` 중첩 객체 등) 각 infra 모듈이 `SocialProfile`(`{sub, name?, email?,
  picture?}`) 공통 형태로 변환해 반환한다
- `Player.playerId`(`players._id`)는 구글 `sub`/페이스북 `id` 같은 프로바이더 값을 그대로
  쓰지 않고 `randomUUID()`로 발급하는 내부 전용 식별자다. 대신 `platformType`(예: "google",
  "facebook")과 `platformUserId`(프로바이더별 고유 ID) 필드를 별도로 두고, 이 둘의 조합에
  MongoDB 복합 unique 인덱스를 건다(MySQL로 치면 `(platform_type, platform_user_id)` UK와
  동일한 역할 — `MongoPlayerRepository.ensureIndexes()`, 서버 기동 시 1회 호출). `playerId`를
  프로바이더 값과 분리해두는 이유: 로그인 수단이 늘거나, 여러 로그인 수단을 한 플레이어에
  연결하는 기능이 생겨도(현재는 다루지 않음 — 같은 사람이 구글/페이스북 각각으로 로그인하면
  서로 다른 Player로 생성된다) `playerId` 체계 자체는 안 바뀐다
  - 로그인 조회는 `PlayerRepository.findByPlatform(platformType, platformUserId)`로
    한다 — 로그인 시점엔 아직 내부 `playerId`를 모르므로 이게 진입점
  - `randomUUID()`는 인스턴스 간 조율 없이 각자 로컬에서 생성해도 안전(122비트 랜덤,
    충돌 확률상 무해)하고, MySQL `AUTO_INCREMENT`처럼 단일 진실 공급원이 필요 없어
    서비스 서버를 N대로 늘려도 영향 없다. MongoDB가 1대(레플리카셋 포함)인 한 프라이머리가
    하나뿐이라 unique 인덱스가 동시 요청 순서를 항상 일관되게 판정한다
- 최초 로그인(신규 사용자)은 소셜 인증만으로 바로 Player를 만들지 않고, 닉네임을 입력받은
  뒤에야 가입을 완료한다(디폴트 닉네임은 플랫폼이 제공한 닉네임) — `loginOrRegister()`는
  기존 플레이어면 즉시 로그인(세션 발급)하지만, 처음 보는 `(platformType, platformUserId)`면
  Player를 만드는 대신 소셜 프로필(`platformType`/`platformUserId`/`name`/`email`/`picture`)을
  `pendingRegistrationStore.ts`를 통해 Redis에 10분 TTL로 보류하고 가입 보류 토큰만 반환한다
  (`authService.ts`의 `LoginResult` 유니온 — `{status:"login", sessionToken}` 또는
  `{status:"pending", token, defaultName}`). 이 토큰은 URL이 아니라 httpOnly 쿠키
  (`pendingRegistrationToken`)로만 오간다(리퍼러로 새는 것을 피하기 위함) — GIS(`POST
  /auth/google` 응답의 `pendingRegistration`/`defaultName` 필드)와 리다이렉트 플로우(구글
  authorization_code/페이스북 콜백이 `/?register=1`로 리다이렉트) 둘 다 이 쿠키를 거쳐
  같은 두 엔드포인트로 합류한다: `GET /auth/register/pending`(쿠키의 토큰으로 보류된
  기본 닉네임 조회, 프론트가 입력 폼을 이 값으로 미리 채움)과 `POST
  /auth/register/complete`(닉네임을 받아 그제서야 `completeRegistration()`이 최저 등급
  원형 중 랜덤 1장 시작 카드 + 초기 골드 1000으로 Player를 실제 생성하고 세션을 발급).
  가입 보류 상태에서 닉네임 입력 전에 이탈해도 데이터 손실이 없다 — 아직 아무것도 저장되지
  않았으므로 그냥 Redis TTL로 조용히 사라지고, 다시 로그인하면 같은 보류 흐름이 반복될 뿐이다.
  이름/프로필 사진은 이렇게 가입 시점에만 가져오고 이후 프로바이더와 재동기화하지 않는다 —
  닉네임/프로필 사진을 게임 내에서 바꾸는 기능이 나중에 추가될 수 있는데, 프로바이더 쪽과
  계속 동기화하면 게임 내 변경을 도로 덮어쓰게 되기 때문. `PlayerRepository.create()`는
  삽입 전용(update 아님)이며, 동시 가입 완료 레이스로 unique 인덱스 중복 에러(11000)가 나면
  조용히 무시한다 — 이때 자신이 만든 `playerId`가 실제로 저장됐다는 보장이 없으므로, 호출부
  (`authService.ts`의 `completeRegistration()`)는 그 뒤 반드시 `findByPlatform`으로 실제
  저장된 `playerId`를 다시 조회해 세션을 발급한다
- 세션은 랜덤 opaque 토큰을 발급해 Redis에 `session:<token> → playerId` 형태로
  TTL(기본 7일, `SESSION_TTL_SEC`)과 함께 저장한다(Redis 용도 절의 "세션/인증 토큰 관리"
  그대로). JWT처럼 자체 서명된 토큰이 아니라, Redis에서 지우면 즉시 무효화할 수 있다
- 세션 토큰은 httpOnly 쿠키(`sessionToken`)로 내려준다. 프론트(정적 파일)와 API를 같은
  오리진에서 같이 서빙하므로 CORS 설정이 필요 없다
- 로그아웃은 `POST /auth/logout`(`authRoutes.ts`) — 쿠키의 세션 토큰으로 Redis 세션을
  지우고(`sessionStore.ts`의 `deleteSession()`) 쿠키도 함께 삭제한다. `requireAuth`를
  붙이지 않고 쿠키가 없거나 이미 만료된 토큰이어도 그냥 성공 처리한다 — 로그아웃은 "로그인
  안 된 상태로 만들기"가 목적이라 이미 그 상태여도 실패로 볼 이유가 없는 멱등 동작
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
  데이터 6종 캐시/Change Stream 워처(지수 백오프 포함)/시드 스크립트, 구글 로그인
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
  `system_batch_runs` 컬렉션에 `{jobName}:{period}`를 `_id`로 유니크 삽입하는 방식(멱등
  발송과 동일 원리) — 서버 종료 시 `mailboxCleanupTask.stop()`으로 크론도 함께
  정지)까지 구현됨. Redis 분산락(강화/합성/전투-스테이지 대상, 우편(Mailbox)의
  `claimMail()`은 대상 아님 — `$inc` 원자 증가만 써서 애초에 재시도 루프 자체가 없어
  락이 불필요)도 위 문단에 통합해 구현됨
- 우편 삭제(숨김) API(`DELETE /mailbox/:mailId`) 추가 — `mailbox` 문서에 `deletedAt`
  플래그를 두고, `GET /mailbox` 조회 쿼리 자체가 `deletedAt: null`을 조건에 포함해 삭제된
  건은 select도 하지 않는다(실제 문서 삭제 아님). **수령(claimedAt)한 우편만 삭제 가능** —
  미수령 우편을 삭제하면 첨부물을 잃을 수 있어 `MAILBOX.NOT_CLAIMED`(7005)로 거부한다. 위
  만료 우편 정리 배치(수령 여부 무관, 유예기간 후 물리 삭제)와는 별개 메커니즘 — 이건
  플레이어가 자기 우편함을 스스로 정리하는 기능이고, 배치는 그와 무관하게 오래된 만료건을
  물리적으로 청소하는 서버 운영 정책이다
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
- 프론트엔드 핵심 루프(인벤토리+전투+우편) 추가 — 싱글 페이지(SPA-lite, 라우팅
  라이브러리 없이 JS로 섹션만 토글), `public/js/`에 바운디드 컨텍스트 1:1 대응 모듈
  (`inventory.js`/`battle.js`/`mailbox.js`) + 공용 `api.js`(fetch 래퍼)/`app.js`(진입점,
  로그인·탭 전환·공유 `state.player`). `GET /player/me`(신규, `playerService.ts`) 하나로
  로그인 여부 확인과 게임 화면 초기 데이터(재화/clearedStage/보유 카드 — 카드는 마스터
  데이터와 서버가 미리 조인해 등급/공격력/체력/속성까지 포함)를 겸한다. 상태를 바꾸는
  액션(전투 도전, 우편 수령) 뒤에는 `app.js`의 `refreshPlayer()` 하나가 헤더/인벤토리/
  전투/우편함 패널을 전부 다시 그린다 — 각 패널이 따로 로컬 상태를 들고 있지 않음.
  카드 이미지/애니메이션(GAME_DESIGN.md "최소 UI" 원칙)은 범위 밖.
  `innerHTML`로 동적 값을 꽂는 모든 지점(카드 등급/원형ID/속성, 우편 제목/첨부/mailId
  등)은 `api.js`의 `escapeHtml()`로 이스케이프한다(개발 컨벤션 14.4절 XSS 원칙) — 지금은
  전부 서버/마스터데이터 통제값이라 실사용 위험은 없지만, 향후 사용자 입력 필드가 추가돼도
  이 렌더링 코드 자체가 안전한 상태를 유지하도록 하는 방어적 조치. 새 동적 값을 innerHTML에
  추가할 때는 이 패턴을 그대로 재사용한다
- 몬스터 기본 스탯(`seedData.ts`의 `BASE_MONSTER_HP/ATTACK/DEFENSE`) 절반 하향 — 시작
  카드가 1장뿐인 상태에서 원래 값 기준으로는 최약체 시작 카드가 스테이지1부터, 평균
  카드도 스테이지2에서 결정론적으로(전투에 확률 요소 없음) 막히는 게 실사용 중 확인돼
  조정. 1.15배 성장 공식(GAME_DESIGN.md 6절 확정)은 그대로 두고 기준값만 낮춤 — 구체
  수치는 여전히 "임시값"(코드 주석 참고), 정식 밸런싱은 추후
- 프론트엔드 강화/합성 화면 추가 — `enhancement.js`(카드별 강화 버튼, 성공/실패/파괴 결과를
  텍스트로 표시)와 `synthesis.js`(등급 승급 합성 + 강화 재료 합성 두 폼) 신규. 합성 규칙(소재
  장수/성공률/골드)은 프론트에 하드코딩하지 않고 `GET /player/me` 응답에 `synthesisRules`(마스터
  데이터)를 포함시켜(squadMaxSize와 동일 패턴 — 새 조회 엔드포인트 대신 기존 응답 재사용)
  프론트가 체크박스 단계에서부터 등급/원형 불일치나 장수 초과 체크를 되돌리고, 선택할 때마다
  남은 장수/성공률/비용 힌트를 갱신하며, 조건이 정확히 맞을 때만 합성 시도 버튼을 보여준다.
  최종 검증은 여전히 서버가 한다(서버 권위 원칙)
- 감사 로그/DAU 중 `log_auth`(로그인/가입/로그아웃), `log_enhancement`(강화 시도),
  `log_synthesis`(등급 승급/강화 재료 합성), `log_battle_stage`(스테이지 클리어),
  그리고 `stats_daily_active_players`(DAU) 구현 — 정책 전체(대상 액션 목록)는 "감사 로그 /
  DAU 정책" 절 참고. `writeAuditLog()`는 `authService.ts`의 `loginOrRegister()`(로그인/
  가입, 동시 가입 레이스에서 진 요청은 자신이 만든 시작 카드가 실제로 저장되지 않았으므로
  register 대신 login으로 정정해 기록), `authRoutes.ts`의 로그아웃 핸들러,
  `enhancementService.ts`의 `enhanceCard()`, `synthesisService.ts`의
  `synthesizeGradeUpgrade()`/`synthesizeEnhanceMaterial()`, `battleStageService.ts`의
  `clearStage()`(전부 `withOptimisticRetry`의 `onSaved` 훅에서 호출 — `clearStage()`는
  `shouldSave`가 승리(=`mutated`)일 때만 `onSaved`를 부르는 구조라 패배 시엔 별도 분기
  없이도 로그가 구조적으로 안 남는다)에서 쓰인다. `markDailyActive()`는 `requireAuth`
  (인증이 필요한 모든 라우트의 공용 진입점)에서 매 요청마다 호출되지만 유니크 인덱스
  덕분에 실제로는 플레이어당 하루 1건만 남는다. `attempts_battle_stage`(전투 스테이지 승률/
  카드 조합 통계)도 `clearStage()`가 `withOptimisticRetry` 결과를 받은 뒤 승패 무관 매
  호출마다 직접 기록 — `log_battle_stage`(감사 로그, 승리 시에만)와 별개 목적/별개 컬렉션.
  `log_mailbox`(Mailbox 컨텍스트)까지 구현되어 대상 액션 전체가 완료됐다 —
  `mailboxService.ts`의 `sendMail()`(다른 도메인 로그에도 `mailSourceId`로 같은 이벤트가
  남지만, 각 감사 로그 컬렉션은 앞으로 자기 만료 정책으로 독립적으로 클렌징될 수 있어
  다른 컬렉션이 먼저 지워지면 상관관계 추적이 끊긴다 — 그래서 `log_mailbox` 자체에도
  발송을 남겨 발송→수령→삭제 생애주기가 이 컬렉션 하나로 항상 재구성 가능하게 한다.
  `insertMail()`이 멱등 스킵인지 실제 삽입인지를 boolean으로 반환하도록 바꿔, 재시도로 인한
  중복 로그를 막는다)/`claimMail()`(수령한 첨부물까지 포함)/`deleteMail()`,
  `mailboxCleanupService.ts`의 `runMailboxCleanupJob()`(배치, `SYSTEM_ACTOR`로 기록 —
  단 `deletedCount`가 0이면 상태 변경이 없어 다른 도메인과 동일 기준으로 로그도 생략)에서
  쓰인다. 이 기능을 e2e 테스트 파일에서 실제로 타면(예: `requireAuth`를 거치는 모든 보호
  라우트, 또는 `runMailboxCleanupJob()`을 직접 호출하는 배치 테스트) 로그 DB 커넥션
  (`mongoLogClient`)이 처음 열리므로, 그 테스트 파일의 `after()` 훅에도
  `mongoLogClient.close()`를 반드시 같이 추가해야 한다 — 안 하면 프로세스가 안 끝나
  테스트가 멈춘다(이미 있는 모든 e2e 테스트 파일에 이 훅을 추가해둠,
  `mailboxCleanupService.e2e.test.ts` 포함)
- 페이스북 로그인 연동 추가(Authorization Code Flow 하나만 — 자세한 이유와 구글과의 차이는
  "인증 전략" 절 참고), 이어서 향후 프로바이더 추가 시 라우트/authService를 계속 건드리지
  않도록 `SocialAuthProvider` 인터페이스 + `authRoutes.ts`의 레지스트리 배열 순회 방식으로
  리팩터링 완료(상세는 "인증 전략" 절) — `socialAuthProvider.ts`(신규), `googleAuth.ts`의
  `googleAuthCodeProvider`/`facebookAuth.ts`의 `facebookAuthProvider`(각각 인터페이스 구현
  객체), `authService.ts`의 `loginWithSocialProvider()`(프로바이더별 분기 없는 단일 함수).
  OAuth 콜백(구글 authorization_code/페이스북 공통) 실패 시에도 `errorHandler`의 날것 JSON
  대신 `/?loginError=1`로 리다이렉트해 로그인 화면에 안내 메시지를 보여준다
  (`authRoutes.ts`의 `handleOAuthCallback()`). 구글/페이스북 모두 로그인 자체는 e2e 테스트
  대상 밖(실제 프로바이더 서버 연동 필요, mock 안 씀)
- 회원가입 시 닉네임 입력 흐름 추가(디폴트는 플랫폼 제공 닉네임) — 자세한 이유와 메커니즘은
  "인증 전략" 절 참고. 신규 사용자는 닉네임 제출 전까지 Player가 생성되지 않고 Redis에
  가입 보류 상태로만 남는다(`pendingRegistrationStore.ts`, 신규). `authService.ts`의
  `loginOrRegister()`는 신규/기존 여부에 따라 `LoginResult`(`"pending"`/`"login"`)를 반환하도록
  변경했고, 실제 Player 생성은 새 `completeRegistration()`이 담당한다. 라우트는
  `GET /auth/register/pending`/`POST /auth/register/complete` 2개 신규(GIS/리다이렉트 두
  로그인 방식이 전부 이 둘로 합류). 프론트는 `index.html`에 `registerScreen`(닉네임 입력 폼)
  섹션을 추가하고, `app.js`의 `showScreen()`을 로그인/닉네임입력/게임 3단 모드로 확장했다

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
  쓰기 컬렉션(players, mailbox)과 구분한다. 게임 콘텐츠도 플레이어 데이터도 아닌 서버
  내부 운영 상태(Change Stream resume token, 배치 중복실행 방지 마커 등)는 `system_`
  프리픽스로 별도 구분한다(`system_change_stream_state`, `system_batch_runs`) — 세
  카테고리(콘텐츠/플레이어/시스템)를 프리픽스만 보고 바로 구분할 수 있게 하기 위함
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
    쓰기 시 `$inc`). resume token은 `system_change_stream_state` 컬렉션(단일 문서)에 저장
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