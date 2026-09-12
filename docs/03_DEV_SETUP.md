# 03_DEV_SETUP.md

로컬 개발 환경 설정. 인프라 자동화(docker-compose 등)는 이 레포의 범위가 아니다 — 아래는
개발자가 로컬에 이미 설치된 MongoDB/Redis를 어떤 조건으로 띄워야 하는지에 대한 설명이다.

## 사전 준비

- **Node.js 22 이상** — `--env-file` 플래그(네이티브 `.env` 로딩)를 쓰므로 이보다 낮은
  버전은 `dev`/`seed`/`start` 스크립트가 그대로 동작하지 않는다.
- **MongoDB, 반드시 replica set으로 기동** (단일 노드 replica set도 가능) — 두 가지
  이유로 필수다:
  1. 마스터 데이터 리로드가 Change Streams를 쓴다(`src/shared-kernel/masterData/masterDataWatcher.ts`) — Change Streams는 replica set(또는 샤드 클러스터)에서만 동작한다.
  2. 우편 수령(`ClaimMail`)이 `mailbox`+`players` 두 컬렉션에 걸친 멀티도큐먼트 트랜잭션을 쓴다 — MongoDB 트랜잭션도 replica set 전제다.

  단일 노드를 replica set으로 초기화하는 방법(참고용):
  ```
  mongod --replSet rs0 --dbpath <데이터 경로> --port 27017
  ```
  다른 터미널에서 `mongosh`로 접속해:
  ```js
  rs.initiate()
  ```
  이미 일반 standalone으로 실행 중이던 인스턴스가 있다면 `--replSet` 옵션을 추가해
  재시작해야 한다.
- **Redis** — 세션/락/가입보류 저장용. 비밀번호를 설정해 뒀다면 `.env`의
  `REDIS_PASSWORD`에 맞춰준다. 로컬 Redis 하나를 다른 프로젝트와 같이 쓴다면
  `REDIS_KEY_PREFIX`로 키 네임스페이스를 분리한다(기본값 `eob:`).

## 설정 및 실행

```bash
npm install

cp .env.example .env
# .env를 열어 changeme로 표시된 값(Mongo/Redis 계정, 구글/페이스북 OAuth 클라이언트,
# GM_PLATFORM_API_KEY 등)을 실제 값으로 채운다. 전체 변수 설명은 02_TECH_STACK.md 참고.

npm run seed   # 마스터 데이터(카드 원형/등급/강화·합성 규칙/스테이지/카드드랍) 최초 적재
npm run dev    # http://localhost:3999 (PORT로 변경 가능)
```

- `npm run seed`는 여러 번 실행해도 안전하다(멱등 upsert) — 마스터데이터 값을 바꾼 뒤
  다시 실행하면 반영되고, `master_data_meta`의 해당 컨텐츠 버전이 올라가 이미 뜬
  서버가 있다면 Change Stream/폴링으로 자동 리로드된다.
- 구글/페이스북 OAuth 클라이언트를 아직 안 만들었다면, 로그인 관련 라우트를 제외한
  나머지(강화/합성/전투 등)는 e2e 테스트가 자체적으로 만든 `platformType: "test"`
  플레이어로 검증되므로 당장 필요하지 않다.

## 테스트

```bash
npm test
```

- Node 내장 테스트 러너(`node:test`)로 `src/**/*.e2e.test.ts`를 전부 실행한다. mock이나
  인메모리 DB 대역 없이 위에서 띄운 실제 로컬 Mongo/Redis에 그대로 붙는다 — 먼저 `npm run
  dev`로 서버를 띄워둘 필요는 없다(각 테스트 파일이 `createServer()`로 임시 포트에 직접
  띄운다).
- 각 테스트는 자기 테스트 데이터를 직접 만들고 정리한다 — 테스트 간 공유 상태 없음.

## 빌드/프로덕션 실행

```bash
npm run build   # tsc → dist/
npm start        # node --env-file=.env dist/index.js
```

## Git hook

`husky`가 pre-commit 훅을 등록해둔다(`npm install` 시 `prepare` 스크립트로 자동 설치).
