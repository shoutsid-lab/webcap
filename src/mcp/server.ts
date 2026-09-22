/**
 * A dependency-free MCP (Model Context Protocol) server core for webcap.
 *
 * The customer is an autonomous agent; the cheapest way for one to actually
 * call webcap is to have it wired as an MCP tool. This module is the pure,
 * transport-free half: the tool table plus JSON-RPC handling. `stdio.ts` is the
 * executable half (newline-delimited JSON-RPC over stdin/stdout).
 *
 * Free tools (preview, OG, service catalog, health, agent funnel) need no
 * wallet. Paid tools (capture/extract/audit/map-lite/video/analyze) go through
 * the injected `McpHttp`; when the host has no payer wired, the unpaid call's
 * 402 challenge is returned as text so the agent/host can pay with its own
 * x402 client. Nothing here talks to the network, so it is unit-testable.
 */
import { isRecord } from '../server/capture-parse.js';

/** Protocol revision we implement. The client may request another; we echo it. */
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'webcap';

export interface McpResponse {
  readonly status: number;
  readonly body: unknown;
}

/** The minimal HTTP seam; `stdio.ts` supplies a real (optionally paying) one. */
export interface McpHttp {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<McpResponse>;
}

export interface McpContext {
  readonly baseUrl: string;
  readonly version: string;
  readonly http: McpHttp;
  /** True when a payer wallet is wired; drives paid-tool guidance text. */
  readonly canPay: boolean;
}

interface ToolRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
}

interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly free: boolean;
  readonly build: (args: Record<string, unknown>) => ToolRequest;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function required(args: Record<string, unknown>, key: string, tool: string): string {
  const v = str(args, key);
  if (v === undefined) throw new Error(`${tool}: "${key}" must be a non-empty string`);
  return v;
}

const URL_PROP = { url: { type: 'string', description: 'Absolute http(s) URL to fetch' } } as const;

