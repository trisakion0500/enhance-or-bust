import { BATTLE_STAGE_ERROR_MAP } from "./errorMapBattleStage.js";
import { COMMON_ERROR_MAP } from "./errorMapCommon.js";
import { ECONOMY_ERROR_MAP } from "./errorMapEconomy.js";
import { ENHANCEMENT_ERROR_MAP } from "./errorMapEnhancement.js";
import { INVENTORY_ERROR_MAP } from "./errorMapInventory.js";
import { MAILBOX_ERROR_MAP } from "./errorMapMailbox.js";
import { PROGRESSION_ERROR_MAP } from "./errorMapProgression.js";
import { SYNTHESIS_ERROR_MAP } from "./errorMapSynthesis.js";

/**
 * 전체 도메인 error-map을 도메인 이름으로 묶어 노출하는 진입점.
 * 새 바운디드 컨텍스트가 생기면 그 컨텍스트 폴더의 error-map(예: `errorMapInventory.ts`)을 여기 추가한다.
 * @author trisakion
 */
export const ERROR_MAP = {
  COMMON: COMMON_ERROR_MAP,
  INVENTORY: INVENTORY_ERROR_MAP,
  ENHANCEMENT: ENHANCEMENT_ERROR_MAP,
  SYNTHESIS: SYNTHESIS_ERROR_MAP,
  PROGRESSION: PROGRESSION_ERROR_MAP,
  ECONOMY: ECONOMY_ERROR_MAP,
  MAILBOX: MAILBOX_ERROR_MAP,
  BATTLE_STAGE: BATTLE_STAGE_ERROR_MAP,
};
