import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from '../api/fixture.js';

interface PaidOpView {
  readonly responses: Record<string, { readonly description?: string; readonly headers?: Record<string, unknown> }>;
  readonly 'x-payment-info'?: {
    readonly price: unknown;
    readonly protocols: readonly unknown[];
  };
}

interface DocView {
  readonly paths: Record<string, Record<string, PaidOpView | undefined>>;
}

const PAID_OPS = ['/v1/x402/capture', '/v1/x402/extract', '/v1/x402/watches/topup'] as const;

describe('MPP protocol advertisement in the OpenAPI catalog', () => {
  it('lists BOTH {x402:{}} and an mpp entry in x-payment-info.protocols on all 3 paid ops (x402 first)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      const doc = res.json() as DocView;
      for (const path of PAID_OPS) {
        const protocols = doc.paths[path]?.post?.['x-payment-info']?.protocols;
        expect(protocols, `POST ${path} must advertise both protocols`).toEqual([
          { x402: {} },
          { mpp: { method: 'evm' } },
        ]);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('documents the WWW-Authenticate response header on every paid-op 402', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      const doc = res.json() as DocView;
      for (const path of PAID_OPS) {
        const challenge = doc.paths[path]?.post?.responses['402'];
        expect(challenge, `POST ${path} must document a 402 response`).toBeDefined();
        expect(
          challenge?.headers?.['WWW-Authenticate'],
          `POST ${path} 402 must document the WWW-Authenticate header`,
        ).toBeDefined();
        expect(
          challenge?.headers?.['PAYMENT-REQUIRED'],
          `POST ${path} 402 must keep documenting the PAYMENT-REQUIRED header`,
        ).toBeDefined();
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});
