# 20_TEST_STRATEGY.md

- **E2E만 작성한다.** 단위 테스트는 아직 없음 — 도메인 로직이 라우트 하나당 서비스 함수
  하나로 단순해서 API 레벨 검증이 곧 로직 검증과 크게 다르지 않고, 실제로 값어치가 큰 건
  라우트→미들웨어→서비스→DB까지 이어지는 전체 경로가 맞물려 돌아가는지다.
- **Node 내장 테스트 러너**(`node:test`, `node:assert/strict`)만 쓴다. Jest/Vitest/
  Mocha 같은 테스트 프레임워크나 supertest 같은 HTTP 어서션 라이브러리를 추가하지
  않음 — Node 22 기준 내장 러너와 전역 `fetch`만으로 충분.
- **mock이나 인메모리 DB 대역 라이브러리**(mongodb-memory-server 등)를 쓰지 않고,
  로컬 개발용 실제 Mongo/Redis에 그대로 붙는다. `createServer()`(DI로 조립만 하고
  `listen()`은 안 하는 팩토리, `server.ts`)를 임시 포트로 띄워 `fetch`로 호출한다.
- **각 테스트가 자기 테스트 데이터**(플레이어 등)를 직접 만들고 `finally`에서 직접
  지운다 — 테스트 간 공유 상태 없이 독립적으로 격리. `platformType: "test"`로 실제
  구글/페이스북 로그인 유저와 구분되게 만든다.
- **파일 네이밍**: `*.e2e.test.ts`, 대상 라우트 파일 옆에 둔다(예:
  `enhancementRoutes.ts` ↔ `enhancementRoutes.e2e.test.ts`). `npm test`가
  `tsx --test`로 이 패턴을 전부 실행한다.
- 이 감사 로그 기능을 실제로 타는 테스트 파일(`requireAuth`를 거치는 모든 보호 라우트,
  또는 `runMailboxCleanupJob()`을 직접 호출하는 배치 테스트)은 로그 DB 커넥션
  (`mongoLogClient`)이 처음 열리므로, 그 테스트 파일의 `after()` 훅에도
  `mongoLogClient.close()`를 반드시 같이 추가해야 한다 — 안 하면 프로세스가 안 끝나
  테스트가 멈춘다.

## 현재 테스트 파일

`src/**/*.e2e.test.ts` 패턴에 걸리는 파일은 라우트/배치 도메인당 하나씩이다
(`src/contexts/{auth,battleStage,enhancement,synthesis,player,mailbox}/**` +
`mailboxCleanupService.e2e.test.ts`). 정확한 목록/개수는 리포지토리에서
`find src -name "*.e2e.test.ts"`로 항상 최신 상태를 직접 확인한다 — 이 문서에 개수를
고정해서 적지 않는 이유는 테스트가 늘어날 때마다 이 문서를 갱신해야 하는 드리프트를
피하기 위함이다.
