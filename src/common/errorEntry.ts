/**
 * `ERROR_MAP`의 각 항목이 갖는 형태 — 코드/메시지/HTTP 상태를 한 곳에서 관리하기 위한 최소 단위.
 * @author trisakion
 */
export interface ErrorEntry {
  /** 도메인별 대역(1000=Common, 2000=Inventory, 3000=Enhancement, 4000=Synthesis, 5000=Progression, 6000=Economy, 7000=Mailbox, 8000=Battle-Stage)으로 나뉜 API 응답용 숫자 코드 */
  code: number;
  message: string;
  httpStatus: number;
}
