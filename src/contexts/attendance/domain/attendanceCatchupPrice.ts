/**
 * 캐치업 회차별 가격(`attendance_catchup_prices` 컬렉션) — "몇 일차를 사는지"가 아니라
 * "몇 번째 구매인지"에 가격이 붙는다(23_GAME_DESIGN_ATTENDANCE.md "가격 정책" 절). 재화는
 * 골드만 쓴다.
 * @author trisakion
 */
export interface AttendanceCatchupPrice {
  _id: string;
  defId: string;
  /** 1부터 시작하는 구매 회차 */
  purchaseIndex: number;
  /** 골드 가격 */
  price: number;
}
