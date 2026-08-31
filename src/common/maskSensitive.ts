/**
 * 값을 `***`로 가려야 하는 키 목록(대소문자 무시). 아직 인증/재화 등 도메인 코드가 없어 비어 있다 —
 * 실제 민감 필드(예: password, access_token)가 생기는 도메인 작업 시 여기에 채운다.
 * @author trisakion
 */
const SENSITIVE_KEYS: string[] = [];

/**
 * 객체/배열을 재귀적으로 순회하며 {@link SENSITIVE_KEYS}에 해당하는 키의 값을 `***`로 치환한다.
 * @param value 마스킹할 값
 * @returns 민감 필드가 가려진 새 값(원본은 변경하지 않음)
 * @author trisakion
 */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(maskSensitive);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) =>
        SENSITIVE_KEYS.some(k => k.toLowerCase() === key.toLowerCase()) ? [key, "***"] : [key, maskSensitive(v)],
      ),
    );
  }

  return value;
}
