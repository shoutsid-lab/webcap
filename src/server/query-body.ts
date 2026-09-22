/**
 * The GET form of a paid route.
 *
 * The x402 middleware challenges both POST and GET on every paid path: the GET
 * challenge is how a probing indexer (they almost all probe with GET) reads the
 * price. But a client that answers a challenge retries the *same* method — so
 * until now a paid GET reached no route and answered 405 method_not_allowed
 * after the payer had already signed. The money was not taken (the middleware
 * cancels settlement on any response >= 400) but the customer dead-ended, which
 * for an automated buyer means the endpoint looks broken and is not retried.
 *
 * So a paid path is served for both methods: POST keeps the documented JSON
 * body, and GET carries the same parameters in the query string. A GET has no
 * body, so the handler's body is built from the query here rather than
 * duplicating eight handlers.
 */
import type { FastifyInstance, FastifyRequest, RouteHandlerMethod } from 'fastify';

/** A value that is entirely a JSON scalar (`100`, `true`, `null`, `-1.5`). */
const JSON_SCALAR = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;

/**
 * Give a query value its JSON type where it is unambiguously JSON, so the POST
 * body shape maps onto the query string directly:
 *
 *   ?url=https://example.com/          -> { url: 'https://example.com/' }  (string)
 *   ?maxUrls=10                        -> { maxUrls: 10 }                  (number)
 *   ?fullPage=true                     -> { fullPage: true }               (boolean)
 *   ?urls=["https://a/","https://b/"]  -> { urls: ['https://a/', ...] }    (JSON array)
 *   ?options={"maxContentWords":800}   -> { options: { ... } }             (JSON object)
 *
 * Anything else is passed through as the raw string, which is the common case
 * (`?url=https://example.com/`). The one sharp edge: a bare numeric parameter
 * is a number, so `?url=123` fails validation rather than being read as a URL —
 * `123` is not a usable URL either way.
 */
export function coerceQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(coerceQueryValue);
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;
  const first = trimmed[0] as string;
  if (first !== '{' && first !== '[' && first !== '"' && !JSON_SCALAR.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** The POST body a GET's query string stands for. */
export function queryToBody(query: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) body[key] = coerceQueryValue(value);
  return body;
}

/**
 * preValidation hook: a GET's query string becomes the body a POST would carry.
 *
 * Async on purpose: Fastify only advances a hook that either calls `done()` or
 * returns a promise, so a bare sync function would stall the request forever.
 */
export async function bodyFromQuery(request: FastifyRequest): Promise<void> {
  (request as unknown as { body?: unknown }).body = queryToBody(request.query as Record<string, unknown>);
}

/**
 * Register a paid route for both methods, sharing one handler.
 *
 * `exposeHeadRoute: false` is load-bearing: Fastify would otherwise mirror the
 * GET into a HEAD route, and HEAD is not in the x402 route table — so a HEAD
 * would skip the challenge and run the handler for free.
 */
export function registerPaidRoute(app: FastifyInstance, path: string, handler: RouteHandlerMethod): void {
  app.post(path, handler);
  app.get(path, { exposeHeadRoute: false, preValidation: bodyFromQuery }, handler);
}
