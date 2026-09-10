import { apiPost, escapeHtml } from "./api.js";

/**
 * 합성 탭 — 등급 승급 합성(동일 등급 카드 N장)과 강화 재료 합성(대상 카드 1장 + 동일 원형 재료
 * 카드 N장) 두 폼을 렌더한다. 규칙(소재 장수/성공률/골드)은 `state.player.synthesisRules`(마스터
 * 데이터, `GET /player/me`가 함께 내려줌)에서 읽어 체크박스 단계에서부터 클라이언트가 선반영한다
 * — 등급/원형 불일치나 장수 초과 체크는 그 자리에서 되돌리고, 선택할 때마다 "몇 장 더 필요한지"
 * 힌트를 갱신한다. 최종 검증은 서버가 다시 하므로(서버 권위 원칙) 이 클라이언트 로직은 UX
 * 보조일 뿐이다.
 * @param {{player: {inventory: Array<Record<string, unknown>>, synthesisRules: Array<Record<string, unknown>>}}} state 공유 앱 상태
 * @param {() => Promise<void>} refreshPlayer 시도 후 헤더/인벤토리/전투/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderSynthesis(state, refreshPlayer) {
  const panel = document.getElementById("synthesisPanel");
  const cards = state.player.inventory;
  const rules = state.player.synthesisRules;

  if (cards.length === 0) {
    panel.textContent = "보유한 카드가 없습니다.";
    return;
  }

  const gradeUpgradeRules = rules.filter(r => r.type === "gradeUpgrade");
  const enhanceMaterialRule = rules.find(r => r.type === "enhanceMaterial");

  const cardLabel = c => `${escapeHtml(c.templateId)}(${escapeHtml(c.grade)}) +${c.enhancementLevel}`;
  const checkboxList = (name, list) =>
    list
      .map(
        c =>
          `<label><input type="checkbox" name="${name}" value="${escapeHtml(c.cardId)}" data-grade="${escapeHtml(c.grade)}" data-template-id="${escapeHtml(c.templateId)}"> ${cardLabel(c)}</label>`,
      )
      .join("<br>");

  panel.innerHTML = `
    <fieldset>
      <legend>등급 승급 합성</legend>
      ${checkboxList("upgradeMaterial", cards)}
      <p id="upgradeHint"></p>
      <button type="button" id="upgradeButton">합성 시도</button>
      <p id="upgradeMessage"></p>
    </fieldset>
    <fieldset>
      <legend>강화 재료 합성</legend>
      <label>대상 카드 <select id="targetSelect">${cards.map(c => `<option value="${escapeHtml(c.cardId)}" data-template-id="${escapeHtml(c.templateId)}">${cardLabel(c)}</option>`).join("")}</select></label><br>
      ${checkboxList("enhanceMaterial", cards)}
      <p id="enhanceMaterialHint"></p>
      <button type="button" id="enhanceMaterialButton">합성 시도</button>
      <p id="enhanceMaterialMessage"></p>
    </fieldset>
  `;

  initGradeUpgradeForm(panel, gradeUpgradeRules);
  initEnhanceMaterialForm(panel, enhanceMaterialRule);

  document.getElementById("upgradeButton").addEventListener("click", async () => {
    const materialCardIds = Array.from(panel.querySelectorAll('input[name="upgradeMaterial"]:checked')).map(el => el.value);
    try {
      const result = await apiPost("/synthesis/grade-upgrade", { materialCardIds });
      await refreshPlayer();
      // refreshPlayer()가 이 패널을 통째로 다시 그리므로, 메시지는 재렌더 이후 새로 잡은 엘리먼트에 채운다.
      document.getElementById("upgradeMessage").textContent = result.success
        ? `성공! 새 카드: ${result.resultTemplateId}`
        : "실패. 소재 1장 소모됨";
    } catch (err) {
      document.getElementById("upgradeMessage").textContent = `오류: ${err.message}`;
    }
  });

  document.getElementById("enhanceMaterialButton").addEventListener("click", async () => {
    const targetCardId = document.getElementById("targetSelect").value;
    const materialCardIds = Array.from(panel.querySelectorAll('input[name="enhanceMaterial"]:checked')).map(el => el.value);
    try {
      const result = await apiPost("/synthesis/enhance-material", { targetCardId, materialCardIds });
      await refreshPlayer();
      document.getElementById("enhanceMaterialMessage").textContent = `성공! 현재 +${result.enhancementLevel}`;
    } catch (err) {
      document.getElementById("enhanceMaterialMessage").textContent = `오류: ${err.message}`;
    }
  });
}

/**
 * 등급 승급 폼 — 첫 체크로 등급이 고정되고, 이후 다른 등급이거나 그 등급 규칙의 소재 장수를
 * 넘는 체크는 되돌린다. 체크할 때마다 "몇 장 더 필요한지" 힌트를 갱신한다.
 * @param {HTMLElement} panel 합성 패널 루트
 * @param {Array<Record<string, unknown>>} gradeUpgradeRules 등급 승급 규칙 목록(마스터 데이터)
 */
