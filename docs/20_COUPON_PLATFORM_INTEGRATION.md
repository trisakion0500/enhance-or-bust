# 20_COUPON_PLATFORM_INTEGRATION.md

또 다른 별도 포트폴리오 프로젝트인 [`coupon_platform`](https://github.com/trisakion0500/coupon_platform)과의
연동 — 플레이어가 게임 내에서 쿠폰 코드를 입력해 보상을 받는 기능(`src/contexts/coupon/`).
gm_platform 연동(`18_GM_PLATFORM_INTEGRATION.md`)과 방향이 반대다 — gm_platform은 그쪽이
이 서버를 호출하지만, coupon_platform은 이 서버가 그쪽을 호출하는(게임서버로서의) 연동이다.

## 작업 범위 원칙

**`coupon_platform`의 소스도 gm_platform과 동일한 원칙으로 절대 건드리지 않는다** —
그쪽 관리 콘솔 API를 호출해 데이터를 등록/조회하는 것만 허용되고, 파일 수정은 전부 이
레포(`enhanceOrBust`) 안에서만 이루어진다. 이 프로젝트용 프로젝트(company
`Developer Company`, `project_code=EOB`, `project_id=9`)도 coupon_platform 관리 콘솔
API(`POST /projects`, SUPER_ADMIN 계정)를 1회 호출해 등록했다.

## 인증 — HMAC 서명(발신 방향)

상세는 `09_AUTH_SECURITY.md`의 "coupon_platform 연동(발신 방향)" 절. gm_platform과
달리 API Key 단순 대조가 아니라 API Key + HMAC-SHA256 서명을 쓴다 — 재화(쿠폰 보상)가
걸린 API라 coupon_platform 쪽이 요구하는 보안 수준이 더 높기 때문이다.

## SDK 이식

coupon_platform이 입점사(게임서버)용으로 그대로 제공하는 SDK
(`test_game_server/src/sdk/CouponS2sClient.ts`, 그쪽 `docs/21_TEST_GAME_SERVER.md` 9장)를
가져와 `src/contexts/coupon/infrastructure/couponS2sClient.ts`에 두었다 — reserve/confirm
서명·호출 로직은 원본과 동일하고 JSDoc만 이 프로젝트 스타일로 정리했다. 원본에 있는
`getUnconfirmed()`(미확인 소모 건 조회)는 이 프로젝트가 쓰지 않아 뺐다(아래 "재처리
배치" 절 참고). coupon_platform 쪽 원본이 바뀌면 다시 복사해오는 방식이지, 이 사본을
coupon_platform 저장소에 역으로 반영하지 않는다.

## reward_data 스키마

캠페인 생성 시 coupon_platform 관리자가 입력하는 `reward_data`는 자유 형식 JSON이라
coupon_platform은 내용을 모른다 — 이 프로젝트가 스스로 스키마를 정했다: `gold`/
`enhancementStone`/`diamond`/`cardTemplateIds`. Mailbox의 `MailAttachments`와 필드명을
그대로 맞춰서(`couponService.ts`의 `toMailAttachments()`) 별도 변환 테이블 없이 옮긴다.
캠페인을 coupon_platform 콘솔에서 만들 때 이 필드명 그대로 `reward_data`를 입력해야
한다.

## 사용 흐름과 지급 경로

`POST /coupon/redeem`(`19_COUPON_API.md`)이 `reserve()` → 우편(Mailbox) 발송 → `confirm()`
순으로 처리한다. 스테이지 클리어 보상과 동일하게 우편 경유로 지급해 인벤토리 슬롯 상한
검증 등을 다시 만들 필요가 없다. 우편의 `sourceType`/`sourceId`는 `"coupon"`/`reserve()`가
반환한 `coupon_code_usage_id`(coupon_platform 쪽에서 같은 소모 건에 항상 동일하게
반환되는 값)를 그대로 써서, 재시도로 인한 중복 지급을 막는다.

## `player_coupon` — 상태 추적과 크래시 복구

메인 게임 DB의 `player_coupon` 컬렉션(player/player_mailbox와 동일한 player_ 프리픽스가 붙은 런타임
쓰기 컬렉션, `couponRedemptionStore.ts`)에 `reserve()` 성공 응답을 받는 즉시 상태를
기록한다(`_id`는 `coupon_code_usage_id`, 필드: `reservedAt`/`mailGrantedAt`/`confirmedAt`).

이렇게 하는 이유: coupon_platform이 "사용됨"으로 확정한 순간과 이 서버가 실제로 보상을
지급하는 순간 사이에 서버가 죽는 극히 드문 크래시가 나도, 이 레코드가 남아있는 한 무엇이
빠졌는지 정확히 알 수 있다. 처음엔 이 레코드 없이 coupon_platform의 `getUnconfirmed()`
응답만으로 보정하려 했는데, 그 응답엔 `coupon_code_usage_id`가 없어 원래 발송 때 쓴 우편
sourceId를 재구성할 방법이 없었다 — 크래시 케이스를 영영 놓칠 수 있는 구멍이 있었다.
지금은 이 컬렉션이 소스 오브 트루스라 해결됐고, coupon_platform의 `getUnconfirmed()` API
자체를 더 이상 호출하지 않는다.

부수 효과로 이 컬렉션이 곧 이 게임서버 자체의 독립적인 쿠폰 사용 집계가 된다 —
coupon_platform 관리 콘솔의 집계와 대조해 불일치를 찾는 운영 체크에도 쓸 수 있다.

## confirm 실패 처리 — 즉시 재시도 + 매일 새벽 4시 재처리 배치

`confirm()`은 지급 결과 보고일 뿐이라 실패해도 이미 보낸 우편에는 영향이 없다.

1. `redeemCoupon()` 안에서 `confirmWithRetry()`가 짧은 백오프(1초→3초, 최초 포함 총
   3회)로 즉시 재시도한다 — 그마저 실패해도 요청 자체는 성공으로 끝난다.
2. `reconcileUnconfirmedCoupons()`가 `COUPON_RECONCILE_CRON`(기본 매일 새벽 4시) 주기로
   `player_coupon`에서 `confirmedAt: null`인 레코드를 조회해 처리한다 —
   `mailGrantedAt`이 비어있으면(크래시로 미지급) 먼저 `sendMail()`로 보정 지급하고 나서
   confirm을 보고한다.

confirm/sendMail 둘 다 멱등이라 — ClaimMail의 `$inc` 원자 증가와 같은 이유로 — 여러
인스턴스가 동시에 이 배치를 돌려도 `system_batch_runs` 같은 중복 실행 방지 락이
필요 없다.

## 에러 코드 대역

coupon_platform이 반환하는 result 코드(31005/33001/33002/33003 등)는 이 레포의 에러
코드 대역(11000번대, `COUPON_ERROR_MAP`)으로 옮겨서 응답한다 — gm_platform(10000번대)과
동일하게 새 연동마다 새 대역을 하나씩 쓴다. 전체 목록은 `19_COUPON_API.md`.
