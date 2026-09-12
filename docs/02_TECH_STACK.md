# TECH_STACK.md

기술 스택과 환경변수. 세부 아키텍처 결정(왜 이 스택을 골랐는지)은 이 문서가 아니라
루트 `CLAUDE.md`에서 관리한다 — 이 문서는 "무엇을 쓰는지"의 레퍼런스다.

## 프로젝트

- 레포명: `enhance-or-bust`
- 게임 타이틀: 강화하다 망함

## 백엔드

| 항목 | 선택 | 버전 |
|---|---|---|
| 런타임 | Node.js | 22 LTS (`--env-file` 네이티브 지원 전제) |
| 언어 | TypeScript | 5.9.3 |
| 웹 프레임워크 | Express | 4.22.2 |
| 통신 방식 | REST API | — |
| dev 실행기 | tsx (watch 모드) | 4.23.12 |
| 로깅 | log4js | 6.9.1 |
| 배치 스케줄러 | node-cron | 4.6.0 |
| 구글 로그인 검증 | google-auth-library | 11.0.2 |
| Git hook | husky | 9.1.7 (pre-commit) |

## 저장소

| 항목 | 선택 | 버전/드라이버 |
|---|---|---|
| MongoDB | 영구 저장소(앱 DB) + 감사 로그/DAU/통계 전용 물리 분리 DB(`enhance_or_bust_log`) | 드라이버 `mongodb` 6.21.0. Change Streams/멀티도큐먼트 트랜잭션(ClaimMail)을 쓰므로 로컬도 반드시 **replica set**(단일 노드도 가능)으로 띄운다 |
| Redis | 세션 저장, 분산 락(플레이어 단위 짧은 TTL), 가입 보류 상태 임시 저장 | 드라이버 `redis` 4.7.1 |

## 프론트엔드

| 항목 | 선택 |
|---|---|
| 스택 | 바닐라 JavaScript (ES 모듈, 빌드 스텝 없음) |
| 서빙 방식 | Express가 `public/`을 정적 파일로 API와 같은 오리진에서 서빙(CORS 설정 불필요) |

## 아키텍처

- 설계 방식: DDD (Domain-Driven Design)

## 바운디드 컨텍스트 (7개)

1. Inventory — 카드 보유 현황
2. Enhancement — 강화
3. Synthesis — 합성
4. Progression — 레벨업
5. Economy — 재화
6. Mailbox — 우편
7. Battle-Stage — 전투 판정 및 스테이지 진행

이 중 Inventory/Progression/Economy/Battle-Stage 4개는 `Player` 애그리게잇 하나로 묶여
단일 문서·낙관적 락으로 원자적으로 갱신된다(`docs/04_DATA_MODEL.md` 참고).

## 환경변수 (`.env`, `.env.example` 기준)

| 변수 | 기본값/예시 | 설명 |
|---|---|---|
| `PORT` | `3999` | HTTP 리슨 포트 |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/?replicaSet=rs0` | replica set 필수 |
| `MONGO_APP_DATABASE` | `enhance_or_bust` | 앱 DB(플레이어/우편/마스터데이터) |
| `MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD` | — | 앱 DB 계정 |
| `MONGO_APP_DATABASE_LOG` | `enhance_or_bust_log` | 감사 로그/DAU/통계 전용 물리 분리 DB |
| `MONGO_APP_USERNAME_LOG` / `MONGO_APP_PASSWORD_LOG` | — | 로그 DB 계정(메인과 다를 수 있음) |
| `REDIS_URL` | `redis://127.0.0.1:6380` | — |
| `REDIS_PASSWORD` | — | — |
| `REDIS_KEY_PREFIX` | `eob:` | 로컬 Redis를 여러 프로젝트가 공유할 때 키 충돌 방지 |
| `GOOGLE_CLIENT_ID` | — | 구글 로그인 공통 |
| `GOOGLE_AUTH_FLOW` | `id_token` | `id_token`(GIS) 또는 `authorization_code` |
| `GOOGLE_CLIENT_SECRET` | — | `authorization_code` 플로우에서만 필요 |
| `GOOGLE_REDIRECT_URI` | `http://127.0.0.1:3999/auth/google/callback` | — |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | — | 페이스북 로그인 |
| `FACEBOOK_REDIRECT_URI` | `http://localhost:3999/auth/facebook/callback` | — |
| `MAILBOX_CLEANUP_CRON` | `0 0 1 * *` | 만료 우편 정리 배치 스케줄(매월 1일 00시) |
| `MAILBOX_CLEANUP_RETENTION_MONTHS` | `3` | 만료 후 이 개월 수 지난 우편만 정리 대상 |
| `MASTER_DATA_POLL_INTERVAL_MS` | `300000` | Change Stream 유실 대비 폴링 fallback 주기 |
| `SESSION_TTL_SEC` | `604800`(7일) | Redis 세션 TTL |
| `INVENTORY_SLOT_CAP` | `200` | 인벤토리 슬롯 상한 |
| `SQUAD_MAX_SIZE` | `5` | 전투 출전 스쿼드 최대 장수 |
| `GM_PLATFORM_API_KEY` | — | gm_platform이 보내는 `X-API-Key`와 대조할 값 |

## 실행 스크립트 (`package.json`)

| 명령 | 설명 |
|---|---|
| `npm run dev` | `tsx watch --env-file=.env src/index.ts` — 파일 변경 시 자동 재시작 |
| `npm run seed` | 마스터 데이터 시드 |
| `npm test` | `tsx --test`로 `src/**/*.e2e.test.ts` 전체 실행(로컬 Mongo/Redis 필요) |
| `npm run build` | `tsc` — `dist/` 산출 |
| `npm start` | `node --env-file=.env dist/index.js` |
