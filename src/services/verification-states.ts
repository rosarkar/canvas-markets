/** Verification state machine — Canvas v0.2 design doc */
export const VerificationState = {
  PENDING: "PENDING",
  DEEP_LINK_SENT: "DEEP_LINK_SENT",
  TASK_SENT: "TASK_SENT",
  RESPONSE_RECEIVED: "RESPONSE_RECEIVED",
  STEP1_FIRED: "STEP1_FIRED",
  STEP1_FAILED: "STEP1_FAILED",
  SCORING: "SCORING",
  KIMI_FAILED: "KIMI_FAILED",
  PASSED: "PASSED",
  /** Scoring passed; user stays muted awaiting a tap on "I agree" to the group rules. */
  RULES_PENDING: "RULES_PENDING",
  /** Rules accepted — user has been unmuted / join request approved. Terminal success state. */
  ADMITTED: "ADMITTED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
  /** Missed the RULES_PENDING window. Unlike TIMED_OUT, the user is left muted, not kicked. */
  RULES_TIMED_OUT: "RULES_TIMED_OUT",
  MUTED: "MUTED",
  /**
   * Join attempt logged but turned away (cooldown / 12h attempt limit). Not a real
   * verification: excluded from the attempt-window check and invisible to sweeps,
   * payout, and active-verification queries (all filter on explicit state lists).
   */
  COOLDOWN_REJECTED: "COOLDOWN_REJECTED",
} as const;

export type VerificationState = (typeof VerificationState)[keyof typeof VerificationState];

/** Bid price locks when TASK_SENT is written. */
export const BID_LOCK_STATES: VerificationState[] = [
  VerificationState.TASK_SENT,
  VerificationState.RESPONSE_RECEIVED,
  VerificationState.STEP1_FIRED,
  VerificationState.STEP1_FAILED,
  VerificationState.SCORING,
  VerificationState.KIMI_FAILED,
];

/** States that trigger 24h cooldown on exit. */
export const COOLDOWN_STATES: VerificationState[] = [
  VerificationState.TIMED_OUT,
  VerificationState.FAILED,
  VerificationState.PASSED,
];
