/**
 * `Cookie` 헤더에서 값 하나만 읽는다. 쿠키 파싱이 필요한 곳이 소수(OAuth state 검증, 세션 인증)라
 * `cookie-parser` 의존성을 추가하는 대신 최소 구현으로 둔다.
 * @param cookieHeader `req.headers.cookie` 원본
 * @param name 찾을 쿠키 이름
 * @returns 쿠키 값, 없으면 undefined
 * @author trisakion
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader
    ?.split("; ")
    .find(pair => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
