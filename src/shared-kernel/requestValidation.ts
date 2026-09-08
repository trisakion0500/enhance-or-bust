/**
 * 배열인지, 원소가 전부 non-empty string인지 검증한다. 카드 ID 목록을 받는 여러 라우트
 * (합성, 전투 스쿼드 등)가 공통으로 쓰는 요청 바디 검증.
 * @author trisakion
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === "string" && v.length > 0);
}
