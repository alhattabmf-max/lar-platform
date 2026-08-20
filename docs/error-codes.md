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

New codes are added here as new modules ship (Phase 2+), never
invented ad hoc inside a controller. Each new code added to
`ERROR_CODES` in `packages/types` must have a corresponding entry in
this table and a localized message key in `apps/web/messages/*.json`.
