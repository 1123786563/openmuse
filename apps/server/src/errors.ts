export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 = 400,
    /** The enterprise taxonomy word this refusal answers with, when there is one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  /** Build a refusal from a MobileBffError taxonomy word (T07.05). */
  static fromCode(
    code: string,
    status: 400 | 401 | 403 | 404 | 503,
  ): AppError {
    return new AppError(code, status, code);
  }
}
