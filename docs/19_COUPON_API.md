# 19_COUPON_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 연동 배경/원칙은
`20_COUPON_PLATFORM_INTEGRATION.md`와 `09_AUTH_SECURITY.md` 참고.

플레이어가 게임 내에서 쿠폰 코드를 입력해 보상을 받는 엔드포인트. 세션 쿠키로 인증하고
(`requireAuth`), 내부적으로 [coupon_platform](https://github.com/trisakion0500/coupon_platform)의
S2S API(reserve/confirm)를 호출한다.

### `POST /coupon/redeem`

쿠폰 코드를 사용한다. **인증 필요.**

**요청 body**
```json
{ "code": "23A4-B7C9-DEF2" }
```

**처리 흐름**: coupon_platform에 `reserve()` 호출 → 성공하면 즉시 이 서버 DB
(`player_coupon`)에 상태를 기록 → 응답의 `reward_data`를 `gold`/`enhancementStone`/
`diamond`/`cardTemplateIds`로 매핑해 **우편(Mailbox)으로 발송** → coupon_platform에
`confirm()` 보고. 다른 보상(스테이지 클리어 등)과 동일하게, 실제 지급은 플레이어가
`GET /mailbox` → `POST /mailbox/:mailId/claim`으로 수령해야 인벤토리/재화에 반영된다.

**응답**
```json
{
  "result": 0,
  "attachments": { "gold": 500, "enhancementStone": 10 }
}
```
`attachments`는 우편으로 발송된 내용의 미리보기일 뿐, 이 응답 시점에 재화/카드가 바로
지급된 것은 아니다(위 처리 흐름 참고).

**에러**

| Result Code | HTTP | 설명 |
|---|---|---|
| 9002 | 401 | 미인증 |
| 11000 | 400 | `code` 누락/형식 오류 |
| 11001 | 404 | 존재하지 않는 쿠폰 코드 |
| 11002 | 409 | 이미 사용된 쿠폰 코드 |
| 11003 | 409 | 지금은 사용할 수 없는 쿠폰(캠페인 기간 종료/소진 등) |
| 11004 | 409 | 이 계정의 쿠폰 사용 한도 초과 |
| 11999 | 500 | coupon_platform 연동 오류(인증 실패/네트워크 오류 등, 일시적 서버 오류로 노출) |

coupon_platform 쪽 캠페인 생성/코드 발급은 이 API의 전제 조건이며, 관리 콘솔에서
사람이 직접 준비해야 한다(이 레포 작업 범위 밖) — 상세는 `20_COUPON_PLATFORM_INTEGRATION.md`.
