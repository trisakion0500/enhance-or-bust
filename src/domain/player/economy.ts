import { BusinessException } from "../../common/businessException.js";
import { ERROR_MAP } from "../../common/errorMap.js";

/**
 * 플레이어가 보유한 재화 3종(골드/강화석/다이아). 잔액은 절대 음수가 될 수 없다는 불변식을
 * 여기서 지킨다 — 차감 메서드 3개가 각자 검증을 반복하지 않도록 {@link Economy.deduct}로 공통화.
 * @author trisakion
 */
export class Economy {
  /**
   * @param gold 보유 골드(기본 0)
   * @param enhancementStone 보유 강화석(기본 0)
   * @param diamond 보유 다이아(기본 0)
   */
  constructor(
    public gold: number = 0,
    public enhancementStone: number = 0,
    public diamond: number = 0,
  ) {}

  /**
   * @param amount 차감할 골드
   * @throws {BusinessException} 잔액 부족 시 ECONOMY.INSUFFICIENT_BALANCE
   */
  deductGold(amount: number): void {
    this.gold = Economy.deduct(this.gold, amount);
  }

  /** @param amount 지급할 골드 */
  addGold(amount: number): void {
    this.gold += amount;
  }

  /**
   * @param amount 차감할 강화석
   * @throws {BusinessException} 잔액 부족 시 ECONOMY.INSUFFICIENT_BALANCE
   */
  deductEnhancementStone(amount: number): void {
    this.enhancementStone = Economy.deduct(this.enhancementStone, amount);
  }

  /** @param amount 지급할 강화석 */
  addEnhancementStone(amount: number): void {
    this.enhancementStone += amount;
  }

  /**
   * @param amount 차감할 다이아
   * @throws {BusinessException} 잔액 부족 시 ECONOMY.INSUFFICIENT_BALANCE
   */
  deductDiamond(amount: number): void {
    this.diamond = Economy.deduct(this.diamond, amount);
  }

  /** @param amount 지급할 다이아 */
  addDiamond(amount: number): void {
    this.diamond += amount;
  }

  /**
   * @param balance 차감 전 잔액
   * @param amount 차감할 금액
   * @returns 차감 후 잔액
   * @throws {BusinessException} 차감 후 잔액이 음수가 되면 ECONOMY.INSUFFICIENT_BALANCE
   */
  private static deduct(balance: number, amount: number): number {
    if (balance < amount)
      throw new BusinessException(ERROR_MAP.ECONOMY.INSUFFICIENT_BALANCE, { balance, amount });
    return balance - amount;
  }
}
