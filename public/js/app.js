import { apiGet, apiPost } from "./api.js";
import { renderInventory } from "./inventory.js";
import { renderEnhancement } from "./enhancement.js";
import { renderSynthesis } from "./synthesis.js";
import { renderBattle } from "./battle.js";
import { renderMailbox } from "./mailbox.js";

/** 앱 전역 공유 상태 — 각 탭 렌더 함수가 이 하나를 읽는다. */
const state = { player: null };

/** @param {boolean} loggedIn true면 게임 화면을, false면 로그인 화면을 보여준다 */
function showScreen(loggedIn) {
  document.getElementById("loginScreen").hidden = loggedIn;
  document.getElementById("gameScreen").hidden = !loggedIn;
}

/** `state.player`의 재화/닉네임/clearedStage를 헤더 DOM에 반영한다. */
function renderHeader() {
  const { name, economy, clearedStage } = state.player;
  document.getElementById("playerName").textContent = name;
  document.getElementById("gold").textContent = economy.gold;
  document.getElementById("enhancementStone").textContent = economy.enhancementStone;
  document.getElementById("diamond").textContent = economy.diamond;
  document.getElementById("clearedStage").textContent = clearedStage;
}

/**
 * `GET /player/me`로 최신 플레이어 상태를 받아와 헤더/인벤토리/전투/우편함 패널을 전부 다시
 * 그린다. 전투 도전, 우편 수령 등 상태를 바꾸는 액션 뒤에는 이 함수 하나만 부르면 화면 전체가
 * 일관되게 최신화된다(각 탭이 따로 자기 상태를 들고 있지 않음).
 */
async function refreshPlayer() {
  state.player = await apiGet("/player/me");
  renderHeader();
  renderInventory(state);
  renderEnhancement(state, refreshPlayer);
  renderSynthesis(state, refreshPlayer);
  renderBattle(state, refreshPlayer);
  await renderMailbox(state, refreshPlayer);
}

/** 로그아웃 버튼 클릭 시 서버 세션을 지우고 로그인 화면으로 되돌아간다. */
async function onLogout() {
  await apiPost("/auth/logout");
  location.reload();
}

/** 탭 버튼 클릭 시 해당 `.tabPanel`만 보이도록 토글하는 리스너를 등록한다. */
function initTabs() {
  document.querySelectorAll(".tabButton").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tabPanel").forEach(panel => { panel.hidden = true; });
      document.getElementById(`${button.dataset.tab}Panel`).hidden = false;
    });
  });
}

/**
 * Google Identity Services 콜백 — 프론트가 받은 ID 토큰(credential)을 서버로 보내 로그인/가입한다.
 * @param {{credential: string}} response GIS가 넘겨주는 콜백 인자(ID 토큰 포함)
 */
async function onGoogleLogin(response) {
  const res = await fetch("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential: response.credential }),
  });
  if (res.ok) await enterGame();
  else document.getElementById("loginResult").textContent = `${res.status} ${JSON.stringify(await res.json())}`;
}

/** `GOOGLE_AUTH_FLOW` 설정에 따라 GIS 버튼 또는 Authorization Code Flow 링크를 로그인 화면에 렌더한다. */
async function initLogin() {
  const { googleClientId, authFlow } = await (await fetch("/auth/config")).json();
  if (authFlow === "authorization_code") {
    const link = document.createElement("a");
    link.href = "/auth/google/login";
    link.textContent = "구글로 로그인";
    document.getElementById("buttonDiv").appendChild(link);
    return;
  }
  window.google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleLogin });
  window.google.accounts.id.renderButton(document.getElementById("buttonDiv"), { theme: "outline", size: "large" });
}

/** 로그인 성공 직후 플레이어 상태를 받아와 게임 화면으로 전환한다. */
async function enterGame() {
  await refreshPlayer();
  showScreen(true);
  document.getElementById("logoutButton").addEventListener("click", onLogout);
}

/** 페이지 진입점 — 로그인 여부를 확인해 게임 화면 또는 로그인 화면으로 분기한다. */
async function init() {
  initTabs();
  try {
    // 로그인 여부 확인을 별도 엔드포인트로 두지 않고 GET /player/me 성공 여부로 겸한다 —
    // 어차피 게임 화면 진입 즉시 이 데이터가 필요하므로 호출을 하나로 합친다.
    await enterGame();
  } catch {
    showScreen(false);
    await initLogin();
  }
}

// GIS 스크립트(비동기 로드)가 끝난 뒤에 initLogin()이 google.accounts를 참조해야 하므로
// DOMContentLoaded가 아니라 모든 리소스 로드를 기다리는 window.onload를 쓴다.
window.onload = init;
