export class AevoSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AevoValueError extends AevoSdkError {
  readonly code:
    | "INVALID_DECIMAL"
    | "NEGATIVE_DECIMAL"
    | "TOO_MANY_DECIMALS"
    | "UNSAFE_NUMBER"
    | "MISSING_CREDENTIALS"
    | "INVALID_ARGUMENT";

  constructor(
    code: AevoValueError["code"],
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

export class AevoApiError extends AevoSdkError {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(params: { status: number; code?: string | undefined; message: string; body: unknown }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.body = params.body;
  }
}
