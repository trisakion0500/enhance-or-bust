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