/** The tool table: one entry per public capability. */
export const TOOLS: readonly ToolDef[] = [
  {
    name: 'webcap_preview',
    description:
      'Free bounded preview of a page: title, top headings, links, word count and a markdown slice. Use to peek before paying for the full extract. Rate-limited per IP.',
    inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    free: true,
    build: (a) => ({ method: 'GET', path: `/v1/extract/preview?url=${encodeURIComponent(required(a, 'url', 'webcap_preview'))}` }),
  },
  {
    name: 'webcap_og',
    description: 'Free Open Graph metadata for a URL: title, description, image, icon. No payment.',
    inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    free: true,
    build: (a) => ({ method: 'GET', path: `/v1/og?url=${encodeURIComponent(required(a, 'url', 'webcap_og'))}` }),
  },
  {
    name: 'webcap_service',
    description:
      'Free machine catalog: every paid endpoint with its exact price, the network, USDC asset, payTo, facilitator and the how-to-pay flow. Call this first to learn what webcap can do and what it costs.',
    inputSchema: { type: 'object', properties: {} },
    free: true,
    build: () => ({ method: 'GET', path: '/v1/x402/service' }),
  },
  {
    name: 'webcap_health',
    description: 'Free liveness + chain info.',
    inputSchema: { type: 'object', properties: {} },
    free: true,
    build: () => ({ method: 'GET', path: '/v1/health' }),
  },
  {
    name: 'webcap_agent_funnel',
    description:
      'Free agent-income funnel: reach, 402 challenges, trial claims, paid calls, distinct paying wallets and funded watches. Aggregate only; use to see real usage.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'integer', description: 'Window in hours (default 168 = 7 days)' } },
    },
    free: true,
    build: (a) => {
      const hours = typeof a.hours === 'number' && Number.isFinite(a.hours) ? `?hours=${Math.trunc(a.hours)}` : '';
      return { method: 'GET', path: `/v1/agent-funnel${hours}` };
    },
  },
  {
    name: 'webcap_capture',
    description:
      'PAID ($0.001): screenshot a URL as PNG/JPEG/PDF and get a persistent public artifact URL plus free OG metadata. Settles gasless USDC over x402.',
    inputSchema: {
      type: 'object',
      properties: {
        ...URL_PROP,
        format: { type: 'string', enum: ['png', 'jpeg', 'pdf'], description: 'Screenshot format (default png)' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page' },
      },
      required: ['url'],
    },
    free: false,
    build: (a) => ({
      method: 'POST',
      path: '/v1/x402/capture',
      body: {
        url: required(a, 'url', 'webcap_capture'),
        ...(str(a, 'format') !== undefined ? { format: str(a, 'format') } : {}),
        ...(typeof a.fullPage === 'boolean' ? { options: { fullPage: a.fullPage } } : {}),
      },
    }),
  },
  {
    name: 'webcap_extract',
    description:
      'PAID ($0.01, one payment covers a batch of up to 50 URLs): structured content as JSON — title, headings, paragraphs, links, images, markdown — optionally constrained by a natural-language schema.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A single page to extract' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Batch (at most 50) for one payment' },
        schema: { type: 'string', description: 'Optional natural-language description of the JSON to extract' },
      },
    },
    free: false,
    build: (a) => {
      const urls = Array.isArray(a.urls) ? a.urls.filter((u): u is string => typeof u === 'string') : [];
      const url = str(a, 'url');
      if (url === undefined && urls.length === 0) throw new Error('webcap_extract: provide "url" or "urls"');
      return {
        method: 'POST',
        path: '/v1/x402/extract',
        body: {
          ...(url !== undefined ? { url } : {}),
          ...(urls.length > 0 ? { urls } : {}),
          ...(str(a, 'schema') !== undefined ? { schema: str(a, 'schema') } : {}),
        },
      };
    },
  },
  {
    name: 'webcap_audit',
    description: 'PAID ($0.002): SEO basics plus link and Open Graph health for one URL in a single call.',
    inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    free: false,
    build: (a) => ({ method: 'POST', path: '/v1/x402/audit', body: { url: required(a, 'url', 'webcap_audit') } }),
  },
  {
    name: 'webcap_map_lite',
    description: 'PAID ($0.002): a site URL list from sitemap/robots plus a 1-hop same-host crawl (maxUrls up to 50, default 20).',
    inputSchema: {
      type: 'object',
      properties: { ...URL_PROP, maxUrls: { type: 'integer', description: '1-50 (default 20)' } },
      required: ['url'],
    },
    free: false,
    build: (a) => ({
      method: 'POST',
      path: '/v1/x402/map-lite',
      body: {
        url: required(a, 'url', 'webcap_map_lite'),
        ...(typeof a.maxUrls === 'number' ? { maxUrls: Math.trunc(a.maxUrls) } : {}),
      },
    }),
  },
  {
    name: 'webcap_video',
    description: 'PAID ($0.005): scroll-capture a page as an MP4/WebM video artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        ...URL_PROP,
        format: { type: 'string', enum: ['mp4', 'webm'], description: 'Video format (default mp4)' },
        durationMs: { type: 'integer', description: 'Scroll duration in ms (default 5000, max 30000)' },
      },
      required: ['url'],
    },
    free: false,
    build: (a) => ({
      method: 'POST',
      path: '/v1/x402/video',
      body: {
        url: required(a, 'url', 'webcap_video'),
        ...(str(a, 'format') !== undefined ? { format: str(a, 'format') } : {}),
        ...(typeof a.durationMs === 'number' ? { durationMs: Math.trunc(a.durationMs) } : {}),
      },
    }),
  },
  {
    name: 'webcap_analyze',
    description:
      'PAID ($0.01): AI analysis of one URL — task is classification, accessibility, layout, entities or sentiment.',
    inputSchema: {
      type: 'object',
      properties: {
        ...URL_PROP,
        task: {
          type: 'string',
          enum: ['classification', 'accessibility', 'layout', 'entities', 'sentiment'],
          description: 'What to analyze',
        },
      },
      required: ['url', 'task'],
    },
    free: false,
    build: (a) => ({
      method: 'POST',
      path: '/v1/x402/analyze',
      body: { url: required(a, 'url', 'webcap_analyze'), task: required(a, 'task', 'webcap_analyze') },
    }),
  },
];

