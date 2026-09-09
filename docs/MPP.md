# MPP (Machine Payments Protocol) on webcap

MPP is the Tempo Machine Payments Protocol (IETF
draft-ryan-httpauth-payment-01): paid HTTP routes answer 402 with a
`WWW-Authenticate: Payment ...` challenge carrying the payment terms, next to
the body/header credential flow the client already uses. webcap speaks MPP
alongside x402 so MPP-first directories (mppscan) can list the same paid
routes x402 clients already pay for.

Status (2026-09-06): fully live. The 3 paid 402s emit `WWW-Authenticate:
Payment …method="evm"…` (bare-host realm) alongside the unchanged x402
`PAYMENT-REQUIRED`, MPP EIP-3009 credentials verify and settle through the
same facilitator, and mppscan registration succeeded (`registered: 22,
failed: 0`) — down from the earlier `registered=0 failed=3 "No MPP protocol
support" plus a `REALM_MISMATCH` round (realm must be the bare host, not the
origin). Everything below describes this shipped shape.

## Why dual-protocol

x402 stays the settlement rail: EIP-3009 USDC authorizations, facilitator
verify plus settle, `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` /
`PAYMENT-RESPONSE` headers. MPP is an additive advertisement of the same price
terms for a second discovery family. One price list, two challenge encodings,
zero change to what x402 payers sign or what the merchant receives.

## Enabling

MPP is opt-in and disabled by default. `MPP_SECRET_KEY` unset or empty means
x402-only, exactly the current behavior.

```bash
# Generate a fresh secret (>= 32 bytes decoded) and put it in .env:
openssl rand -base64 32
```

```bash
MPP_SECRET_KEY=<output of the command above, never commit the real value>
```

Rules (`src/mpp/config.ts`, `MPP_MIN_SECRET_BYTES = 32`):

- The value may be a raw UTF-8 passphrase or hex (with or without `0x`).
- It must decode to at least 32 bytes, otherwise the server refuses to start.
- Unset or empty means disabled. There is no other switch.
- Never commit a real secret. `.env` is gitignored, `.env.example` carries a
  placeholder only.

## Realm semantics

`realm` is the bare host of `WEBCAP_PUBLIC_BASE_URL` (scheme and path
stripped, explicit port kept — `realmOf`). mppscan rejects scheme-qualified
realms (`REALM_MISMATCH`) and attributes on-chain stats to the origin host.
For this deployment:

```text
realm = webcap.fly.dev
```

The MPP session is bound to that host. If the public base URL changes
(tunnel restart with a new host), the realm changes with it and anything
bound to the old realm (directory listings, in-flight challenges) must be
re-registered.

## 402 header anatomy

Every paid 402 carries both challenges. The x402 side is byte-for-byte what
it is today. The MPP side is one `WWW-Authenticate` header (target shape,
values redacted, secret never appears on the wire):

```http
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64 x402 v2 challenge, unchanged>
WWW-Authenticate: Payment id="<redacted session id>", realm="https://webcap.fly.dev", method="evm", intent="charge", request="<redacted terms blob>", expires="<unix epoch seconds>"
```

Fields: `id` is the opaque session id, `realm` is the origin above,
`method="evm"` selects EVM settlement, `intent="charge"` marks a one-shot
charge (not a subscription), `request` carries the signed price terms,
`expires` bounds the challenge lifetime. Paid routes:
`POST /v1/x402/capture`, `POST /v1/x402/extract`,
`POST /v1/x402/watches/topup`.

## Paying under MPP (EIP-3009 credential flow)

The credential is the same gasless EIP-3009 `transferWithAuthorization` the
x402 flow signs, against the same `accepts[0]` terms
(`network`, `asset`, `amount`, `payTo`, `extra`):

1. POST the endpoint unpaid, read the 402 (JSON body or either challenge
   header) for `accepts[0]`.
2. Sign the EIP-712 authorization: from is your EOA, to is `payTo`, value is
   `amount` in atomic 6-decimal USDC units, domain is the USDC contract (name
   and version from `extra`, chainId is the numeric suffix of `network`,
   verifyingContract is `asset`).
3. Retry the identical request with the payment credential. The facilitator
   verifies and settles on-chain, the 200 carries the result plus the
   settlement header.

MPP clients charge these exact terms through the mpp flow advertised in
`x-payment-info` instead of the `PAYMENT-SIGNATURE` header. Same amount, same
merchant wallet, same chain.

## mppscan registration

Pre-probe first: the OpenAPI discovery probe must pass (`ownership_verified`
plus guidance on) before registering, otherwise the registration call wastes
a round trip.

```bash
BASE=https://webcap.fly.dev

# 1. Pre-probe: paid ops advertise both protocols, 402s document WWW-Authenticate.
curl -fsS "$BASE/openapi.json" | python3 -c '
import json, sys
doc = json.load(sys.stdin)
for p in ["/v1/x402/capture", "/v1/x402/extract", "/v1/x402/watches/topup"]:
    op = doc["paths"][p]["post"]
    print(p, op["x-payment-info"]["protocols"], sorted(op["responses"]["402"].get("headers", {})))'

# 2. Register the origin.
curl -fsS -X POST https://mppscan.com/api/register \
  -H 'content-type: application/json' \
  -d "{\"url\":\"$BASE\"}"; echo
```

Current result (superseded — see status line at top): the header has shipped
(`WWW-Authenticate: Payment …method="evm"…` live on all paid 402s, verified
2026-09-06) and registration reports `registered: 22, failed: 0`. The
`{"registered":0,"failed":3}` output below is the historical pre-header state,
kept for the record. The keepalive script probes the paid 402s for the header
(log-only, nonfatal).

Related directory note: the x402gle audition (`npx @dexterai/opendexter
audition`) is a separate merchant test and is currently blocked on their
catalog flush, not on MPP. Keepalive checks that listing presence log-only
and never auto-runs the audition.

## x402-unchanged guarantee

- Secret unset or empty: the server behaves exactly as before, x402-only.
- Secret set: the x402 challenge body, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`
  verification, facilitator settle path, prices, and response shapes are all
  untouched. MPP only adds the `WWW-Authenticate` header and the
  `x-payment-info` protocol entry.
- Full suite stays green either way. MPP tests live under `tests/mpp/`.

## Appendix: ready-to-paste agent-surface pointers

`/llms.txt` and `/skill.md` are served from `src/server/agent-surfaces.ts`
(runtime text, so this copy is staged here for the orchestrator to apply).
One paragraph each, in the terse how-to-pay voice of that file:

llms.txt pointer: `MPP note: the same 3 paid routes also answer 402 with a
WWW-Authenticate: Payment challenge (Machine Payments Protocol,
method="evm", realm = this deployment origin) priced identically to the x402
challenge; charge the same accepts[0] EIP-3009 terms through your MPP client.
Full detail: <base>/docs/MPP.md (served from the repo docs).`

skill.md pointer: `If your stack speaks MPP instead of x402, read the
WWW-Authenticate: Payment header on the 402 (method="evm",
intent="charge"): it prices the identical USDC terms as accepts[0], so sign
the same gasless EIP-3009 authorization and settle through your MPP client.
Unset MPP_SECRET_KEY deployments are x402-only.`
