/** Options for a raw Meta Graph API request. */
export interface MetaRequestOptions {
  /** HTTP method — defaults to `GET`. */
  method?: 'GET' | 'POST';
  /** Request body for POST requests. Use `FormData` for image uploads. */
  body?: Record<string, unknown> | FormData;
  /** URL query parameters appended to the request. */
  params?: Record<string, string>;
}

export interface MetaErrorDetail {
  /** Human-readable error message from the Meta API. */
  message: string;
  /** Type of error (e.g. "OAuthException", "APIException"). */
  type?: string;
  /** Numeric error code for programmatic handling. */
  code?: number;
  /** Subcode providing additional error context. */
  error_subcode?: number;
  /** Whether the error is transient and may succeed if retried. */
  error_user_title?: string;
  /** A more detailed message intended for end-users, if available. */
  error_user_msg?: string;
}

export class MetaApiError extends Error {
  readonly metaError: MetaErrorDetail;

  constructor(detail: MetaErrorDetail) {
    super(detail.message || 'Meta API Error');
    this.name = 'MetaApiError';
    this.metaError = detail;
  }
}

/** Granularity level for insight queries. */
export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad';

/** Parameters required to create a new ad creative. */
export interface CreateAdCreativeParams {
  /** Display name for the creative. */
  name: string;
  /** Facebook Page ID used as the ad identity. */
  pageId: string;
  /** Hash of a previously uploaded image asset (mutually exclusive with `videoId`). */
  imageHash?: string;
  /** ID of a previously uploaded video asset (mutually exclusive with `imageHash`). */
  videoId?: string;
  /** Primary ad copy (body text shown below the headline). */
  message: string;
  /** Destination URL the ad links to. */
  link: string;
  /** Ad headline shown in the link preview. */
  headline: string;
  /** Optional description shown below the headline. */
  description?: string;
  /** Call-to-action button type (e.g. `LEARN_MORE`, `SIGN_UP`). */
  callToAction: string;
}

export interface CreateAdParams {
  name: string;
  adsetId: string;
  creativeId: string;
  status?: 'ACTIVE' | 'PAUSED';
}

export interface MetaImageUploadResponse {
  images: Record<string, { hash: string; url?: string }>;
}

export interface MetaVideoUploadResponse {
  id: string;
}

export interface MetaAdAccountInfo {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  amount_spent: string;
}
