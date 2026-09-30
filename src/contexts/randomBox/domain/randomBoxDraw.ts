import { pickWeightedCardTemplate } from "../../battleStage/domain/cardDrop.js";
import type { RandomBoxCustomPool } from "./randomBoxCustomPool.js";
import type { RandomBoxGradeRate } from "./randomBoxGradeRate.js";

/**
 * 랜덤박스(가챠) 뽑기 순수 로직 — 마스터데이터 캐시를 참조하지 않는다(cardDrop.ts와 동일
 * 원칙 — 캐시 조회 후 여기 함수들을 조합하는 것은 서비스 계층 몫). GAME_DESIGN.md 7-1절 참고.
 * @author trisakion
 */

/**
 * 등급비율 상자에서 등급 하나를 뽑는다 — rate를 weight 자리에 대입해
 * `cardDrop.ts`의 `pickWeightedCardTemplate`을 그대로 재사용한다(룰렛 로직 중복 없음).
 * @param table 빈 배열이 아니어야 함 — 호출부가 boxId 유효성을 확인한 뒤에만 호출
 * @returns 뽑힌 등급 코드
 * @author trisakion
 */
export function pickGrade(table: RandomBoxGradeRate[]): string {
  return pickWeightedCardTemplate(table.map(row => ({ templateId: row.grade, weight: row.rate })));
}

/**
 * 커스텀 상자에서 카드 원형 하나를 가중치 기반으로 뽑는다.
 * @param pool 빈 배열이 아니어야 함
 * @returns 뽑힌 카드 원형 ID
 * @author trisakion
 */
export function pickCustomBoxTemplate(pool: RandomBoxCustomPool[]): string {
  return pickWeightedCardTemplate(pool.map(row => ({ templateId: row.templateId, weight: row.weight })));
}

/**
 * 등급비율 상자에서 등급이 확정된 뒤, 그 등급에 속한 카드 원형 중 균등 랜덤으로 하나 고른다.
 * 등급에 속한 카드 원형이 하나도 없으면(운영 실수로 그 등급 카드가 아직 없는 경우) 재추첨이나
 * 다른 등급으로의 폴백 없이 에러로 실패시킨다(GAME_DESIGN.md 7-1절 확정 사항).
 * @param templateIds 뽑힌 등급에 속한 카드 원형 ID 목록
 * @returns 뽑힌 카드 원형 ID
 * @author trisakion
 */
export function pickUniformCardTemplate(templateIds: string[]): string {
  if (templateIds.length === 0)
    throw new Error("해당 등급에 속한 카드 원형이 없습니다");
  return templateIds[Math.floor(Math.random() * templateIds.length)];
}
