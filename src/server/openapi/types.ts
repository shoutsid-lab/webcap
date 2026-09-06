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
}

/** Path template -> method -> operation (the value of the document's `paths`). */
export type OpenapiPaths = { readonly [path: string]: { readonly [method: string]: OpenapiOperation } };

export interface OpenapiDocument {
  readonly openapi: '3.1.0';
  /** x402scan verified-ownership discovery extension (omitted when there is no merchant key to sign with). */
  readonly 'x-discovery'?: { readonly ownershipProofs: readonly string[] };
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly servers: readonly { readonly url: string; readonly description?: string }[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly paths: OpenapiPaths;
  readonly components: { readonly schemas: { readonly [name: string]: Json } };
}
