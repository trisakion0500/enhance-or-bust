/**
 * 인벤토리 탭 — 보유 카드를 텍스트 표로만 렌더한다(GAME_DESIGN.md "최소 UI" 원칙, 이미지 없음).
 * @param {{player: {inventory: Array<Record<string, unknown>>}}} state 공유 앱 상태
 * @author trisakion
 */
export function renderInventory(state) {
  const panel = document.getElementById("inventoryPanel");
  const cards = state.player.inventory;

  if (cards.length === 0) {
    panel.textContent = "보유한 카드가 없습니다.";
    return;
  }

  const rows = cards
    .map(c => `<tr><td>${c.templateId}</td><td>${c.grade}</td><td>${c.baseAttack}</td><td>${c.baseHp}</td><td>${c.element}</td><td>${c.level}</td><td>${c.exp}</td><td>+${c.enhancementLevel}</td></tr>`)
    .join("");

  panel.innerHTML = `
    <table>
      <thead><tr><th>원형</th><th>등급</th><th>공격</th><th>체력</th><th>속성</th><th>레벨</th><th>EXP</th><th>강화</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
