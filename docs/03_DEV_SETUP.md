# 03_DEV_SETUP.md

# 로컬 개발 환경 설정

인프라 자동화(docker-compose 등)는 이 레포의 범위가 아니다 — 아래는 개발자가 로컬에
이미 설치된 MongoDB/Redis를 어떤 조건으로 띄워야 하는지에 대한 설명이다.

---

# 1. 사전 요구사항

| 항목 | 버전 |
|---|---|
| Node.js | 22 이상 — `--env-file` 플래그(네이티브 `.env` 로딩)를 쓰므로 이보다 낮으면 `dev`/`seed`/`start` 스크립트가 그대로 동작하지 않는다 |
| MongoDB | 반드시 replica set으로 기동(단일 노드 replica set도 가능) — 이유는 3.1절 |
| Redis | 버전 무관 |
| Git | 최신 버전 |

---

# 2. 저장소 클론

```bash
git clone https://github.com/trisakion0500/enhance-or-bust.git
cd enhance-or-bust
npm install
```

이 최상위 `npm install`이 `husky`를 설치하고 `prepare` 스크립트로 pre-commit
훅(커밋 전 크리덴셜 스캔)을 활성화한다 — 건너뛰어도 개발 자체는 가능하지만, 실수로
크리덴셜을 커밋하는 걸 막아주는 훅이 걸리지 않는다.

---

# 3. MongoDB / Redis 준비

## 3.1 MongoDB — replica set 기동

두 가지 이유로 standalone이 아니라 반드시 replica set이어야 한다:

1. 마스터 데이터 리로드가 Change Streams를 쓴다(`src/shared-kernel/masterData/masterDataWatcher.ts`) — Change Streams는 replica set(또는 샤드 클러스터)에서만 동작한다.
2. 우편 수령(`ClaimMail`)이 `mailbox`+`players` 두 컬렉션에 걸친 멀티도큐먼트 트랜잭션을 쓴다 — MongoDB 트랜잭션도 replica set 전제다.

단일 노드를 replica set + 인증 활성화로 초기화하는 방법(참고용):

```bash
mongod --replSet rs0 --auth --dbpath <데이터 경로> --port 27017
```

다른 터미널에서 `mongosh`로 접속해(계정이 아직 없는 상태에서 로컬호스트로 접속하는
최초 1회는 MongoDB의 "localhost exception"으로 인증 없이도 허용된다):

```js
rs.initiate()
```

이미 일반 standalone으로 실행 중이던 인스턴스가 있다면 `--replSet --auth` 옵션을
추가해 재시작해야 한다. 단일 노드 replica set은 멤버 간 인증(keyFile)이 필요 없다 —
통신할 다른 멤버 자체가 없기 때문이다.

## 3.2 MongoDB 계정 생성

`mongo.ts`/`mongoLog.ts`가 메인 DB(`enhance_or_bust`)와 로그 DB
(`enhance_or_bust_log`)를 물리적으로 다른 계정으로 연결한다(계정이 각자 자기 DB에만
접근하도록 `authSource`를 분리 — 로그 DB 커넥션 장애가 메인 DB 인증에 영향을 주지
않게 하는 CLAUDE.md 로깅 원칙의 연장). 위 `rs.initiate()`에 이어서 같은 `mongosh`
세션에서 두 계정을 만든다:

```js
use enhance_or_bust
db.createUser({ user: "changeme", pwd: "changeme", roles: [{ role: "readWrite", db: "enhance_or_bust" }] })

use enhance_or_bust_log
db.createUser({ user: "changeme", pwd: "changeme", roles: [{ role: "readWrite", db: "enhance_or_bust_log" }] })
```

`user`/`pwd`는 각각 `.env`의 `MONGO_APP_USERNAME`/`MONGO_APP_PASSWORD`,
`MONGO_APP_USERNAME_LOG`/`MONGO_APP_PASSWORD_LOG`와 정확히 일치해야 한다(예시로
`.env.example` 기본값인 `changeme`를 그대로 썼다 — 실제 값으로 바꿨다면 여기도 맞춰
바꾼다). 이 단계를 건너뛰면 서버 기동 시 두 커넥션 모두 인증 실패로 연결되지 않는다.

## 3.3 Redis

세션/락/가입보류 저장용. 비밀번호를 설정해 뒀다면 `.env`의 `REDIS_PASSWORD`에
맞춰준다. 로컬 Redis 하나를 다른 프로젝트와 같이 쓴다면 `REDIS_KEY_PREFIX`로 키
네임스페이스를 분리한다(기본값 `eob:`).

---

# 4. 백엔드 설정

## 4.1 환경변수 설정

```bash
cp .env.example .env
```

`.env`를 열어 `changeme`로 표시된 값(Mongo/Redis 계정, 구글/페이스북 OAuth 클라이언트,
`GM_PLATFORM_API_KEY` 등)을 실제 값으로 채운다. 전체 변수 목록/기본값/설명은
`02_TECH_STACK.md`의 "환경변수" 절 참고 — 여기서 중복하지 않는다.

구글/페이스북 OAuth 클라이언트를 아직 안 만들었다면, 로그인 관련 라우트를 제외한
나머지(강화/합성/전투 등)는 e2e 테스트가 자체적으로 만든 `platformType: "test"`
플레이어로 검증되므로 당장 필요하지 않다.

## 4.2 마스터 데이터 시드 및 실행

```bash
npm run seed   # 마스터 데이터(카드 원형/등급/강화·합성 규칙/스테이지/카드드랍) 최초 적재
npm run dev    # http://localhost:3999 (PORT로 변경 가능)
```

`npm run seed`는 여러 번 실행해도 안전하다(멱등 upsert) — 마스터데이터 값을 바꾼 뒤
다시 실행하면 반영되고, `master_data_meta`의 해당 컨텐츠 버전이 올라가 이미 뜬
서버가 있다면 Change Stream/폴링으로 자동 리로드된다.

---

# 5. 테스트

```bash
npm test
```

- Node 내장 테스트 러너(`node:test`)로 `src/**/*.e2e.test.ts`를 전부 실행한다. mock이나
  인메모리 DB 대역 없이 위에서 띄운 실제 로컬 Mongo/Redis에 그대로 붙는다 — 먼저 `npm run
  dev`로 서버를 띄워둘 필요는 없다(각 테스트 파일이 `createServer()`로 임시 포트에 직접
  띄운다).
- 각 테스트는 자기 테스트 데이터를 직접 만들고 정리한다 — 테스트 간 공유 상태 없음.

---

# 6. 빌드/프로덕션 실행

```bash
npm run build   # tsc → dist/
npm start        # node --env-file=.env dist/index.js
```

---

# 7. 실행 확인

| 항목 | 확인 방법 |
|---|---|
| DB/Redis 연결 | 서버 기동 로그의 `connected to mongo db ...` 메시지 확인 |
| 마스터 데이터 적재 | 서버 기동 로그의 `마스터 데이터 캐시 적재 완료, change stream/폴링 워처 시작` 메시지 확인 |
| 게임 진입 | 구글/페이스북 OAuth를 설정했다면 브라우저에서 로그인, 아니면 `npm test`로 `platformType: "test"` 플레이어 경로 검증 |
