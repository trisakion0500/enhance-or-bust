import { apiDelete, apiGet, apiPost, escapeHtml } from "./api.js";

/**
 * 우편함 탭 — `GET /mailbox` 목록을 렌더하고, 각 미수령 우편에 수령 버튼을 붙인다. 수령 성공 시
 * `refreshPlayer()`가 헤더/인벤토리/우편함 전체를 다시 받아오므로 이 패널도 자동으로 최신
 * 상태(claimedAt)로 갱신된다 — 실패(예: 인벤토리 상한 초과 7004)만 이 패널에 직접 메시지를 남긴다.
 * @param {unknown} _state 다른 탭 렌더 함수와 시그니처를 맞추기 위한 자리(우편 목록은 자체 fetch)
 * @param {() => Promise<void>} refreshPlayer 수령 후 헤더/인벤토리/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export async function renderMailbox(_state, refreshPlayer) {
  const panel = document.getElementById("mailboxPanel");
  const { mails } = await apiGet("/mailbox");

  if (mails.length === 0) {
    panel.textContent = "받은 우편이 없습니다.";
    return;
  }

  panel.innerHTML = mails
    .map(
      mail => `
    <div class="mail">
      <p>${escapeHtml(mail.title)} — ${mail.claimedAt ? "수령 완료" : "미수령"}</p>
      <p>${escapeHtml(JSON.stringify(mail.attachments))}</p>
      ${mail.claimedAt ? `<button type="button" class="deleteButton" data-mail-id="${escapeHtml(mail.mailId)}">삭제</button>` : `<button type="button" class="claimButton" data-mail-id="${escapeHtml(mail.mailId)}">수령</button>`}
      <p class="claimMessage"></p>
    </div>
  `,
    )
    .join("");

  panel.querySelectorAll(".claimButton").forEach(button => {
    button.addEventListener("click", async () => {
      const mailId = button.dataset.mailId;
      try {
        await apiPost(`/mailbox/${mailId}/claim`, undefined);
        await refreshPlayer();
      } catch (err) {
        button.closest(".mail").querySelector(".claimMessage").textContent = `오류: ${err.message}`;
      }
    });
  });

  panel.querySelectorAll(".deleteButton").forEach(button => {
    button.addEventListener("click", async () => {
      const mailId = button.dataset.mailId;
      try {
        await apiDelete(`/mailbox/${mailId}`);
        await refreshPlayer();
      } catch (err) {
        button.closest(".mail").querySelector(".claimMessage").textContent = `오류: ${err.message}`;
      }
    });
  });
}
