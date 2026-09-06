/**
 * The OpenAPI 3.1 document types shared by the catalog modules in this
 * directory. Split out of openapi.ts as a pure move (no behavior change).
 */

/** JSON value (OpenAPI schema payloads are plain JSON). */
export type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };

export interface OpenapiResponse {
  readonly description: string;
  /** Named response headers (e.g. PAYMENT-REQUIRED on 402). */
  readonly headers?: { readonly [name: string]: { readonly description: string; readonly schema: Json } };
  /** Media type -> schema. */
  readonly content?: { readonly [mediaType: string]: { readonly schema: Json } };
}

export interface OpenapiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required?: boolean;
  readonly schema: Json;
  readonly description?: string;
}

/** mppscan/x402gle discovery: a fixed per-call price (6-decimal USD string). */
export interface OpenapiFixedPrice {
  readonly mode: 'fixed';
  readonly currency: 'USD';
  readonly amount: string;
}

/** mppscan/x402gle discovery: a dynamic price bounded by min/max 6-decimal USD strings. */
export interface OpenapiDynamicPrice {
  readonly mode: 'dynamic';
  readonly currency: 'USD';
  readonly min: string;
  readonly max: string;
}

/** mppscan/x402gle discovery extension on a paid operation. */
export interface OpenapiPaymentInfo {
  readonly price: OpenapiFixedPrice | OpenapiDynamicPrice;
  readonly protocols: readonly ({ readonly x402: Record<string, never> })[];
}

export interface OpenapiOperation {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly OpenapiParameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly description?: string;
    readonly content: { readonly [mediaType: string]: { readonly schema: Json } };
  };
  readonly responses: { readonly [status: string]: OpenapiResponse };
  /** mppscan/x402gle discovery: present on the paid x402 operations. */
  readonly 'x-payment-info'?: OpenapiPaymentInfo;
  /** OpenAPI security requirements; `[]` = the operation is open (no payment, no auth). */
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
}

/** Path template -> method -> operation (the value of the document's `paths`). */
export type OpenapiPaths = { readonly [path: string]: { readonly [method: string]: OpenapiOperation } };

export interface OpenapiDocument {
  readonly openapi: '3.1.0';
  /** x402scan verified-ownership discovery extension (omitted when there is no merchant key to sign with). */
  readonly 'x-discovery'?: { readonly ownershipProofs: readonly string[] };
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
    /** mppscan/x402gle discovery: high-level agent usage guidance. */
    readonly 'x-guidance'?: string;
    /** Present only when the deployment configures a contact email. */
    readonly contact?: { readonly email: string };
  };
  readonly servers: readonly { readonly url: string; readonly description?: string }[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly paths: OpenapiPaths;
  readonly components: { readonly schemas: { readonly [name: string]: Json } };
}
