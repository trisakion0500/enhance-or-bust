import { apiGet, apiPost } from "./api.js";
import { renderInventory } from "./inventory.js";
import { renderEnhancement } from "./enhancement.js";
import { renderSynthesis } from "./synthesis.js";
import { renderBattle } from "./battle.js";
import { renderMailbox } from "./mailbox.js";

/** 앱 전역 공유 상태 — 각 탭 렌더 함수가 이 하나를 읽는다. */
const state = { player: null };

/** @param {"login"|"register"|"game"} mode 보여줄 화면 */
function showScreen(mode) {
  document.getElementById("loginScreen").hidden = mode !== "login";
  document.getElementById("registerScreen").hidden = mode !== "register";
  document.getElementById("gameScreen").hidden = mode !== "game";
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
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    document.getElementById("loginResult").textContent = `${res.status} ${JSON.stringify(body)}`;
    return;
  }
  if (body.pendingRegistration) showRegisterForm(body.defaultName);
  else await enterGame();
}

/**
 * 닉네임 입력 화면을 보여준다 — 입력값은 플랫폼이 제공한 기본 닉네임으로 미리 채워둔다.
 * @param {string} [defaultName] 플랫폼 기본 닉네임(없으면 빈 값)
 */
function showRegisterForm(defaultName) {
  document.getElementById("registerNickname").value = defaultName ?? "";
  document.getElementById("registerResult").textContent = "";
  showScreen("register");
}

/**
 * 닉네임 입력 폼 제출 — `POST /auth/register/complete`로 가입을 완료하고 게임 화면으로 들어간다.
 * @param {SubmitEvent} event
 */
async function onRegisterSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("registerNickname");
  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await apiPost("/auth/register/complete", { name: input.value });
    history.replaceState(null, "", location.pathname);
    await enterGame();
  } catch (err) {
    document.getElementById("registerResult").textContent = err.message;
    button.disabled = false;
  }
}

/** `GOOGLE_AUTH_FLOW` 설정에 따라 GIS 버튼 또는 Authorization Code Flow 링크를, 그리고 페이스북
 * 로그인 링크(토글 없이 항상 Authorization Code Flow 하나)를 로그인 화면에 렌더한다. */
async function initLogin() {
  const { googleClientId, authFlow } = await (await fetch("/auth/config")).json();
  if (authFlow === "authorization_code") {
    const link = document.createElement("a");
    link.href = "/auth/google/login";
    link.textContent = "구글로 로그인";
    document.getElementById("buttonDiv").appendChild(link);
  } else {
    window.google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleLogin });
    window.google.accounts.id.renderButton(document.getElementById("buttonDiv"), { theme: "outline", size: "large" });
  }

  const facebookLink = document.createElement("a");
  facebookLink.href = "/auth/facebook/login";
  facebookLink.className = "facebookLoginButton";
  // 고정 문자열(사용자 입력 없음)이라 XSS 위험 없음 — 페이스북 공식 로고(facebook.com 실제
  // 마크업에서 그대로 가져온 원형+"f" 패스)를 새 이미지 자원 없이 인라인 SVG로 넣는다.
  facebookLink.innerHTML =
    '<svg viewBox="0 0 36 36" aria-hidden="true">' +
    '<path fill="#1877f2" d="M20.181 35.87C29.094 34.791 36 27.202 36 18c0-9.941-8.059-18-18-18S0 8.059 0 18c0 8.442 5.811 15.526 13.652 17.471L14 34h5.5l.681 1.87Z"/>' +
    '<path fill="#fff" d="M13.651 35.471v-11.97H9.936V18h3.715v-2.37c0-6.127 2.772-8.964 8.784-8.964 1.138 0 3.103.223 3.91.446v4.983c-.425-.043-1.167-.065-2.081-.065-2.952 0-4.09 1.116-4.09 4.025V18h5.883l-1.008 5.5h-4.867v12.37a18.183 18.183 0 0 1-6.53-.399Z"/>' +
    "</svg>" +
    '<span class="facebookLabel">FaceBook 계정으로 로그인</span>';
  document.getElementById("buttonDiv").appendChild(facebookLink);
}

/** 로그인 성공 직후 플레이어 상태를 받아와 게임 화면으로 전환한다. */
async function enterGame() {
  await refreshPlayer();
  showScreen("game");
  document.getElementById("logoutButton").addEventListener("click", onLogout);
}

/** 페이지 진입점 — 가입 보류/로그인 여부를 확인해 닉네임 입력/게임/로그인 화면으로 분기한다. */
async function init() {
  initTabs();
  document.getElementById("registerForm").addEventListener("submit", onRegisterSubmit);

  // 신규 가입자는 OAuth 콜백(authRoutes.ts의 handleOAuthCallback)이 세션 대신 가입 보류
  // 쿠키를 발급하고 이 쿼리 파라미터와 함께 여기로 보낸다 — 닉네임을 받아야 로그인이 완료된다.
  if (new URLSearchParams(location.search).get("register")) {
    history.replaceState(null, "", location.pathname);
    try {
      const { defaultName } = await apiGet("/auth/register/pending");
      showRegisterForm(defaultName);
      return;
    } catch {
      // 가입 보류가 만료/무효 — 로그인 화면으로 폴백
    }
  }

  try {
    // 로그인 여부 확인을 별도 엔드포인트로 두지 않고 GET /player/me 성공 여부로 겸한다 —
    // 어차피 게임 화면 진입 즉시 이 데이터가 필요하므로 호출을 하나로 합친다.
    await enterGame();
  } catch {
    showScreen("login");
    await initLogin();
    // OAuth 콜백(구글 Authorization Code Flow/페이스북)이 실패하면 서버가 이 쿼리 파라미터와
    // 함께 로그인 화면으로 리다이렉트한다(authRoutes.ts의 handleOAuthCallback).
    if (new URLSearchParams(location.search).get("loginError")) {
      document.getElementById("loginResult").textContent = "로그인에 실패했습니다. 다시 시도해주세요.";
      history.replaceState(null, "", location.pathname);
    }
  }
}

// GIS 스크립트(비동기 로드)가 끝난 뒤에 initLogin()이 google.accounts를 참조해야 하므로
// DOMContentLoaded가 아니라 모든 리소스 로드를 기다리는 window.onload를 쓴다.
window.onload = init;
