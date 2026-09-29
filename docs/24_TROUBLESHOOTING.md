# 24_TROUBLESHOOTING.md

개발/운영 중 겪은 장애와 원인, 해결 방법을 시간순으로 기록한다. 목적은 재발 방지 —
같은 증상을 다시 만났을 때 처음부터 진단하지 않고 여기서 원인과 해결 코드를 바로
확인할 수 있게 한다. 설계 배경 설명이 아니라 "실제로 터진 사고" 기록이라는 점에서
`CLAUDE.md`의 각 기술 절(예: "마스터 데이터 로딩/리로드 전략")과 다르다 — 거기는
확정된 설계와 그 이유를, 여기는 그 설계를 실전에서 깨뜨린 구체적 사고 사례를 담는다.

---

## 2026-09-18 마스터 데이터 change stream 이벤트 폭주로 인한 JS 힙 OOM 크래시

### 증상

메인 DB(`enhance_or_bust`)와 로그 DB(`enhance_or_bust_log`)의 모든 컬렉션을 삭제 후
재생성하고 마스터 데이터를 재시드한 뒤 서버를 기동하면, 부팅 후 약 30~33초 시점에
아무 에러 로그도 없이 프로세스가 죽었다(재현율 100%). `node --max-old-space-size`
확장 없이 힙이 약 4GB까지 차오른 뒤 크래시하는 패턴으로, 콘솔/log4js 어느 쪽에도
단서가 남지 않아 원인 파악이 어려웠다.

### 진단 과정

부트스트랩 단계를 하나씩 분리한 독립 `.mjs` 스크립트로 이분 탐색했다:

1. Mongo/Redis 연결만 → 안정적
2. + 마스터 데이터 최초 로드 → 안정적
3. + `startMasterDataWatch()`(change stream 워처 시작) → 약 30초 후 크래시
4. 드라이버 레벨에서 앱 코드 없이 `db.watch()`만 직접 호출(resume token 없이) →
   이벤트 0건, 안정적

3번과 4번의 차이(resume token 유무)로 좁혀져, `system_change_stream_state`
컬렉션에 이전 서버 인스턴스가 남긴 오래된 resume token 문서(`{_id: "masterData",
resumeToken: {...}}`)가 원인임을 확인했다.

### 원인

컬렉션을 전부 삭제 후 재생성하면서 `system_change_stream_state`는 같이 지우지
않아, 거기 저장된 resume token만 살아남았다. 서버가 이 토큰으로 `resumeAfter`
재구독을 시도하면 — 토큰 자체는 여전히 oplog 보존 범위 안에 있어 **재구독 자체는
성공**한다 — 토큰 시점부터 그 사이 벌어진 대량 drop/recreate/reseed 작업으로 쌓인
방대한 이벤트 백로그를 한꺼번에 재생하게 된다.

이때 `masterDataWatcher.ts`의 이벤트 핸들러가 `changeStream.on("change", async
event => { ... await masterDataCache.reload(db, content); ... })` 형태였다 —
Node `EventEmitter`는 리스너가 `async`여도 완료를 기다리지 않고 다음 이벤트가
오면 즉시 또 호출한다. 이벤트가 몰려 들어오는 속도가 `reload()`(컬렉션 풀스캔)
처리 속도를 앞지르면서, 완료되지 않은 `reload()` 프로미스가 무제한으로 동시에
쌓여 힙을 소진시켰다.

이 실패 모드는 기존에 있던 `NonResumableChangeStreamError` 안전망(토큰이 oplog
보존 범위를 완전히 벗어나 재구독 자체가 실패하는 경우)으로는 잡히지 않는다 —
재구독은 "성공"했고 단지 그 직후 이벤트가 폭주했을 뿐이라 `error` 이벤트 자체가
발생하지 않았기 때문이다.

### 즉시 조치 (임시)

`system_change_stream_state`에서 `{_id: "masterData"}` 문서를 수동 삭제해 서버가
처음부터 전체 재구독하도록 했다. 45초 이상 안정성 모니터링 + API 헬스체크로 확인.
컬렉션을 통째로 wipe하는 작업을 다시 할 때는 `system_change_stream_state`도 함께
지워야 한다는 걸 잊지 않아야 한다 — 단, 아래 구조적 수정 이후로는 이 수동 조치가
더 이상 필요하지 않다.

### 구조적 수정 (재발 방지)

