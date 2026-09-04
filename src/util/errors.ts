export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export const badRequest = (message: string, detail?: unknown): HttpError =>
  new HttpError(400, 'bad_request', message, detail);

export const unauthorized = (message: string): HttpError =>
  new HttpError(401, 'unauthorized', message);

export const paymentRequired = (message: string, detail?: unknown): HttpError =>
  new HttpError(402, 'payment_required', message, detail);

export const unprocessable = (message: string, detail?: unknown): HttpError =>
  new HttpError(422, 'unprocessable', message, detail);

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: unknown;
  };
}

/** Map any thrown value to a JSON error response (unknown errors -> 500). */
export function toResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof HttpError) {
    const detail = err.detail;
    return {
      status: err.status,
      body: {
        error:
          detail === undefined
            ? { code: err.code, message: err.message }
            : { code: err.code, message: err.message, detail },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'internal', message: 'internal server error' } },
  };
}
