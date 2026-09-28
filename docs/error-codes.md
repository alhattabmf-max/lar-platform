# Error Code Catalogue

Every API error response follows the Error Envelope contract
(`packages/types/src/error-envelope.ts`):

```json
{
  "error": { "code": "VALIDATION_FAILED", "message": "...", "details": {} },
  "requestId": "...",
  "timestamp": "..."
}
```

`apps/web`'s i18n layer must key off `error.code` only — never off
`error.message`, which is an English developer-facing default and must
never be shown to end users directly.

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Request body/query/params failed validation. |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication. |
| `FORBIDDEN` | 403 | Authenticated, but not allowed to perform this action. |
| `NOT_FOUND` | 404 | The requested resource does not exist. |
| `CONFLICT` | 409 | The request conflicts with the current state of a resource. |
| `RATE_LIMITED` | 429 | Too many requests. |
| `SERVICE_UNAVAILABLE` | 503 | A required dependency is temporarily unavailable. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |

### Checkout and payment

| Code | HTTP Status | Meaning |
|---|---|---|
| `PAYMENT_ATTEMPT_ALREADY_ACTIVE` | 409 | The checkout session is not in a state that allows starting a payment — most often because one is already under way on it. |
| `CHECKOUT_LOCK_EXPIRED` | 409 | The basket's `lock_expires_at` has passed. The buyer must start a new checkout; the stock it held is back on the shelf. |

Two codes rather than one, because they ask the buyer for opposite
things. "Already active" means a payment is under way and the screen
should point at it or wait; `CHECKOUT_LOCK_EXPIRED` means the basket is
gone and the only way forward is a new checkout, where the quantity
still available is recomputed. A screen that could not tell them apart
told a buyer to wait for something that would never arrive.

The lock is never revived or extended by the refusal, and the session is
not marked `EXPIRED` there either — that transition belongs to the
lifecycle sweep. See `docs/two-sale-paths.md` for why starting a payment
from a dead basket was a money-path defect and not only a tidiness one.

### Header logo (Phase 8G)

| Code | HTTP Status | Meaning |
|---|---|---|
| `BRAND_LOGO_TOO_LARGE` | 400 | The uploaded file is over `BRAND_LOGO_LIMITS.maxSizeBytes`. |
| `BRAND_LOGO_TOO_MANY_PIXELS` | 400 | The image decodes to more pixels than `BRAND_LOGO_LIMITS.maxPixels`. |
| `BRAND_LOGO_TYPE_UNSUPPORTED` | 400 | Not a PNG or WebP, or not decodable as an image at all. |
| `BRAND_LOGO_TOO_SMALL` | 400 | Smaller than `BRAND_LOGO_LIMITS.minWidth` × `minHeight`. |

Four codes rather than one on purpose. These used to share
`VALIDATION_FAILED`, and because the web app may key a message off
`error.code` and nothing else, every one of them rendered as "the
submitted data is not valid" — which told an operator holding an
ordinary logo file nothing about whether to shrink it, re-export it, or
scale it up. Each of these has a different fix, so each carries a code
that can name one.

The limits themselves live in `BRAND_LOGO_LIMITS`
(`packages/types/src/contracts/branding.ts`) so the server's refusal and
the sentence the operator reads above the file picker interpolate the
same numbers.

New codes are added here as new modules ship (Phase 2+), never
invented ad hoc inside a controller. Each new code added to
`ERROR_CODES` in `packages/types` must have a corresponding entry in
this table and a localized message key in `apps/web/messages/*.json`.