근본 원인은 "토큰이 오래됨"이 아니라 "이벤트 처리에 백프레셔가 없음"이라, 토큰
나이를 체크하는 대증 처방 대신 `masterDataWatcher.ts`의 이벤트 소비 방식 자체를
바꿨다 — `changeStream.on("change", ...)` 푸시 방식을 `for await (const event of
changeStream)` 풀 방식으로 전환(`consumeChangeStream()` 함수). `for await`는 매
반복마다 드라이버에게 다음 이벤트를 명시적으로 요청하며, 그 요청은 이전 이벤트의
`reload()`가 끝난 뒤에만 나간다 — 드라이버가 이벤트를 미리 당겨와 쌓아두지 않으므로
동시 실행 프로미스가 무제한으로 누적될 수 없다. 이벤트가 아무리 몰려도(이번처럼
대량 wipe 직후 백로그를 재생하는 경우 포함) 한 번에 하나씩만 처리된다.

부수적으로 `stopMasterDataWatch()`의 의도적 종료(`changeStream.close()`)를 이
루프가 에러로 오인해 재연결을 시도하지 않도록 `stopping` 플래그를 추가했다.

상세 코드는 `src/shared-kernel/masterData/masterDataWatcher.ts`의
`consumeChangeStream()` 참고.

---

## 2026-09-20 Redis/Mongo 다운 시 요청이 무한 대기하는 문제 (사고 아님 — 재현 테스트 중 발견)

### 발견 경위

출석 감사 로그 수정 검증차 e2e 테스트를 돌렸는데, `--env-file=.env` 없이 실행한 탓에
Redis 연결이 안 되는 상태에서 프로세스가 종료되지 않고 계속 떠 있었다(`timeout` 강제
종료 전까지 9분 이상). 처음엔 테스트 하네스 실수로 보였지만, 재현해보니 **env 파일
문제와 무관하게 Redis/Mongo가 실제로 다운된 상황에서도 똑같이 재현되는 구조적 문제**임을
확인했다.

### 원인

- **Redis**(`redis` v4, `createClient`): `reconnectStrategy`를 지정하지 않으면 기본값
  (`Math.min(retries * 50, 500)`)이 적용돼 재연결을 절대 포기하지 않고 최대 500ms
  간격으로 무한 재시도한다. 동시에 `disableOfflineQueue` 기본값(`false`)이라, 연결이
  끊긴 동안 들어온 명령(`SET`/`EVAL` 등)은 에러를 던지지 않고 **재연결될 때까지 무기한
  큐잉 대기**한다. `withPlayerLock()`의 `redisClient.set(...)` 호출이 정확히 이 경로로
  걸려있었다 — 코드 주석엔 "Redis 오류도 fail-fast로 거부한다"고 되어 있었지만, 이건
  *명령이 에러를 던지는 경우*에만 해당하고 *연결 자체가 안 되는 경우*엔 적용되지 않았다.
- **MongoDB**(`mongodb` v6): 기본 `serverSelectionTimeoutMS`가 30초라 무한은 아니지만,
  API 요청 하나가 30초씩 걸려있게 되는 건 마찬가지로 나쁜 사용자 경험이다.

### 조치

1. **명령/서버 선택 타임아웃 도입**: Redis는 `redisCall()`(모든 Redis 호출부가 재사용하는
   래퍼, 12초 타임아웃)로 명령을 감싸고, Mongo는 `serverSelectionTimeoutMS`를 30초 → 12초로
   줄였다. 12초는 "VM 재부팅처럼 오래 걸리는 다운은 빨리 실패시키되, 수 초짜리 네트워크
   순단은 버틴다"는 절충값이다.
2. **재연결 자체는 포기하지 않게 유지**: 처음엔 Redis `reconnectStrategy`가 12초를 넘기면
   `Error`를 반환해 재연결을 포기하도록 구현했는데, **이렇게 하면 node-redis가 재연결
   시도를 영구적으로 중단한다는 걸 실제로 재현해서 발견했다**(Redis를 다시 켜도 클라이언트가
   다시 연결하지 않음). 그래서 `reconnectStrategy`는 항상 숫자(지연 시간)만 반환하도록
   되돌리고, "다운 판정"은 별도의 boolean 플래그(`isRedisHealthy()`)로만 추적하도록 분리했다
   — 재연결 시도 자체는 절대 멈추지 않아야 복구 시 사람 개입 없이 자동으로 다시 열린다.
3. **circuit breaker 추가**: `dbHealthGate` 미들웨어가 다운 판정 상태에서는 라우트 핸들러
   진입 전에 즉시 503으로 거부해, 다운 중 들어오는 모든 신규 요청이 개별적으로 타임아웃을
   기다리며 자원을 붙들고 있는 것을 막는다.

