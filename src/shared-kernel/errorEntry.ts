/**
 * `ERROR_MAP`의 각 항목이 갖는 형태 — 코드/메시지/HTTP 상태를 한 곳에서 관리하기 위한 최소 단위.
 *  - 공통(Common)                : 1000
 *  - 인벤토리(Inventory)         : 2000
 *  - 강화(Enhancement)           : 3000
 *  - 합성(Synthesis)             : 4000
 *  - 성장(Progression)           : 5000
 *  - 경제(Economy)               : 6000
 *  - 우편(Mailbox)               : 7000
 *  - 전투/스테이지(Battle-Stage)  : 8000
 *  - 인증(Auth)                  : 9000
 * @author trisakion
 */
export interface ErrorEntry {
  /** 응답 `result` 필드에 실리는 도메인 결과 코드 */
  code: number;
  /** 사용자에게 그대로 노출되는 정제된 메시지(스택트레이스 등 내부 정보 제외) */
  message: string;
  /** 응답 HTTP 상태 코드 */
  httpStatus: number;
}
