import { badRequest } from './errors.js';

/**
 * Parse-level URL validation for capture targets.
 *
 * NOTE: this is a static (parse-time) guard only. DNS rebinding — a hostname
 * that resolves publicly here but to a private IP at fetch time — is a
 * documented residual risk and must be re-checked where the actual fetch
 * happens. Do not add async DNS resolution to this function.
 */
export function validateCaptureUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest(`invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest(`unsupported URL scheme: ${url.protocol}`);
  }
  const host = stripBrackets(url.hostname);
  if (host === '' || isBlockedHost(host)) {
    throw badRequest(`capture host is not allowed: ${url.hostname || raw}`);
  }
  return url.toString();
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isBlockedHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  return isBlockedIpv4(host);
}

/**
 * Private / loopback / link-local IPv4 literals. The WHATWG URL parser
 * already normalizes shorthand forms (e.g. 127.1 -> 127.0.0.1) and decimal
 * encodings, so matching dotted quads is sufficient.
 */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (part === '' || !/^[0-9]+$/.test(part)) return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  if (first === 127) return true; // 127.0.0.0/8 loopback
  if (first === 10) return true; // 10.0.0.0/8 private
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12 private
  if (first === 192 && second === 168) return true; // 192.168.0.0/16 private
  if (first === 169 && second === 254) return true; // 169.254.0.0/16 link-local
  return false;
}