/** JSON-RPC result envelope. */
function result(id: unknown, value: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, result: value };
}

/** JSON-RPC error envelope. */
function error(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** MCP tool result: a single text block, JSON-encoded, plus isError on failure. */
function textResult(value: unknown, isError = false): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/** The `initialize` result: protocol revision (echoed), tools capability, identity. */
export function initializeResult(requestedVersion: unknown, version: string): unknown {
  const protocolVersion = typeof requestedVersion === 'string' && requestedVersion.trim() !== ''
    ? requestedVersion
    : MCP_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: MCP_SERVER_NAME, version },
    instructions:
      'webcap turns a URL into a screenshot, structured JSON, or a page audit, paid per call in USDC over x402. ' +
      'Free tools need nothing; paid tools return a 402 challenge (price, network, payTo) when no wallet is wired. ' +
      'Call webcap_service to see every endpoint and price.',
  };
}

/** Paid-tool guidance text shown when the unpaid call returns a 402. */
function paymentGuidance(ctx: McpContext, tool: string, status: number, body: unknown): string {
  return [
    `${tool} requires payment (HTTP ${status}).`,
    ctx.canPay
      ? 'A payer wallet is configured but the payment was not accepted — see the challenge below (check balance/network).'
      : 'No payer wallet is configured for this MCP server. Set WEBCAP_MCP_WALLET_KEY (or X402_CUSTOMER_PRIVATE_KEY) to a funded Base-mainnet USDC key to auto-pay, or pay with your own x402 client.',
    'The x402 v2 challenge is included below: sign a gasless EIP-3009 transferWithAuthorization for accepts[0] and retry with the PAYMENT-SIGNATURE header.',
    JSON.stringify(body, null, 2),
  ].join('\n');
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null when no
 * response is due (notifications, and anything without an id).
 */
export async function handleRpc(message: unknown, ctx: McpContext): Promise<unknown | null> {
  if (!isRecord(message) || typeof message.method !== 'string') {
    return isRecord(message) && 'id' in message ? error(message.id, -32600, 'invalid request') : null;
  }
  const { method } = message;
  const hasId = 'id' in message;
  const id: unknown = hasId ? message.id : undefined;

  if (typeof method === 'string' && method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return result(id, initializeResult(isRecord(message.params) ? message.params.protocolVersion : undefined, ctx.version));
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case 'tools/call': {
      const params = isRecord(message.params) ? message.params : {};
      const name = params.name;
      if (typeof name !== 'string') return error(id, -32602, 'tools/call: "name" is required');
      const tool = TOOLS.find((t) => t.name === name);
      if (tool === undefined) return error(id, -32602, `unknown tool: ${name}`);
      const args = isRecord(params.arguments) ? params.arguments : {};
      let req: ToolRequest;
      try {
        req = tool.build(args);
      } catch (err) {
        return result(id, textResult(err instanceof Error ? err.message : String(err), true));
      }
      try {
        const res = await ctx.http.request(req.method, req.path, req.body);
        if (res.status === 402 && !tool.free) {
          return result(id, textResult(paymentGuidance(ctx, tool.name, res.status, res.body)));
        }
        if (res.status >= 400) {
          return result(id, textResult({ status: res.status, body: res.body }, true));
        }
        return result(id, textResult(res.body));
      } catch (err) {
        return result(id, textResult(`webcap request failed: ${err instanceof Error ? err.message : String(err)}`, true));
      }
    }
    default:
      return hasId ? error(id, -32601, `method not found: ${method}`) : null;
  }
}
