/**
 * A deployment without Stripe must not advertise a payment rail or a contact
 * address it does not have.
 *
 * `POST /v1/stripe/checkout` used to answer with a hardcoded
 * `hello@webcap.dev` — a domain the live service does not own — while the
 * README advertised card payments unconditionally. An agent reading either
 * would send a customer (or itself) nowhere. These pin the honest behavior:
 * the fallback points at the crypto rail, and any human contact comes from
 * config or is absent.
 */
import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

interface UnconfiguredBody {
  error: string;
  message: string;
  fallback: { crypto: string; email?: string };
}

describe('card rail when Stripe is not configured', () => {
  it('answers stripe_not_configured and points at the crypto rail', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/stripe/checkout' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as UnconfiguredBody;
      expect(body.error).toBe('stripe_not_configured');
      expect(body.fallback.crypto).toContain('/v1/x402/extract');
      expect(body.message).toContain('x402');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('advertises no contact address when the operator has not set one', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/stripe/checkout' });
      const body = res.json() as UnconfiguredBody;
      expect(body.fallback.email).toBeUndefined();
      // No address, and in particular no domain we do not own.
      expect(res.body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(res.body).not.toContain('webcap.dev');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('uses the configured contact when there is one', async () => {
    const fx = makeApiFixture({ contactEmail: 'ops@example.test' });
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/stripe/checkout' });
      const body = res.json() as UnconfiguredBody;
      expect(body.fallback.email).toContain('ops@example.test');
      expect(body.message).toContain('ops@example.test');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('the AI plugin manifest publishes a contact only when configured', async () => {
    const without = makeApiFixture();
    const withContact = makeApiFixture({ contactEmail: 'ops@example.test' });
    try {
      const bare = await without.app.inject({ method: 'GET', url: '/.well-known/ai-plugin.json' });
      expect(bare.statusCode).toBe(200);
      const bareBody = bare.json() as { contact_email?: string };
      expect(bareBody.contact_email).toBeUndefined();
      expect(bare.body).not.toContain('webcap.dev');

      const configured = await withContact.app.inject({ method: 'GET', url: '/.well-known/ai-plugin.json' });
      const configuredBody = configured.json() as { contact_email?: string };
      expect(configuredBody.contact_email).toBe('ops@example.test');
    } finally {
      await closeApiFixture(without);
      await closeApiFixture(withContact);
    }
  });
});
