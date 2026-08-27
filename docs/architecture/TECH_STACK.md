# TECH_STACK.md

## 프로젝트

- 레포명: `enhance-or-bust`
- 게임 타이틀: 강화하다 망함

## 백엔드

| 항목 | 선택 |
|---|---|
| 런타임 | Node.js |
| 언어 | TypeScript |
| 통신 방식 | REST API |

## 저장소

| 항목 | 선택 |
|---|---|
| MongoDB | 영구 저장소 |
| Redis | 캐시/조회 최적화 |

## 프론트엔드

| 항목 | 선택 |
|---|---|
| 스택 | 바닐라 JavaScript |

## 아키텍처

- 설계 방식: DDD (Domain-Driven Design)

## 바운디드 컨텍스트 (7개)

1. Inventory — 카드 보유 현황
2. Enhancement — 강화
3. Synthesis — 합성
4. Progression — 레벨업
5. Economy — 재화
6. Mailbox — 우편
7. Battle/Stage — 전투 판정 및 스테이지 진행