function initGradeUpgradeForm(panel, gradeUpgradeRules) {
  const checkboxes = Array.from(panel.querySelectorAll('input[name="upgradeMaterial"]'));
  const hint = document.getElementById("upgradeHint");
  const button = document.getElementById("upgradeButton");

  function updateHint() {
    const checked = checkboxes.filter(cb => cb.checked);
    if (checked.length === 0) {
      hint.textContent = "합성할 카드 등급을 선택하세요(골드 소모 없음).";
      button.hidden = true;
      return;
    }
    const grade = checked[0].dataset.grade;
    const rule = gradeUpgradeRules.find(r => r.sourceGrade === grade);
    if (!rule) {
      hint.textContent = `${grade} 등급은 더 이상 승급할 수 없습니다.`;
      button.hidden = true;
      return;
    }
    const remaining = rule.materialCount - checked.length;
    button.hidden = remaining > 0;
    hint.textContent =
      remaining > 0
        ? `${grade} 등급 카드를 ${remaining}장 더 선택하면 합성 가능합니다. (성공률 ${Math.round(rule.successRate * 100)}%, 골드 소모 없음)`
        : `합성 가능! ${grade}→${rule.resultGrade}, 성공률 ${Math.round(rule.successRate * 100)}%`;
  }

  checkboxes.forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        const grade = checkbox.dataset.grade;
        const rule = gradeUpgradeRules.find(r => r.sourceGrade === grade);
        const checked = checkboxes.filter(cb => cb.checked);
        const gradeMismatch = checked.some(cb => cb.dataset.grade !== grade);
        if (!rule || gradeMismatch || checked.length > rule.materialCount)
          checkbox.checked = false; // 승급 불가 등급이거나 등급 불일치/장수 초과 — 체크를 되돌린다
      }
      updateHint();
    });
  });
  updateHint();
}

/**
 * 강화 재료 폼 — 대상 카드 선택에 따라 원형이 다르거나 대상 자신인 체크박스는 비활성화하고,
 * 규칙의 소재 장수를 넘는 체크는 되돌린다. 대상을 바꾸면 더 이상 맞지 않는 체크는 해제한다.
 * @param {HTMLElement} panel 합성 패널 루트
 * @param {Record<string, unknown> | undefined} rule 강화 재료 합성 규칙(마스터 데이터)
 */
function initEnhanceMaterialForm(panel, rule) {
  const targetSelect = document.getElementById("targetSelect");
  const checkboxes = Array.from(panel.querySelectorAll('input[name="enhanceMaterial"]'));
  const hint = document.getElementById("enhanceMaterialHint");
  const button = document.getElementById("enhanceMaterialButton");

  function syncAvailability() {
    const targetCardId = targetSelect.value;
    const targetTemplateId = targetSelect.selectedOptions[0]?.dataset.templateId;
    checkboxes.forEach(cb => {
      const eligible = cb.dataset.templateId === targetTemplateId && cb.value !== targetCardId;
      cb.disabled = !eligible;
      if (!eligible) cb.checked = false; // 대상이 바뀌어 더 이상 맞지 않는 소재 체크는 해제
    });
  }

  function updateHint() {
    if (!rule) {
      hint.textContent = "";
      button.hidden = true;
      return;
    }
    const remaining = rule.materialCount - checkboxes.filter(cb => cb.checked).length;
    button.hidden = remaining > 0;
    hint.textContent =
      remaining > 0
        ? `동일 원형 카드를 ${remaining}장 더 선택하면 강화됩니다. (골드 ${rule.goldCost} 소모)`
        : `합성 가능! 골드 ${rule.goldCost} 소모`;
  }

  checkboxes.forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      const checkedCount = checkboxes.filter(cb => cb.checked).length;
      if (checkbox.checked && rule && checkedCount > rule.materialCount)
        checkbox.checked = false; // 소재 장수 초과 시도 — 체크를 되돌린다
      updateHint();
    });
  });

  targetSelect.addEventListener("change", () => {
    syncAvailability();
    updateHint();
  });
  syncAvailability();
  updateHint();
}
