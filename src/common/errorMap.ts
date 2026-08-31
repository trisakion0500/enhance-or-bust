import { COMMON_ERROR_MAP } from "./errorMapCommon.js";

/**
 * 전체 도메인 error-map을 도메인 이름으로 묶어 노출하는 진입점.
 * 새 바운디드 컨텍스트가 생기면 그 컨텍스트 폴더의 error-map(예: `errorMapInventory.ts`)을 여기 추가한다.
 * @author trisakion
 */
export const ERROR_MAP = {
  COMMON: COMMON_ERROR_MAP,
};
