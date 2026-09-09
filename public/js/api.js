/**
 * 서버 API 공용 fetch 래퍼 — 세션 쿠키 포함, JSON 파싱, 비정상 응답은 서버가 내려주는
 * {result, message}(errorHandler.ts) 형태를 그대로 실은 Error로 던진다.
 * @param {string} path 요청 경로
 * @param {RequestInit} [options] fetch 옵션(method/body 등)
 * @returns {Promise<any>} 파싱된 응답 바디
 */
async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message ?? `요청 실패(${res.status})`);
    err.status = res.status;
    err.result = body.result;
    throw err;
  }
  return body;
}

/**
 * @param {string} path 요청 경로
 * @returns {Promise<any>} 파싱된 응답 바디
 * @author trisakion
 */
export function apiGet(path) {
  return request(path);
}

/**
 * @param {string} path 요청 경로
 * @param {unknown} [body] 요청 바디(JSON 직렬화됨, 생략 시 바디 없이 전송)
 * @returns {Promise<any>} 파싱된 응답 바디
 * @author trisakion
 */
export function apiPost(path, body) {
  return request(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}