### 검증

로컬 Docker에서 `redis-local`/`mongodb-local` 컨테이너를 각각 내렸다 올려 실측했다:

| 시나리오 | 결과 |
|---|---|
| Redis 다운 중 요청 | 47ms 만에 즉시 503 |
| Redis 복구 후 요청 | 재기동 2초 내 정상 응답으로 자동 복귀 |
| Mongo 다운 중 요청 | 46ms 만에 즉시 503 |
| Mongo 복구 후 요청 | 재기동 3초 내 정상 응답으로 자동 복귀 |

상세 코드는 `src/infra/redis.ts`(`isRedisHealthy()`/`redisCall()`), `src/infra/mongo.ts`
(`isMongoHealthy()`), `src/shared-kernel/dbHealthGate.ts` 참고. 설계 배경은 CLAUDE.md
"현재 상태" 절의 해당 항목 참고.

---

## 2026-09-29 Redis 최초 연결(부팅) 자체가 안 되면 무한 대기하는 문제 (2026-09-20 조치의 사각지대)

### 발견 경위

gm_platform 카드 원형 저장 API의 e2e 테스트를 추가하고 돌리는 과정에서, 또다시
`--env-file=.env` 없이 실행해 Redis가 기본 포트(6379)로 연결을 시도했다(이 로컬
환경은 docker-compose가 6380에 매핑) — 2026-09-20 항목과 정확히 같은 트리거다.
이번엔 서버가 아니라 프로세스 자체가 몇 분째 아무 응답도 없이 떠 있었고, 추적해보니
2026-09-20 조치가 다루지 않은 사각지대였다.

### 원인

2026-09-20 조치는 "이미 연결된 클라이언트의 명령"과 "이미 떠 있는 서버가 도중에
다운되는 경우"만 다뤘다. `connectRedis()`(`src/infra/redis.ts`)가 부팅 시 최초로
호출하는 `redisClient.connect()`는 이 둘 중 어디에도 해당하지 않는다 — node-redis
v4는 `reconnectStrategy`를 최초 연결에도 그대로 적용하는데, 이 전략은 절대 `Error`를
반환하지 않고 항상 backoff 숫자만 반환한다(2026-09-20 조치 항목 2 — 의도적 설계).
그 결과 `connect()`가 반환하는 프로미스는 최초 연결이 한 번도 성공하지 못하면
**resolve도 reject도 되지 않고 영원히 pending 상태로 남는다.** `redisCall()`(명령
단위 12초 타임아웃)은 이미 연결된 클라이언트가 명령을 보낼 때만 적용돼 이 케이스를
감싸지 못했고, `connectRedis()` 자체엔 어떤 시한도 없었다.

### 조치

- `connectRedis()`에 부팅 전용 12초 시한 추가(`Promise.race([redisClient.connect(),
  timeout])`) — 넘기면 명확한 에러로 던진다. `reconnectStrategy`는 그대로 둬(운영 중
  자동 복구 유지), 이 시한은 오직 "최초 연결"에만 적용된다.
- `index.ts`에 `connectOrExit()` 헬퍼 추가 — 부팅 단계 연결(`connectMongo()`/
  `connectMongoLog()`/`connectRedis()`) 실패 시 로그를 남기고 `process.exit(1)`한다.
  "부팅 중" 대 "운영 중"은 코드 구조로 구분된다 — 이 세 함수는 프로세스 생애주기
  동안 index.ts에서 딱 한 번만 호출되고, 그 이후 재연결은 전부 드라이버 내부 로직
  (하트비트, reconnectStrategy)이 맡는다.
- 부팅 시점은 관리자가 화면을 보고 있다는 전제로, "늦게라도 복구되길 기다린다"
  대신 "즉시 실패를 알리고 멈춘다"를 택했다.

### 검증

잘못된 Redis 포트(`REDIS_URL=redis://127.0.0.1:9`)로 기동 → 12초 후 명확한 에러
로그와 함께 `process.exit(1)`로 정상 종료 확인. 이후 올바른 env로 gm 라우트 e2e
스위트(19개) + 전체 스위트(72개) 재실행, 회귀 없음.

상세 코드는 `src/infra/redis.ts`(`connectRedis()`), `src/index.ts`(`connectOrExit()`)
참고. 설계 배경은 CLAUDE.md "현재 상태" 절의 "MongoDB/Redis 다운 상황에 대한 회복력
보강" 항목 참고.
