/**
 * 우편 발송 트리거(컨텐츠)별 제목/만료일. 트리거가 늘어나거나 컨텐츠별 정책(제목,
 * 만료까지 걸리는 일수)이 바뀔 때 호출부를 뒤지지 않고 여기 한 곳만 고치면 되게
 * 모아둔다. 기획자가 게임 밸런스로 실시간 조정하는 값이 아니라 트리거를 추가하는
 * 개발자가 코드로 정의하는 값이라 마스터 데이터(DB)가 아닌 코드 상수로 둔다.
 * @author trisakion
 */
export interface MailContentConfig {
  /** 우편 제목 */
  title: string;
  /** 발송 시각으로부터 만료까지 걸리는 시간(ms) — 일→ms 환산까지 여기서 끝내둬서 호출부는
   *  `Date`에 그대로 더하기만 하면 되고, 일 단위보다 세밀한 만료(시간 단위 이벤트 우편 등)도
   *  이 필드 하나로 표현 가능하다. */
  expiryMs: number;
  /** `sendMail()`의 sourceType/DB에 실제로 저장되는 값. 객체 키(SCREAMING_SNAKE)는
   *  코드에서 골라 쓰는 식별자일 뿐이고, 이 필드가 유일한 실제 값 출처다(errorMap.ts의
   *  `ERROR_MAP.MAILBOX.NOT_FOUND` → `code: 7001` 패턴과 동일). */
  contentType: string;
}

export const MAIL_CONTENTS = {
  STAGE_CLEAR: { title: "스테이지 클리어 보상", expiryMs: 7 * 24 * 60 * 60 * 1000, contentType: "stage_clear" },
} as const satisfies Record<string, MailContentConfig>;

/** 실제 발송에 쓰이는 sourceType 값들의 유니온 — `MAIL_CONTENTS`의 키가 아니라 `contentType` 필드에서 도출한다. */
export type MailContentType = (typeof MAIL_CONTENTS)[keyof typeof MAIL_CONTENTS]["contentType"];
