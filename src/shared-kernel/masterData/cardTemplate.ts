import type { Element } from "./element.js";
import type { Grade } from "./grade.js";

/**
 * 카드 원형 데이터(`master_card_templates` 컬렉션). 등급과 기본 공격력은 기획자가 고정값으로
 * 관리한다 — 등급별 범위(GAME_DESIGN.md 1절)는 템플릿을 설계할 때 참고하는 가이드일 뿐,
 * 개별 카드 생성 시 런타임 랜덤 롤은 하지 않는다.
 * @author trisakion
 */
export interface CardTemplate {
  /** 카드 원형 고유 ID */
  templateId: string;
  /** 카드 등급 */
  grade: Grade;
  /** 기본 공격력(등급별 범위 내 고정값, GAME_DESIGN.md 1절) */
  baseAttack: number;
  /** 기본 체력(전투 시뮬레이션용, GAME_DESIGN.md 6절) */
  baseHp: number;
  /** 원소 속성(3원소 상성, GAME_DESIGN.md 6절) */
  element: Element;
}
