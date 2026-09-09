/**
 * 스테이지별 카드 드랍 테이블 항목 — 카드 원형과 상대 가중치(테이블 내 다른 항목 대비
 * 비율일 뿐 합이 1일 필요는 없음).
 * @author trisakion
 */
export interface CardDropEntry {
  /** 드랍 후보 카드 원형 ID */
  templateId: string;
  /** 상대 가중치 */
  weight: number;
}

/**
 * `master_stage_card_drops` 컬렉션 문서 — 스테이지 하나 × 카드 원형 하나의 드랍 가중치를
 * 나타내는 행 하나. 스테이지 문서 안에 배열로 내장하지 않고 컬렉션을 분리해, 나중에
 * 운영툴에서 엑셀 업로드/행 단위 관리를 하기 쉽게 한다. 자연키는 (stageId, templateId).
 * @author trisakion
 */
export interface CardDropRuleDoc extends CardDropEntry {
  /** 대상 스테이지 번호 */
  stageId: number;
}

/**
 * 가중치 기반으로 드랍 테이블에서 카드 원형 하나를 뽑는다.
 * @param table 빈 배열이 아니어야 함 — 호출부가 드랍 확률 판정을 통과한 뒤에만 호출
 * @returns 뽑힌 카드 원형 ID
 * @author trisakion
 */
export function pickWeightedCardTemplate(table: CardDropEntry[]): string {
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry.templateId;
  }
  return table[table.length - 1].templateId; // 부동소수점 오차로 roll이 끝까지 안 줄어든 경우 대비
}
