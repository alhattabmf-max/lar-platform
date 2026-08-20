/**
 * Selects the representative image from a frozen product snapshot.
 *
 * The snapshot's `media` array carries `{ objectKey, thumbnailObjectKey,
 * isMain, sortOrder }` and — critically — NO `id`. So the ordering here
 * must be a TOTAL order built only from those fields, or two entries
 * could tie and the chosen image would vary between requests.
 *
 * Order: isMain DESC, sortOrder ASC, objectKey ASC.
 *
 * `isMain` cannot be relied on to exist: a supplier can delete the main
 * image, leaving a product with zero `isMain` entries, and pre-7A
 * snapshots predate media capture entirely. The rule therefore degrades
 * cleanly rather than assuming a main image is present.
 */

export interface SnapshotMediaEntry {
  objectKey: string;
  thumbnailObjectKey: string;
  isMain: boolean;
  sortOrder: number;
}

function isValidEntry(value: unknown): value is SnapshotMediaEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.objectKey === "string" &&
    entry.objectKey.length > 0 &&
    typeof entry.thumbnailObjectKey === "string" &&
    entry.thumbnailObjectKey.length > 0
  );
}

/**
 * Parses the media array out of an arbitrary snapshot value.
 *
 * Every shape that is not a usable array of entries — absent, null, a
 * legacy snapshot with no `media` key, a non-array, entries missing
 * keys — resolves to an empty list. A malformed snapshot must never
 * throw: it belongs to an opportunity that is otherwise perfectly
 * valid, and losing its image is not a reason to fail the request.
 */
export function parseSnapshotMedia(snapshot: unknown): SnapshotMediaEntry[] {
  if (typeof snapshot !== "object" || snapshot === null) return [];

  const media = (snapshot as Record<string, unknown>).media;
  if (!Array.isArray(media)) return [];

  return media.filter(isValidEntry).map((entry) => ({
    objectKey: entry.objectKey,
    thumbnailObjectKey: entry.thumbnailObjectKey,
    // A missing or non-boolean flag is treated as "not main" rather
    // than rejected — the entry is still a usable image.
    isMain: entry.isMain === true,
    sortOrder: typeof entry.sortOrder === "number" ? entry.sortOrder : 0,
  }));
}

/**
 * The single representative image, or null when the snapshot has none.
 *
 * Returning null (rather than a placeholder key) is what lets the
 * contract expose a nullable image URL and the client render a real
 * no-image state.
 */
export function selectMainMedia(snapshot: unknown): SnapshotMediaEntry | null {
  const entries = parseSnapshotMedia(snapshot);
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    // Final tiebreaker: the snapshot has no id, and objectKey is
    // UUID-derived and unique, so this makes the order total.
    return a.objectKey < b.objectKey ? -1 : a.objectKey > b.objectKey ? 1 : 0;
  });

  return sorted[0];
}

/** True when the snapshot can produce an image at all. */
export function hasSnapshotImage(snapshot: unknown): boolean {
  return selectMainMedia(snapshot) !== null;
}
