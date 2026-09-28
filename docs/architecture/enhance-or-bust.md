# 아키텍처 문서 — enhance-or-bust

기준 커밋 `9c88667` 시점의 서버 구조 스냅샷. 하나의 큰 다이어그램 대신 개요 1개 +
컨텍스트별 상세 11개로 나눠져 있다(분할 기준은 `.claude/scripts/arch/split-by-context.mjs` 참고). 각 문서는 같은 이름의 `.svg`를 함께 갖는다.

## 개요

- [enhance-or-bust-overview.md](enhance-or-bust-overview.md) — 11개 컨텍스트를 박스 하나로 접고, 컨텍스트 간 연결만 집계해서 보여준다. 전체 그림이 필요할 때 여기부터 본다.

## 컨텍스트별 상세

| 컨텍스트 | 문서 |
|---|---|
| 부트스트랩 | [enhance-or-bust-bootstrap.md](enhance-or-bust-bootstrap.md) |
| 공용 인프라 · 외부 연동 | [enhance-or-bust-infra.md](enhance-or-bust-infra.md) |
| Auth — 인증 | [enhance-or-bust-auth.md](enhance-or-bust-auth.md) |
| Player — Inventory/Progression/Economy | [enhance-or-bust-player.md](enhance-or-bust-player.md) |
| Enhancement — 강화 | [enhance-or-bust-enhancement.md](enhance-or-bust-enhancement.md) |
| Synthesis — 합성 | [enhance-or-bust-synthesis.md](enhance-or-bust-synthesis.md) |
| Battle-Stage — 전투 판정 | [enhance-or-bust-battleStage.md](enhance-or-bust-battleStage.md) |
| Mailbox — 우편 | [enhance-or-bust-mailbox.md](enhance-or-bust-mailbox.md) |
| Coupon — 쿠폰 연동 | [enhance-or-bust-coupon.md](enhance-or-bust-coupon.md) |
| Attendance — 출석보상 | [enhance-or-bust-attendance.md](enhance-or-bust-attendance.md) |
| GM — 운영툴 연동 | [enhance-or-bust-gm.md](enhance-or-bust-gm.md) |

각 상세 문서는 그 컨텍스트 자신의 노드 + 공용 인프라로 나가는 호출만 담는다 — 다른 기능 컨텍스트로 넘어가는 호출은 개요 쪽에만 집계되어 있다.
