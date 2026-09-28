/**
 * The share-link resolver, which now lives in `common/geo/map-link.ts`.
 *
 * IT MOVED, IT DID NOT CHANGE. The company's own "complete your
 * profile" step needs to read a pasted map link exactly as this console
 * does — the same allowlist, the same hop limit, the same refusal — and
 * a second copy under a different roof would be free to diverge. This
 * file stays as the name the admin module has always imported.
 */
export {
  resolveShareLink,
  type MapLinkFetcher,
} from "../../common/geo/map-link";
