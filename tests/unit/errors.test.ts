import { describe, expect, it } from 'vitest';
import {
  HttpError,
  badRequest,
  unauthorized,
  paymentRequired,
  unprocessable,
  toResponse,
} from '../../src/util/errors.js';

describe('util/errors', () => {
  it('badRequest/unauthorized/unprocessable carry the right status and code', () => {
    const e = badRequest('nope');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('bad_request');
    expect(e.message).toBe('nope');
    expect(unauthorized('no key').status).toBe(401);
    expect(unprocessable('weird').status).toBe(422);
  });

  it('paymentRequired is 402 and carries a detail payload', () => {
    const e = paymentRequired('out of credits', { invoice: 'inv_1', amount: 500_000 });
    expect(e.status).toBe(402);
    expect(e.code).toBe('payment_required');
    expect(e.detail).toEqual({ invoice: 'inv_1', amount: 500_000 });
  });

  it('toResponse maps an HttpError to {status, body:{error:{code,message,detail}}}', () => {
    const res = toResponse(paymentRequired('out of credits', { invoice: 'inv_1' }));
    expect(res).toEqual({
      status: 402,
      body: { error: { code: 'payment_required', message: 'out of credits', detail: { invoice: 'inv_1' } } },
    });
  });

  it('toResponse omits detail when absent', () => {
    const res = toResponse(badRequest('nope'));
    expect(res).toEqual({ status: 400, body: { error: { code: 'bad_request', message: 'nope' } } });
  });

  it('toResponse falls back to a 500 for unknown errors', () => {
    const res = toResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'internal' } });
  });
});
