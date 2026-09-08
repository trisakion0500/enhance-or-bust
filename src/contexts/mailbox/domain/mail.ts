/**
 * 발송 후 만료까지 걸리는 기본 시간(ms, GAME_DESIGN.md 7절 — 7일). 컨텐츠별 만료 시간은
 * `mailContent.ts`의 `MAIL_CONTENTS` 레지스트리로 관리하며, 이 값은 레지스트리를 쓰지
 * 않는 호출(테스트 등)의 기본값으로만 쓰인다. 일→ms 환산까지 여기서 끝내둬서 호출부는
 * `Date`에 그대로 더하기만 하면 된다.
 */
export const MAIL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 우편에 첨부되는 보상. 모든 필드가 선택적이며, 값이 있는 필드만 수령 시 지급된다.
 * @author trisakion
 */
export interface MailAttachments {
  /** 지급할 골드 */
  gold?: number;
  /** 지급할 강화석 */
  enhancementStone?: number;
  /** 지급할 다이아 */
  diamond?: number;
  /** 지급할 카드 원형 ID 목록 — 항목마다 새 카드 인스턴스(레벨 1, EXP 0, 강화 0단계)를 생성해 지급 */
  cardTemplateIds?: string[];
}

/**
 * 우편 한 건(`mailbox` 컬렉션). SendMail(발송)과 ClaimMail(수령)의 대상 — 발송/수령 정책은
 * CLAUDE.md "MongoDB 데이터 모델링 / 원자성 전략"의 mailbox 컬렉션 절 참고.
 * @author trisakion
 */
export class Mail {
  /**
   * @param mailId 우편 고유 ID
   * @param playerId 수신자 플레이어 ID
   * @param title 우편 제목
   * @param attachments 첨부 보상
   * @param sourceType 발송 트리거 종류(예: "stage_clear") — sourceId와 조합해 중복 발송 차단에 쓰인다
   * @param sourceId 발송 트리거 인스턴스 식별자(예: "{playerId}:{stageId}:{clearedAt}") — (sourceType, sourceId) 조합에 유니크 인덱스가 걸린다
   * @param createdAt 발송 시각
   * @param expiresAt 만료 시각(발송 시각 + 컨텐츠별 만료 시간) — 이후로는 목록/수령 모두 차단
   * @param claimedAt 수령 시각, 아직 수령 전이면 null
   */
  constructor(
    public readonly mailId: string,
    public readonly playerId: string,
    public readonly title: string,
    public readonly attachments: MailAttachments,
    public readonly sourceType: string,
    public readonly sourceId: string,
    public readonly createdAt: Date,
    public readonly expiresAt: Date,
    public claimedAt: Date | null = null,
  ) {}
}
