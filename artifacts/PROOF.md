# webcap SURFACE — proof of the complete revenue loop (TEST mode)

Self-contained evidence that webcap's full revenue loop works end-to-end:
**register → invoice → on-chain USDC payment → settlement → paid capture**.
Everything below ran against a **local anvil chain (chainId 31337)** with a
mintable USDC contract — no mainnet, no real funds, no internet (the captured
page is served by a local HTTP fixture).

## Participants (all local anvil)

| Role | Address |
|---|---|
| Chain | anvil, chainId `31337` |
| USDC contract | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| Merchant (receives USDC) | `0x366F0d933689411a8EF70DFE66De7cb90e7db445` |
| Customer (anvil account #0) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |

The merchant is a **fresh wallet that was never minted**, so the only `Transfer`
to it on-chain is the real customer payment below — nothing else can settle the
invoice. (Addresses only; no private keys are recorded here.)

## The loop, with real values

1. **Register** — customer's wallet address is registered, a `wc_live_` API key is minted.
2. **Invoice** — a 100-credit invoice is created: `requiredUsdc = 1.0` (1 USDC = 100 credits), payable to the merchant.
3. **On-chain payment** — the customer transfers **1.0 USDC** (1,000,000 base units) to the merchant.
   - tx hash: `0x87502e4403fd844e769549a1412dde625705fea7a07b447578ebf13a6dfe379b`
   - block: `4`
4. **Settlement** — the server's poller (1s cadence) reads the `Transfer` log to the merchant, settles the invoice, and credits the account: **100 credits** (`floor(1.0 × 100)`). The account flips to `balance: 100`, invoice `status: "paid"`.
5. **Paid capture** — `POST /v1/capture` charges 1 credit (0.01 USDC), renders the local page with headless Chrome, and returns the PNG. Balance drops `100 → 99`.

## Key request/response excerpts (from the raw transcript)

**(1) Register → 201**
```
POST /v1/register
{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}
→ {"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","apiKey":"wc_live_3842470323b1904c0f300af8718ed10e","balance":0}
```

**(2) Invoice (100 credits) → 201**
```
POST /v1/invoice   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
{"credits":100}
→ {"invoiceId":"1","merchant":"0x366F0d933689411a8EF70DFE66De7cb90e7db445","token":"0x5FbDB2315678afecb367f032d93F642f64180aa3","chainId":31337,"requiredUsdc":1,"credits":100,"expiresAt":"2026-09-04T19:02:56.387Z"}
```

**(3) On-chain payment → receipt** (ethers, anvil)
```
usdc.transfer(to=0x366F0d933689411a8EF70DFE66De7cb90e7db445, amount=1000000)   # 1.0 USDC
→ {"txHash":"0x87502e4403fd844e769549a1412dde625705fea7a07b447578ebf13a6dfe379b","blockNumber":4,"from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","to":"0x366F0d933689411a8EF70DFE66De7cb90e7db445","amountBase":"1000000"}
```

**(4) Account after settlement → 200** (poll #2, ~2s after the tx)
```
GET /v1/account   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
→ {"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","balance":100,"invoices":[{"id":"1","status":"paid","credits":100,"requiredUsdc":1,"createdAt":"2026-09-04T18:02:56.387Z"}]}
```

**(5) Paid capture → 200** (data truncated)
```
POST /v1/capture   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
{"url":"http://127.0.0.1:8123/","format":"png"}
→ {"artifact":{"format":"png","bytes":18376,"data":"iVBORw0KGgoAAAANSUhEUgAA...[truncated]"},"creditsCharged":1,"balance":99}
```

## The screenshot

`artifacts/surface-capture.png` is the base64-decoded `artifact.data` from step 5.

- Magic bytes (first 4): **`89 50 4E 47`** (PNG signature)
- Size: **18376 bytes**
- `file`: `PNG image data, 1280 x 720, 8-bit/color RGB, non-interlaced`

## Result

A real invoice was paid **on-chain** (tx `0x87502e…e379b`, block 4), the
settlement credited exactly **100 credits**, and a paid capture returned a real
**18376-byte PNG** (magic `89504E47`) — completing the webcap revenue loop in
test mode.
