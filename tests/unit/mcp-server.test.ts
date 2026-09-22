import { describe, expect, it } from 'vitest';
import { TOOLS, handleRpc, initializeResult, type McpHttp, type McpResponse } from '../../src/mcp/server.js';

// The MCP server is how an agent runtime finds webcap as a tool. These tests
// pin the protocol surface (initialize/tools list/tools call), the free-vs-paid
// split, and that a paid tool without a wallet returns the x402 challenge
// rather than a bare failure.

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function fakeHttp(response: McpResponse): { http: McpHttp; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    http: {
      async request(method, path, body) {
        calls.push({ method, path, body });
        return response;
      },
    },
  };
}

function ctx(response: McpResponse, canPay = false) {
  const f = fakeHttp(response);
  return { ...f, context: { baseUrl: 'https://webcap.shoutsid.fyi', version: '0.1.0', http: f.http, canPay } };
}

function rpc(msg: unknown, c: ReturnType<typeof ctx>['context']) {
  return handleRpc(msg, c) as Promise<{ result?: any; error?: { code: number; message: string } } | null>;
}

describe('MCP server core', () => {
  it('initialize echoes the requested protocol version and advertises the tools capability', async () => {
    const c = ctx({ status: 200, body: {} });
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, c.context);
    expect(res?.result.protocolVersion).toBe('2025-06-18');
    expect(res?.result.capabilities).toEqual({ tools: {} });
    expect(res?.result.serverInfo.name).toBe('webcap');
  });

  it('initialize falls back to our protocol revision when neither is given', () => {
    const r = initializeResult(undefined, '0.1.0') as { protocolVersion: string };
    expect(r.protocolVersion).toBe('2024-11-05');
  });

  it('tools/list exposes every tool with a JSON-Schema input', async () => {
    const c = ctx({ status: 200, body: {} });
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, c.context);
    const tools = res?.result.tools as Array<{ name: string; description: string; inputSchema: { type: string } }>;
    expect(tools.length).toBe(TOOLS.length);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['webcap_preview', 'webcap_capture', 'webcap_extract', 'webcap_audit', 'webcap_analyze']),
    );
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('free tool calls the right path and returns the body as text content', async () => {
    const c = ctx({ status: 200, body: { title: 'Example Domain' } });
    const res = await rpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'webcap_preview', arguments: { url: 'https://example.com/a b' } } },
      c.context,
    );
    expect(c.calls[0]?.method).toBe('GET');
    expect(c.calls[0]?.path).toBe('/v1/extract/preview?url=https%3A%2F%2Fexample.com%2Fa%20b');
    expect(res?.result.content[0].text).toContain('Example Domain');
    expect(res?.result.isError).toBeUndefined();
  });

  it('a paid tool with no wallet returns the 402 challenge as guidance, not a bare error', async () => {
    const c = ctx({ status: 402, body: { x402Version: 2, accepts: [{ amount: '1000', network: 'eip155:8453' }] } }, false);
    const res = await rpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'webcap_capture', arguments: { url: 'https://example.com' } } },
      c.context,
    );
    const text = res?.result.content[0].text as string;
    expect(text).toContain('requires payment');
    expect(text).toContain('WEBCAP_MCP_WALLET_KEY');
    expect(text).toContain('eip155:8453');
    // guidance, not a tool error
    expect(res?.result.isError).toBeUndefined();
  });

  it('a paid tool that settles returns the paid body', async () => {
    const c = ctx({ status: 200, body: { artifact: { url: 'https://webcap.shoutsid.fyi/v1/artifacts/x' } } }, true);
    const res = await rpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'webcap_capture', arguments: { url: 'https://example.com', format: 'pdf' } } },
      c.context,
    );
    expect(c.calls[0]?.method).toBe('POST');
    expect(c.calls[0]?.body).toEqual({ url: 'https://example.com', format: 'pdf' });
    expect(res?.result.content[0].text).toContain('/v1/artifacts/x');
  });

  it('bad tool arguments surface as an isError result, not a crash', async () => {
    const c = ctx({ status: 200, body: {} });
    const res = await rpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'webcap_capture', arguments: {} } },
      c.context,
    );
    expect(res?.result.isError).toBe(true);
    expect(res?.result.content[0].text).toContain('url');
    expect(c.calls.length).toBe(0);
  });

  it('extract requires url or urls', async () => {
    const c = ctx({ status: 200, body: {} });
    const res = await rpc(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'webcap_extract', arguments: {} } },
      c.context,
    );
    expect(res?.result.isError).toBe(true);
  });

  it('unknown tool is a JSON-RPC error; unknown method too', async () => {
    const c = ctx({ status: 200, body: {} });
    const bad = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope', arguments: {} } }, c.context);
    expect(bad?.error?.code).toBe(-32602);
    const method = await rpc({ jsonrpc: '2.0', id: 9, method: 'does/not/exist' }, c.context);
    expect(method?.error?.code).toBe(-32601);
  });

  it('notifications get no response', async () => {
    const c = ctx({ status: 200, body: {} });
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, c.context)).toBeNull();
    expect(await handleRpc({ jsonrpc: '2.0', method: 'unknown/notification' }, c.context)).toBeNull();
  });

  it('an upstream 5xx becomes an isError result carrying the status', async () => {
    const c = ctx({ status: 502, body: { error: { code: 'capture_failed' } } });
    const res = await rpc(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'webcap_health', arguments: {} } },
      c.context,
    );
    expect(res?.result.isError).toBe(true);
    expect(res?.result.content[0].text).toContain('502');
  });
});
