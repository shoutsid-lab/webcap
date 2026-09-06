import { describe, expect, it } from 'vitest';
import { verifyMessage } from 'ethers';
import { closeApiFixture, makeApiFixture, MERCHANT_ADDRESS } from './fixture.js';

interface XDiscoveryView {
  readonly ownershipProofs: readonly string[];
}

interface OpenapiDocView {
  readonly 'x-discovery'?: XDiscoveryView;
}

interface WellKnownView {
  readonly payTo: string | null;
  readonly ownershipProofs?: readonly string[];
}

describe('x402scan verified-ownership discovery (ownershipProofs)', () => {
  it('serves x-discovery.ownershipProofs on GET /openapi.json that recovers to the payTo address', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      const doc = res.json() as OpenapiDocView;
      const proofs = doc['x-discovery']?.ownershipProofs;
      expect(proofs, 'the OpenAPI document must carry the x-discovery ownershipProofs extension').toBeDefined();
      expect(proofs).toHaveLength(1);
      // EIP-191 personal signature: 0x + 130 hex chars (65-byte r||s||v)
      const proof = proofs?.[0] ?? '';
      expect(proof).toMatch(/^0x[0-9a-fA-F]{130}$/);
      // Cryptographic: the signer of personal_sign(origin) is the payTo address
      // (x402scan recovers it from the signature and matches the resource payTo).
      const origin = new URL(fx.config.publicBaseUrl).origin;
      const recovered = verifyMessage(origin, proof);
      expect(recovered).toBe(fx.config.x402PayTo);
      expect(recovered).toBe(MERCHANT_ADDRESS);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('serves the same ownershipProofs on GET /.well-known/x402, leaving payTo unchanged', async () => {
    const fx = makeApiFixture();
    try {
      const openapiRes = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(openapiRes.statusCode).toBe(200);
      const openapiProofs = (openapiRes.json() as OpenapiDocView)['x-discovery']?.ownershipProofs;

      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/x402' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as WellKnownView;
      expect(body.ownershipProofs, 'the well-known catalog must carry ownershipProofs').toBeDefined();
      expect(body.ownershipProofs).toHaveLength(1);
      // both surfaces emit the identical signature (same key + origin)
      expect(body.ownershipProofs).toEqual(openapiProofs);
      // payTo stays exactly what the route returned before the proof existed:
      // null while x402 is disabled on the deployment (the fixture is a local chain)
      expect(body.payTo).toBe(fx.config.x402Network === undefined ? null : fx.config.x402PayTo);
      expect(body.payTo).toBeNull();
    } finally {
      await closeApiFixture(fx);
    }
  });
});
