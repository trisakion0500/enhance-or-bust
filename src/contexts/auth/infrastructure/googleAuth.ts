import type { TokenPayload } from "google-auth-library";
import { OAuth2Client } from "google-auth-library";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { config } from "../../../config/env.js";
import type { SocialAuthProvider, SocialProfile } from "./socialAuthProvider.js";

// authorization_code 플로우에서만 secret/redirectUri가 쓰인다 — id_token 플로우에선 undefined로 넘어가도 무해하다.
const client = new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);

function toProfile(payload: TokenPayload | undefined): SocialProfile {
  if (!payload?.sub) throw new Error("google id token payload missing sub");
  return { sub: payload.sub, name: payload.name, email: payload.email, picture: payload.picture };
}

/**
 * 구글 ID 토큰(Google Identity Services credential)의 서명·발급자·audience를 검증하고
 * 구글 고유 사용자 ID(`sub`)와 기본 프로필을 추출한다. 클라이언트가 주장하는 값이 아니라
 * 토큰 자체를 서버가 검증하므로 서버 권위 원칙을 지킨다.
 * @param idToken 프론트에서 받은 구글 ID 토큰
 * @returns 검증된 구글 프로필
 * @throws {BusinessException} 서명/audience 검증 실패 시 AUTH.INVALID_GOOGLE_TOKEN
 * @author trisakion
 */
export async function verifyGoogleIdToken(idToken: string): Promise<SocialProfile> {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
    return toProfile(ticket.getPayload());
  } catch (err) {
    throw new BusinessException(ERROR_MAP.AUTH.INVALID_GOOGLE_TOKEN, err);
  }
}

/**
 * Authorization Code Flow의 첫 단계 — 사용자를 구글 로그인 동의 화면으로 보낼 URL을 만든다.
 * @param state CSRF 방지용 임의값. 콜백에서 그대로 돌려받아 원 요청과 같은 브라우저인지 대조한다.
 * @returns 구글 로그인 동의 화면 URL
 * @author trisakion
 */
export function generateGoogleAuthUrl(state: string): string {
  return client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    redirect_uri: config.googleRedirectUri,
    state,
  });
}

/**
 * Authorization Code Flow의 콜백 단계 — 구글이 돌려준 `code`를 구글 토큰 엔드포인트와 교환해
 * (`client_secret` 포함, 라이브러리가 내부에서 처리) ID 토큰을 받고, 서명 검증 후 프로필을 추출한다.
 * @param code 구글 콜백 쿼리로 받은 authorization code
 * @returns 검증된 구글 프로필
 * @throws {BusinessException} 교환/서명 검증 실패 시 AUTH.INVALID_GOOGLE_TOKEN
 * @author trisakion
 */
export async function exchangeGoogleAuthCode(code: string): Promise<SocialProfile> {
  try {
    const { tokens } = await client.getToken({ code, redirect_uri: config.googleRedirectUri });
    if (!tokens.id_token) throw new Error("google token response missing id_token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
    return toProfile(ticket.getPayload());
  } catch (err) {
    throw new BusinessException(ERROR_MAP.AUTH.INVALID_GOOGLE_TOKEN, err);
  }
}

/**
 * 구글 Authorization Code Flow를 `SocialAuthProvider` 인터페이스로 감싼 레지스트리 등록용
 * 객체 — `config.googleAuthFlow`가 `authorization_code`일 때만 `authRoutes.ts`가 이 객체를
 * 레지스트리에 등록한다. GIS(id_token) 플로우는 리다이렉트 기반이 아니라 이 인터페이스로
 * 감쌀 수 없어 별도 분기(`verifyGoogleIdToken()`)로 남는다.
 * @author trisakion
 */
export const googleAuthCodeProvider: SocialAuthProvider = {
  platformType: "google",
  generateAuthUrl: generateGoogleAuthUrl,
  exchangeAuthCode: exchangeGoogleAuthCode,
};
