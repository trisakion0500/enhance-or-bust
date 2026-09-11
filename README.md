# enhance-or-bust (강화하다 망함)

카드 수집형 방치(Idle) RPG 프로젝트.

## 만들려는 것

- 카드를 수집·강화·합성하며 스테이지를 진행하는 방치형 RPG 서버 + 클라이언트
- 핵심 컨텐츠: 카드 보유(Inventory), 강화(Enhancement), 합성(Synthesis),
  레벨업(Progression), 재화(Economy), 우편(Mailbox), 전투/스테이지(Battle-Stage)
- 강화 실패 시 파괴 확률이 있는 확률 시스템, 서버가 클라이언트 결과를 신뢰하지
  않고 직접 판정하는 구조

## 개발 스펙

- 백엔드: Node.js + TypeScript
- DB: MongoDB
- 캐시: Redis
- 프론트엔드: 바닐라 JavaScript
- 아키텍처: DDD (도메인 주도 설계, 7개 바운디드 컨텍스트)

## 문서

- 상세 기획서: [`docs/design/GAME_DESIGN.md`](./docs/design/GAME_DESIGN.md)
- 기술 스택 상세: [`docs/architecture/TECH_STACK.md`](./docs/architecture/TECH_STACK.md)
- API 문서: [`docs/api/API.md`](./docs/api/API.md)

## 실행 방법

사전 준비: `.env.example`을 복사해 `.env`를 만들고 값을 채운다(로컬 MongoDB replica set,
Redis, 구글 OAuth 클라이언트 정보 등).

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 실행 (파일 변경 시 자동 재시작) |
| `npm run seed` | 마스터 데이터(카드 원형/등급/강화·합성 규칙/스테이지) 시드 |
| `npm test` | E2E 테스트 실행 (로컬 Mongo/Redis에 실제로 붙어서 검증) |
| `npm run build` | TypeScript 컴파일 (`dist/`) |
| `npm start` | 빌드된 결과물 실행 (프로덕션용) |

## API

강화/합성/전투-스테이지/우편은 세션 인증(`sessionToken` 쿠키)이 필요하다. 확률 판정과
전투 결과는 전부 서버가 직접 계산하며 클라이언트 입력값을 신뢰하지 않는다. 엔드포인트
전체 목록, 요청/응답 예시, 에러 코드는 [`docs/api/API.md`](./docs/api/API.md) 참고.

## 현재 상태

기획/아키텍처 확정.

- [x] 부트스트랩 (Mongo/Redis 연결, 로깅, 에러 핸들링)
- [x] Player 애그리게잇 (Inventory/Economy, 낙관적 락) + Repository
- [x] 마스터 데이터 캐시 (Change Stream/폴링 워처, 시드 스크립트)
- [x] 구글 로그인 (Google Identity Services/Authorization Code Flow) + Redis 세션 인증
- [x] 페이스북 로그인 (Authorization Code Flow)
- [x] 세션 인증 미들웨어
- [x] 강화(Enhancement) API + E2E 테스트
- [x] 합성(Synthesis) API(등급 승급/강화 재료) + E2E 테스트
- [x] Progression(레벨업) + Battle-Stage(전투/스테이지) API + E2E 테스트
- [x] Mailbox 도메인(SendMail 멱등 발송, ClaimMail 트랜잭션 수령) API + E2E 테스트
- [x] 스테이지 클리어 보상(골드/강화석)의 Mailbox 경유 전환(EXP/clearedStage는 즉시 지급 유지)
- [x] 만료 우편 정리 배치 잡(node-cron, 매월 1일 00시 실행, 인스턴스 중복 실행 방지)
- [x] Redis 분산 락(강화/합성/전투-스테이지, 플레이어 단위 짧은 TTL, fail-fast)
- [x] 프론트엔드: 구글 로그인 페이지(`public/index.html`, GIS/Authorization Code Flow 둘 다 대응)
- [x] 스테이지 클리어 확률적 카드 드랍(스테이지별 가중치 드랍 테이블, 우편 경유 지급)
- [x] 인벤토리 슬롯 상한(`INVENTORY_SLOT_CAP`, 우편 수령 시점에 카드 첨부물 검증 — 초과 시 거부하고 우편은 미수령 상태로 남김)
- [x] 프론트엔드 핵심 루프(인벤토리/전투/우편, SPA-lite) + `GET /player/me` 조회 API
- [x] 프론트엔드 강화/합성 화면
- [x] 감사 로그(`log_auth`/`log_enhancement`/`log_synthesis`/`log_battle_stage`/
      `log_mailbox`)/DAU(`stats_daily_active_players`)/전투 스테이지 승률 통계
      (`attempts_battle_stage`, 승패 무관 매 시도 기록) — 로그인/가입/로그아웃/강화
      시도/합성(등급 승급·강화 재료)/스테이지 클리어/우편(발송·수령·삭제·만료정리 배치)까지
      대상 액션 전체 구현 완료
- [x] gm_platform 연동(X-API-Key 인증) — 플레이어 조회/전체목록(`POST /gm/get-player`),
      보유 카드 조회(`POST /gm/get-player-cards`), 시드데이터(마스터데이터) 6종 조회(읽기
      전용, `POST /gm/get-card-templates` 등)