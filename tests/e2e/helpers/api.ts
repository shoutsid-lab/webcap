import type { FastifyInstance } from 'fastify';

/** Parse an injected response body as a flat JSON object (test JSON boundary). */
export function json(res: { json(): unknown }): Record<string, unknown> {
  return res.json() as Record<string, unknown>;
}

export interface RegisteredAccount {
  readonly status: number;
  readonly address: string;
  readonly apiKey: string;
  readonly balance: number;
}

export async function registerAccount(app: FastifyInstance, address: string): Promise<RegisteredAccount> {
  const res = await app.inject({ method: 'POST', url: '/v1/register', payload: { address } });
  const body = res.json() as { address?: unknown; apiKey?: unknown; balance?: unknown };
  if (typeof body.address !== 'string' || typeof body.apiKey !== 'string' || typeof body.balance !== 'number') {
    throw new Error(`unexpected register response: ${res.payload}`);
  }
  return { status: res.statusCode, address: body.address, apiKey: body.apiKey, balance: body.balance };
}
