# enhance-or-bust (강화하다 망함)

> 카드를 모으고 강화하다 파괴로 잃기도 하는 방치형(Idle) RPG — 확률/동시성/서버 권위
> 원칙을 실제로 부딪혀 보기 위한 MongoDB 학습 겸 포트폴리오 프로젝트

---

## 요약

카드 수집형 방치(Idle) RPG 서버 + 클라이언트. 강화 실패 시 카드가 파괴될 수 있는 확률
시스템과, 그 확률/전투 판정을 클라이언트가 아니라 서버가 직접 계산·검증하는 구조가
핵심이다.

- **핵심 기술**: Node.js 22 + Express + TypeScript · MongoDB(낙관적 락 + 멀티도큐먼트
  트랜잭션 + Change Streams) · Redis(세션/분산 락) · 바닐라 JavaScript
- **정량 현황**: 7개 바운디드 컨텍스트, API 엔드포인트 29개, e2e 테스트 7개 도메인
- **기술적 강조점**: Redis 짧은 TTL 락으로 낙관적 락 재시도 폭주 방지 · `(sourceType,
  sourceId)` 유니크 인덱스 기반 우편 멱등 발송 · 마스터 데이터 Change Stream + 폴링
  이중 안전망 · 스케일아웃 대비 로그 파일 인스턴스 suffix

---

## 목차

