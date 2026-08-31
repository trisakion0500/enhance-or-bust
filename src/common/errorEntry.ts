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
 * @author trisakion
 */
export interface ErrorEntry {
  code: number;
  message: string;
  httpStatus: number;
}
