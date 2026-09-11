/**
 * 소셜 로그인 Authorization Code Flow 프로바이더 공통 인터페이스 — "동의 화면으로 리다이렉트 →
 * code 콜백 → 토큰/프로필 교환"이 동일한 프로바이더(구글 authorization_code, 페이스북, 향후
 * 네이버 등)만 대상으로 한다. 새 프로바이더를 추가할 때 이 인터페이스를 구현한 객체 하나만
 * 만들어 `authRoutes.ts`의 레지스트리 배열에 등록하면 라우트/authService는 건드릴 필요가
 * 없어진다. 구글 GIS(id_token, POST 방식)는 리다이렉트 기반이 아니라 이 인터페이스 대상이
 * 아니다 — 학습 목적의 특수 케이스로 `authRoutes.ts`에 별도 분기로 남긴다.
 * @author trisakion
 */
export interface SocialAuthProvider {
  /** `Player.platformType`으로 저장되는 식별자이자 라우트 경로 세그먼트(`/auth/:platformType/...`) */
  platformType: string;
  /** 사용자를 이 프로바이더의 로그인 동의 화면으로 보낼 URL을 만든다 */
  generateAuthUrl(state: string): string;
  /** 콜백으로 받은 code를 검증된 공통 프로필로 교환한다 */
  exchangeAuthCode(code: string): Promise<SocialProfile>;
}

/**
 * 검증된 소셜 프로필의 공통 형태. 프로바이더마다 원본 필드명은 달라도(구글 `sub`/페이스북
 * `id` 등) 각 provider 구현체가 이 형태로 변환해 반환한다.
 * @author trisakion
 */
export interface SocialProfile {
  /** 프로바이더 고유 사용자 ID — `Player.platformUserId`로 저장되는 값 */
  sub: string;
  /** 계정 표시 이름 — 최초 가입 시 1회만 가져옴(이후 재동기화 안 함) */
  name?: string;
  /** 계정 이메일 — 표시용, 최초 가입 시 1회만 가져옴 */
  email?: string;
  /** 프로필 사진 URL — 최초 가입 시 1회만 가져옴 */
  picture?: string;
}
