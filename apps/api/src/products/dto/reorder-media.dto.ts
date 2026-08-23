import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from "class-validator";

/**
 * Reordering a product's images.
 *
 * `mediaIds` must be EXACTLY the product's current media, in the order
 * they should end up. The service checks set equality; this checks the
 * shape.
 *
 * `@ArrayUnique` is the fix for a real defect: the service's guard was
 * `mediaIds.length === existing.length && mediaIds.every(id => known)`,
 * which `[a, a]` satisfies when the product has `[a, b]`. The loop then
 * wrote `a.sortOrder = 0` and `a.sortOrder = 1` while `b` kept a stale
 * order — a silent, partial reorder. Rejecting duplicates here and
 * checking true set equality in the service closes it from both ends.
 */
export class ReorderMediaDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  mediaIds!: string[];
}
