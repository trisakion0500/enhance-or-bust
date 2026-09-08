import type { Element } from "../../../shared-kernel/masterData/element.js";

/**
 * 스테이지 설정 마스터 데이터(`stage_configs` 컬렉션). 스테이지마다 문서 하나 — 몬스터
 * 스탯은 공식(기본값×1.15^스테이지번호)으로 계산한 값을 기획자가 검토 후 저장하며,
 * 필요 시 특정 스테이지만 예외적으로 다른 값으로 덮어쓸 수 있다.
 * @author trisakion
 */
export interface StageConfig {
  /** 스테이지 번호 */
  stageId: number;
  /** 몬스터 체력 */
  monsterHp: number;
  /** 몬스터 공격력 */
  monsterAttack: number;
  /** 몬스터 방어력 */
  monsterDefense: number;
  /** 몬스터 원소 속성 */
  monsterElement: Element;
  /** 최초 클리어 시 보상 골드(파밍 재도전 시 farmRewardRate만큼 축소) */
  rewardGold: number;
  /** 최초 클리어 시 출전 카드 1장당 보상 EXP(파밍 재도전 시 farmRewardRate만큼 축소) */
  rewardExp: number;
  /** 강화석 드랍 확률(0~1) */
  enhancementStoneDropRate: number;
  /** 강화석 드랍 시 최소 수량 */
  enhancementStoneMin: number;
  /** 강화석 드랍 시 최대 수량 */
  enhancementStoneMax: number;
  /** 이미 클리어한 스테이지를 재도전(파밍)할 때 모든 보상에 곱하는 배율(0~1) */
  farmRewardRate: number;
}
