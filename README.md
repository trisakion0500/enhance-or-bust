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

## 문서

- 상세 기획서: [`docs/design/GAME_DESIGN.md`](./docs/design/GAME_DESIGN.md)

## 현재 상태

기획 및 방향 확정 단계. 스캐폴딩은 이 스펙 기준으로 진행 예정.