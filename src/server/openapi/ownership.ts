/**
 * The x402scan verified-ownership proof (the `x-discovery` discovery
 * extension): an EIP-191 personal_sign of the service origin, signed with
 * the merchant (payTo) private key. x402scan recovers the signer from the
 * signature and matches it against the resource's payTo address to award
 * the ownership_verified trust tier.
 *
 * Computed from config on demand; deterministic per key+message (ethers'
 * RFC 6979 fixed-nonce ECDSA), no network, no side effects.
 */
import { Wallet } from 'ethers';

/**
 * The ownershipProofs array for a deployment: [personal_sign(origin)] where
 * origin is the public base URL's origin (exactly what x402scan signs).
 * Empty when the merchant private key is unset (nothing to sign with).
 * ethers v6 signMessage is async, hence the Promise.
 */
export async function ownershipProof(publicBaseUrl: string, merchantPrivateKey: string): Promise<string[]> {
  const key = merchantPrivateKey.trim();
  if (key === '') return [];
  const origin = new URL(publicBaseUrl).origin;
  const signature = await new Wallet(key).signMessage(origin);
  return [signature];
}
