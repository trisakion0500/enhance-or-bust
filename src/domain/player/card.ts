/**
 * 유저가 실제로 보유한 카드 한 장 — 원형 데이터(`CardTemplate`, 등급/기본 스탯)는 참조만 하고
 * 이 엔티티 자신은 인스턴스별로 달라지는 성장 상태(레벨/EXP/강화 단계)만 갖는다.
 * 최대 레벨/최대 강화 단계는 등급마다 달라서(`GradeConfig` 마스터 데이터) 이 클래스에
 * 고정 상수로 두지 않는다 — 실제 상한 검증은 등급 조회가 가능한 Enhancement/Progression
 * 도메인 서비스 쪽에서 한다.
 * @author trisakion
 */
export class Card {
  /**
   * @param cardId 카드 고유 ID
   * @param templateId 원형(CardTemplate) 참조 ID
   * @param level 현재 레벨(기본 1)
   * @param exp 현재 EXP(기본 0)
   * @param enhancementLevel 현재 강화 단계(기본 0)
   */
  constructor(
    public readonly cardId: string,
    public readonly templateId: string,
    public level: number = 1,
    public exp: number = 0,
    public enhancementLevel: number = 0,
  ) {}
}
