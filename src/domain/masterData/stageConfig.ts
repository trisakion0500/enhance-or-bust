/**
 * 스테이지 설정 마스터 데이터(`stage_configs` 컬렉션). 스테이지마다 문서 하나 — 필요
 * 전투력은 공식(기본값×1.15^스테이지번호)으로 계산한 값을 기획자가 검토 후 저장하며,
 * 필요 시 특정 스테이지만 예외적으로 다른 값으로 덮어쓸 수 있다.
 * @author trisakion
 */
export interface StageConfig {
  /** 스테이지 번호 */
  stageId: number;
  /** 클리어에 필요한 전투력 */
  requiredPower: number;
  /** 클리어 보상 골드 */
  rewardGold: number;
  /** 클리어 보상 EXP */
  rewardExp: number;
}
