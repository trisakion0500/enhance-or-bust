import type { ErrorEntry } from "./errorEntry.js";

/**
 * 예측 가능한 비즈니스 실패를 나타내는 예외. `ERROR_MAP`에서 뽑은 {@link ErrorEntry}를 그대로 들고 있어서,
 * 에러 핸들러가 별도 코드 조회 없이 `err.entry`에서 바로 message/httpStatus를 꺼낼 수 있다.
 * @author trisakion
 */
export class BusinessException extends Error {
  /**
   * @param entry ERROR_MAP에서 가져온 이 실패의 코드/메시지/HTTP 상태
   * @param diagnostics 서버 로그에만 남길 진단 정보(응답 바디에는 절대 노출하지 않음)
   */
  constructor(
    public readonly entry: ErrorEntry,
    public readonly diagnostics?: unknown,
  ) {
    super(entry.message);
  }
}
