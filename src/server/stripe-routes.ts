/**
 * Stripe integration routes: checkout session creation and webhook handling.
 * Enables fiat (card) payments for credit packs, complementing the x402 crypto flow.
 *
 * Requires:
 * - STRIPE_SECRET_KEY in .env
 * - STRIPE_WEBHOOK_SECRET in .env
 * - stripe npm package installed
 */
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { makeCreditsRepo } from '../db/credits.js';
import { makeAccountsRepo } from '../db/accounts.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { PACKS, type PackName } from '../config/pricing.js';
import type { AppDeps } from './server.js';

// Credit pack definitions — must match config/pricing.ts PACKS exactly.
// Users see these on the Stripe Checkout page.
const CREDIT_PACKS: readonly { id: PackName; credits: number; priceUsd: number; name: string }[] = [
  { id: 'starter', credits: PACKS.starter.credits, priceUsd: PACKS.starter.usd, name: 'Starter Pack' },
  { id: 'pro', credits: PACKS.pro.credits, priceUsd: PACKS.pro.usd, name: 'Pro Pack' },
  { id: 'max', credits: PACKS.max.credits, priceUsd: PACKS.max.usd, name: 'Max Pack' },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function registerStripeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const stripeSecretKey = config.stripeSecretKey;
  const webhookSecret = config.stripeWebhookSecret;

  // If no Stripe key configured, skip registration
  if (!stripeSecretKey) return;

  const stripe = new Stripe(stripeSecretKey);
  const credits = makeCreditsRepo(db);
  const accounts = makeAccountsRepo(db);

  /**
   * POST /v1/stripe/checkout — Create a Stripe Checkout Session for a credit pack.
   * Body: { pack: 'starter' | 'pro' | 'team', address?: string }
   * Returns: { checkoutUrl: string }
   */
  app.post('/v1/stripe/checkout', async (req) => {
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');

    const packId = typeof body.pack === 'string' ? body.pack : undefined;
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) throw unprocessable(`pack must be one of: ${CREDIT_PACKS.map((p) => p.id).join(', ')}`);

    const address = typeof body.address === 'string' ? body.address : undefined;

    // Create or find account for this address (or generate a temporary one)
    let accountId: number;
    if (address) {
      accountId = accounts.findByAddress(address) ?? accounts.create(address);
    } else {
      // Create a temporary account for anonymous purchases
      accountId = accounts.create(`stripe_${Date.now()}`);
    }

    const baseUrl = config.publicBaseUrl;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `webcap ${pack.name}`,
              description: `${pack.credits} API credits for webcap capture/extract endpoints`,
            },
            unit_amount: pack.priceUsd * 100, // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${baseUrl}/v1/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`,
      metadata: {
        account_id: String(accountId),
        pack_id: pack.id,
        credits: String(pack.credits),
      },
    });

    return { checkoutUrl: session.url };
  });

  /**
   * GET /v1/stripe/success — Post-checkout success page.
   */
  app.get('/v1/stripe/success', async (req, reply) => {
    const sessionId = typeof req.query === 'object' && req.query !== null
      ? (req.query as Record<string, string>).session_id
      : undefined;

    return reply.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment Successful - webcap</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f6f8fc; color: #1a1f2e; }
    .card { background: white; border-radius: 14px; padding: 48px; text-align: center; box-shadow: 0 16px 48px rgba(0,0,0,.06); max-width: 400px; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { color: #5a6478; margin: 0 0 24px; }
    .check { font-size: 48px; margin-bottom: 16px; }
    a { color: #d97706; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">\u2705</div>
    <h1>Payment Successful</h1>
    <p>Your credits have been added to your account. You can now use the API endpoints.</p>
    <a href="/">Back to webcap</a>
  </div>
</body>
</html>`);
  });

  /**
   * POST /v1/stripe/webhook — Handle Stripe webhook events.
   * Verifies signature and grants credits on successful payment.
   *
   * Note: Stripe webhook verification requires the raw request body.
   * We use a custom content type parser to preserve it.
   */
  if (webhookSecret) {
    // Preserve raw body for Stripe signature verification.
    // Overrides the default JSON parser for ALL routes — but still passes
    // parsed JSON via done(), so other routes are unaffected. The only side
    // effect is _rawBody on the request, which is harmless.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      try {
        const buf = body as Buffer;
        const json = JSON.parse(buf.toString('utf8'));
        done(null, json);
        // Store raw body for Stripe webhook verification
        (req as unknown as { _rawBody?: string })._rawBody = buf.toString('utf8');
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    app.post('/v1/stripe/webhook', async (req) => {
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') {
        throw new HttpError(400, 'missing_signature', 'Missing stripe-signature header');
      }

      const rawBody = (req as unknown as { _rawBody?: string })._rawBody;
      if (!rawBody) {
        throw new HttpError(400, 'missing_body', 'Missing request body for webhook verification');
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          sig,
          webhookSecret,
        );
      } catch (err) {
        throw new HttpError(400, 'invalid_signature', `Webhook signature verification failed: ${err}`);
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = Number(session.metadata?.account_id);
        const packId = session.metadata?.pack_id;
        const creditsAmount = Number(session.metadata?.credits);

        if (accountId && creditsAmount) {
          const pack = CREDIT_PACKS.find((p) => p.id === packId);
          credits.grantCredits(accountId, creditsAmount, `stripe_${packId ?? 'unknown'}_purchase`);

          // Log for revenue tracking
          try {
            db.prepare(
              'INSERT INTO tracking_events (event, meta_json, referrer, user_agent, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(
              'stripe_payment',
              JSON.stringify({ account_id: accountId, pack_id: packId, credits: creditsAmount, session_id: session.id }),
              null,
              'stripe-webhook',
              null,
              new Date().toISOString(),
            );
          } catch {
            // Non-fatal
          }
        }
      }

      return { received: true };
    });
  }
}