- [요약](#요약)
- [왜 만들었나](#왜-만들었나)
- [핵심 아이디어](#핵심-아이디어)
- [기술적 도전과 해결](#기술적-도전과-해결)
- [바운디드 컨텍스트](#바운디드-컨텍스트)
- [기술 스택](#기술-스택)
- [주요 기능](#주요-기능)
- [문서 목록](#문서-목록)
- [프로젝트 구조](#프로젝트-구조)
- [실행 방법](#실행-방법)
- [AI 활용](#ai-활용)
- [현재 상태](#현재-상태)
- [한계 및 개선 과제](#한계-및-개선-과제)
- [라이선스](#라이선스)

---

## 왜 만들었나

MongoDB가 처음인 상태에서, 익숙한 스택(Node.js+Express+MySQL)으로 한 번 스캐폴딩했던
걸 전량 폐기하고 다시 시작했다 — 이미 잘 아는 조합으로는 학습 목적을 채우지 못한다고
판단해서다. 장르를 방치형 RPG로 고른 이유는 확률(강화/합성/가챠)과
동시성(같은 플레이어의 강화 연타, 재화 경합)이 자연스럽게 많이 나오는 도메인이라
MongoDB의 낙관적 락/트랜잭션/Change Streams를 실전처럼 써볼 핑계가 되기 때문이다.

## 핵심 아이디어

- **서버 권위(server-authoritative) 원칙** — 강화/합성 성공 확률, 전투 판정(승패·
  데미지)은 전부 서버가 직접 계산한다. 클라이언트는 대상 ID만 보내고, 결과값을
  클라이언트가 주장해도 서버는 신뢰하지 않는다.
- **애그리게잇 경계 = 원자성 경계** — Inventory/Progression/Economy/Battle-Stage 4개
  컨텍스트는 항상 같은 플레이어 문서 안에서 낙관적 락 하나로 원자적으로 바뀐다. DDD
  관점에서 이 넷은 이미 하나의 애그리게잇(`Player`)이라는 판단으로 Repository도 하나로
  둔다.
- **우편(Mailbox) 경유 멱등 지급** — 두 컬렉션(players/mailbox)에 걸친 쓰기는
  트랜잭션 대신 `(sourceType, sourceId)` 유니크 인덱스 멱등키로 처리한다. 재시도가
  일어나도 같은 보상이 두 번 발송되지 않는다.

## 기술적 도전과 해결

### 1. 낙관적 락 재시도 폭주를 Redis 짧은 TTL 락으로 막기

- **문제**: 강화/합성/전투는 전부 "재조회 → 판정 → 조건부 업데이트(version 일치) →
  충돌 시 재시도" 구조다. 같은 플레이어가 강화 버튼을 연타하면 매 요청이 서로 충돌해
  재조회·재시도를 반복하고, 요청이 몰릴수록 DB 부하가 기하급수적으로 늘어난다.
- **왜 어려웠는가**: 낙관적 락 자체는 정합성을 이미 보장한다 — 진짜 문제는 정합성이
  아니라 "안전하지만 비효율적인 재시도"가 부하로 이어지는 성능 문제였다. 락을 걸어
  대기시키면 처리량은 늘지만 응답 지연이 커지고, 그렇다고 아무 조치도 안 하면 연타가
  그대로 DB에 재시도 폭주로 전달된다.
- **어떻게 해결했는가**: 플레이어 단위 Redis 짧은 TTL(5초) 락으로 전체를 감싸고, 락
  획득에 실패하면 대기 없이 즉시 429(`COMMON.LOCKED`)로 거부한다(fail-fast, 짧게 3회·
  150ms 간격 재시도 후 포기). 정합성은 여전히 `version` 낙관적 락이 보장하므로 이 락은
  순수 부하 최적화다.
- **결과**: 연타 자체가 DB에 도달하기 전에 걸러져, 낙관적 락 재시도가 정상적인 동시
  접속 수준으로만 발생한다. 상세: [`docs/06_ENHANCEMENT_SYNTHESIS_SCENARIO.md`](docs/06_ENHANCEMENT_SYNTHESIS_SCENARIO.md)

### 2. 두 컬렉션에 걸친 쓰기를 트랜잭션 없이 멱등하게

- **문제**: 스테이지 클리어 보상(골드/강화석/카드 드랍)은 players 문서 갱신과 별개로
  mailbox 문서를 새로 만든다. Battle-Stage는 낙관적 락 재시도 구조라, 재시도가 여러 번
  일어나면 우편도 여러 번 발송될 위험이 있다.
- **왜 어려웠는가**: MongoDB 트랜잭션으로 묶으면 간단하지만, players 컨텍스트는 원래
  "트랜잭션 없이 낙관적 락"이라는 원칙을 지키고 있다 — 이 케이스 하나 때문에 그 원칙을
  깨고 싶지 않았다.
  - `sourceId`를 `"{playerId}:{stageId}:{clearedAt}"`처럼 매 시도마다 새로 만들면
    재시도 때마다 값이 달라져 멱등키가 무력화된다.
- **어떻게 해결했는가**: `mailbox` 문서에 `(sourceType, sourceId)` 유니크 인덱스를 걸고,
  **재시도 루프 전체에서 같은 `sourceId`를 재사용**한다. 쓰기 순서도 players update →
  성공 시에만 mailbox insert로 고정해, 재시도 시 유니크 인덱스 충돌이 중복 삽입을
  막는다.
- **결과**: players 컨텍스트는 트랜잭션 없이 낙관적 락 원칙을 그대로 유지하면서도,
  재시도가 몇 번 일어나든 우편은 정확히 한 번만 생성된다. 상세: [`docs/07_BATTLE_MAILBOX_SCENARIO.md`](docs/07_BATTLE_MAILBOX_SCENARIO.md)

### 3. 마스터 데이터 리로드 — Change Streams만 믿지 않기

- **문제**: 카드 원형/강화 규칙/스테이지 설정 같은 마스터 데이터는 서버 메모리에
  캐시해두고, 운영 중 값이 바뀌면 재시작 없이 반영돼야 한다.
- **왜 어려웠는가**: MongoDB Change Streams는 at-most-once push라 콜백 처리 오류나
  connection 끊김으로 이벤트를 놓칠 수 있다 — "리로드가 안 됐는데 아무도 모르는" 상황이
  가장 위험하다.
- **어떻게 해결했는가**: 콜백을 try/catch로 감싸 이벤트 하나의 처리 실패가 스트림
  전체를 죽이지 않게 하고, connection 재연결은 resume token 저장 + 지수 백오프(1초→
  2초→4초...60초 상한)로 재시도 폭주를 막는다. 그리고 별도로, 각 컨텐츠의 DB 버전과
  캐시 버전을 주기적으로 비교하는 폴링을 fallback으로 둔다(Change Streams가 주 채널,
  폴링은 유실 감지용 안전망).
- **결과**: Change Stream이 정상일 때는 즉시 반영되고, 어떤 이유로든 이벤트를 놓쳐도
  최악의 경우 폴링 주기(기본 5분) 안에는 항상 다시 맞춰진다. 상세: [`docs/04_DATA_MODEL.md`](docs/04_DATA_MODEL.md)

---

## 바운디드 컨텍스트

7개로 분리한다 — Inventory(카드 보유) / Enhancement(강화) / Synthesis(합성) /
Progression(레벨업) / Economy(재화) / Mailbox(우편) / Battle-Stage(전투 판정). 이 중
Inventory/Progression/Economy/Battle-Stage 4개는 `Player` 애그리게잇 하나로 묶여 있다
(위 "핵심 아이디어" 참고). 상세는 [`docs/04_DATA_MODEL.md`](docs/04_DATA_MODEL.md).

---

## 기술 스택

| 항목 | 스택 |
|---|---|
| 런타임/언어 | Node.js 22 + TypeScript |
| 웹 프레임워크 | Express |
| DB | MongoDB(낙관적 락, 멀티도큐먼트 트랜잭션, Change Streams) |
| 캐시 | Redis(세션, 분산 락, 가입 보류 상태) |
| 프론트엔드 | 바닐라 JavaScript(빌드 스텝 없음) |
| 아키텍처 | DDD, 7개 바운디드 컨텍스트 |
| 테스트 | Node 내장 테스트 러너(`node:test`)로 e2e만 |

세부 버전과 환경변수는 [`docs/02_TECH_STACK.md`](docs/02_TECH_STACK.md) 참고.

---

## 주요 기능

- **강화/합성** — 강화 단계별 성공률·파괴 확률, 동일 등급 승급 합성(80%)과 강화 재료
  합성(100%) 두 경로
- **전투/스테이지** — 서버가 직접 시뮬레이션하는 라운드제 전투, 원소 상성, 파밍
  재도전(보상 축소)
- **우편(Mailbox)** — 멱등 발송, 트랜잭션 기반 수령, 인벤토리 슬롯 상한 검증,
  만료 우편 정리 배치
- **소셜 로그인** — 구글(GIS `id_token`/`authorization_code` 둘 다 지원) + 페이스북,
  가입 보류(닉네임 입력) 흐름
- **감사 로그/DAU/전투 통계** — 상태 변경 액션 전체 추적 + 일일 활성 사용자 + 스테이지
  승률 통계
- **[gm_platform](https://github.com/trisakion0500/gm_platform)(이전에 직접 개발한
  운영툴 프로젝트) 연동** — 운영자가 플레이어/마스터데이터/감사로그를 조회할 수 있는
  S2S API(X-API-Key 인증)

---

## 문서 목록

| 문서 | 내용 |
|---|---|
| [01_GAME_DESIGN.md](docs/01_GAME_DESIGN.md) | 상세 기획서(확정본) |
| [02_TECH_STACK.md](docs/02_TECH_STACK.md) | 기술 스택, 환경변수, 실행 스크립트 |
| [03_DEV_SETUP.md](docs/03_DEV_SETUP.md) | 로컬 개발 환경 설정(replica set 필수 등) |
| [04_DATA_MODEL.md](docs/04_DATA_MODEL.md) | 컬렉션 구조, 원자성 경계, 다이어그램 |
| [05_DATABASE_SCHEMA.md](docs/05_DATABASE_SCHEMA.md) | 컬렉션별 필드/인덱스 |
| [06_ENHANCEMENT_SYNTHESIS_SCENARIO.md](docs/06_ENHANCEMENT_SYNTHESIS_SCENARIO.md) | 강화/합성 동시성 처리 흐름 |
| [07_BATTLE_MAILBOX_SCENARIO.md](docs/07_BATTLE_MAILBOX_SCENARIO.md) | 전투 클리어→우편 발송→수령 흐름 |
| [08_AUDIT_LOG_POLICY.md](docs/08_AUDIT_LOG_POLICY.md) | 감사 로그/DAU/전투 통계 정책 |
| [09_AUTH_SECURITY.md](docs/09_AUTH_SECURITY.md) | 소셜 로그인, 세션, S2S 인증 |
| [10_API_COMMON.md](docs/10_API_COMMON.md) | 응답 포맷, 에러 코드 전체 |
| [11_AUTH_API.md](docs/11_AUTH_API.md) | 로그인/가입/로그아웃 |
| [12_ENHANCEMENT_API.md](docs/12_ENHANCEMENT_API.md) | 강화 |
| [13_SYNTHESIS_API.md](docs/13_SYNTHESIS_API.md) | 합성 |
| [14_BATTLE_STAGE_API.md](docs/14_BATTLE_STAGE_API.md) | 전투/스테이지 |
| [15_MAILBOX_API.md](docs/15_MAILBOX_API.md) | 우편 |
| [16_PLAYER_API.md](docs/16_PLAYER_API.md) | 플레이어 조회 |
| [17_GM_API.md](docs/17_GM_API.md) | gm_platform 연동 API |
| [18_GM_PLATFORM_INTEGRATION.md](docs/18_GM_PLATFORM_INTEGRATION.md) | gm_platform 연동 배경/설계 |
| [19_FRONTEND.md](docs/19_FRONTEND.md) | 화면 구성, JS 모듈 매핑 |
| [20_TEST_STRATEGY.md](docs/20_TEST_STRATEGY.md) | 테스트 전략 |

---

## 프로젝트 구조

```
enhanceOrBust/
├── src/
│   ├── contexts/        # 바운디드 컨텍스트별(application/domain/infrastructure/routes)
│   │   ├── auth/ battleStage/ enhancement/ synthesis/ mailbox/ player/ gm/
│   ├── shared-kernel/   # 공용 헬퍼(에러맵, 낙관적 락 재시도, Redis 락, 감사 로그, 마스터데이터 캐시 등)
│   ├── infra/           # Mongo/Redis/log4js 연결
│   ├── config/          # 환경변수 로딩
│   └── scripts/         # 마스터 데이터 시드
├── public/              # 프론트엔드(바닐라 JS, 빌드 스텝 없음)
├── config/log4js.json   # 로깅 설정(재빌드 없이 파일만 수정하면 반영)
└── docs/                # 설계 문서(위 목록)
```

---

## 실행 방법

```bash
npm install
cp .env.example .env   # 값 채우기(docs/02_TECH_STACK.md 참고)
npm run seed            # 마스터 데이터 시드
npm run dev              # http://localhost:3999
```

MongoDB는 반드시 **replica set**으로 띄워야 한다(Change Streams/우편 수령 트랜잭션
전제). 상세 절차는 [`docs/03_DEV_SETUP.md`](docs/03_DEV_SETUP.md).

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 실행(파일 변경 시 자동 재시작) |
| `npm run seed` | 마스터 데이터 시드 |
| `npm test` | e2e 테스트 실행(로컬 Mongo/Redis에 실제로 붙어서 검증) |
| `npm run build` | TypeScript 컴파일(`dist/`) |
| `npm start` | 빌드된 결과물 실행(프로덕션용) |

---

## AI 활용

이 프로젝트는 AI를 개발 보조 도구로 활용한 워크플로우 자체도 학습/실험 대상으로 삼아
진행했다. 게임 규칙/데이터 모델링/동시성 전략 같은 설계 결정은 개발자가 먼저 판단하고
방향을 제시한 뒤, Claude Code로 그 설계를 실제 코드로 구현하고 문서를 정리하는 데
활용했다 — 예를 들어 Redis 짧은 TTL 락을 fail-fast로 둘지 대기시킬지, 우편 멱등키를
어떤 값으로 구성할지 같은 트레이드오프는 먼저 논의하고 결정한 뒤 구현했다.

| 도구 | 용도 |
|---|---|
| Claude Code | 코드/문서 초안 작성, 반복 구현 작업, 로컬 e2e 테스트 실행 보조 |

---

## 현재 상태

- [x] 부트스트랩(Mongo/Redis 연결, 로깅, 에러 핸들링)
- [x] Player 애그리게잇(Inventory/Economy, 낙관적 락) + Repository
- [x] 마스터 데이터 캐시(Change Stream/폴링 워처, 시드 스크립트)
- [x] 구글 로그인(GIS/Authorization Code Flow) + 페이스북 로그인 + Redis 세션 인증
- [x] 회원가입 시 닉네임 입력 흐름(닉네임 제출 전까지 Player 생성 보류)
- [x] 강화/합성(등급 승급·강화 재료) API + e2e 테스트
- [x] Progression(레벨업) + Battle-Stage(전투/스테이지) API + e2e 테스트
- [x] Mailbox 도메인(SendMail 멱등 발송, ClaimMail 트랜잭션 수령) API + e2e 테스트
- [x] 스테이지 클리어 보상 Mailbox 경유 지급 + 확률적 카드 드랍
- [x] 만료 우편 정리 배치(node-cron, 인스턴스 중복 실행 방지)
- [x] Redis 분산 락(강화/합성/전투-스테이지, 플레이어 단위 짧은 TTL, fail-fast)
- [x] 인벤토리 슬롯 상한(우편 수령 시점 검증)
- [x] 프론트엔드 핵심 루프(인벤토리/강화/합성/전투/우편, SPA-lite)
- [x] 감사 로그/DAU/전투 스테이지 승률 통계
- [x] gm_platform 연동(X-API-Key 인증) — 플레이어/마스터데이터/감사로그 조회
- [x] 클러스터(다중 인스턴스) 구동 대비 로그 파일 인스턴스 suffix

세부 구현 내역은 [`docs/09_AUTH_SECURITY.md`](docs/09_AUTH_SECURITY.md),
[`docs/18_GM_PLATFORM_INTEGRATION.md`](docs/18_GM_PLATFORM_INTEGRATION.md) 참고.

---

## 한계 및 개선 과제

- **밸런스 수치는 전부 초기 표준값** — 강화 확률표, 등급별 성장 상한, 합성 승급
  확률(80/20), 가챠 확률(N/R/SR/SSR), 몬스터 기본 스탯 모두 실측 전 임시값이다. 몬스터
  기본 스탯은 실사용 중 최약체 시작 카드가 스테이지 1~2에서 결정론적으로(확률 요소 없는
  전투라) 막히는 게 확인돼 한 차례 하향 조정했지만, 정식 밸런싱은 아직이다.
- **마스터데이터 저장(쓰기) API 없음** — gm_platform 연동은 현재 조회만 지원한다.
  밸런스 데이터가 잘못 저장되면 게임 전체에 영향을 줄 수 있어, 컬렉션별 값 검증(확률
  0~1, 음수 불가 등) 설계를 먼저 한 뒤 추가하기로 미뤘다.
- **계정 연결 기능 없음** — 같은 사람이 구글/페이스북 각각으로 로그인하면 서로 다른
  Player로 생성된다. 여러 로그인 수단을 한 플레이어에 연결하는 기능은 다루지 않았다.
- **환경별 설정 파일 분리 없음** — `log4js.${NODE_ENV}.json`처럼 환경별로 로깅 설정을
  나누는 것은 아직 하지 않았다(필요해지면 도입).

## 라이선스

이 프로젝트는 채용 과정에서의 열람·평가 및 개인적인 학습·참고 목적으로 공개됩니다.
상업적 이용(실제 서비스, 사내 시스템 포함)은 금지됩니다. 자세한 내용은
[LICENSE.md](LICENSE.md)를 참고하세요.
