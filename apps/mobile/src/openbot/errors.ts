/**
 * OpenBot integration error model. Codes follow the semantics the gate and
 * later tickets (I03/I04/I05) branch on:
 * - authentication_required: 401, session gone, go back to sign-in;
 * - refused: 403, policy denial;
 * - not_found: 404, foreign Bot ID refusal;
 * - outcome_unknown: a write that failed with 408/5xx may already have landed;
 * - unavailable: server-side failure on a read;
 * - invalid_response: body does not match the contract (version drift);
 * - invalid_input: caller bug (bad path or missing ID);
 * - network: transport failure (unreachable, interrupted);
 * - unknown: anything unclassified.
 */
export type OpenBotErrorCode =
  | "authentication_required"
  | "refused"
  | "not_found"
  | "outcome_unknown"
  | "unavailable"
  | "invalid_response"
  | "invalid_input"
  | "network"
  | "unknown";

export class OpenBotError extends Error {
  constructor(
    readonly code: OpenBotErrorCode,
    message: string,
    readonly status?: number,
    readonly rule?: string,
  ) {
    super(message);
    this.name = "OpenBotError";
  }
}

/** Auth failure is the one code that sends the user back to the sign-in form. */
export function isAuthFailure(error: unknown): error is OpenBotError {
  return error instanceof OpenBotError && error.code === "authentication_required";
}
