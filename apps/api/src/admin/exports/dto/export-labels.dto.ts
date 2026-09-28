import { IsOptional, IsString, MaxLength, Matches } from "class-validator";

/**
 * The words a spreadsheet wears, sent by the screen that asked for it.
 *
 * WHY THE CLIENT SENDS THE HEADINGS. The requirement is that a file's
 * columns match the table the operator was looking at, in the language
 * they were reading — and the screen is the only place that knows both.
 * Teaching the API a second copy of every translation would give the
 * two something to disagree about, and the first time they did, a file
 * would arrive with different words from the page it came from.
 *
 * WHAT MAKES THAT SAFE. These values are decoration, never selection: no
 * label decides which rows are read, which columns are queried, or who
 * may see them. Each is length-capped, each is written through the
 * formula-neutralising path like any other cell, and the filename is
 * stripped of quotes and path separators before it reaches a header.
 * A caller who sends nonsense gets a file with nonsense headings over
 * exactly the rows their session was already allowed to read.
 */
export class ExportLabelsDto {
  /** Column headings, in the table's own order. */
  @IsOptional() @IsString() @MaxLength(80) c1?: string;
  @IsOptional() @IsString() @MaxLength(80) c2?: string;
  @IsOptional() @IsString() @MaxLength(80) c3?: string;
  @IsOptional() @IsString() @MaxLength(80) c4?: string;
  @IsOptional() @IsString() @MaxLength(80) c5?: string;
  @IsOptional() @IsString() @MaxLength(80) c6?: string;
  @IsOptional() @IsString() @MaxLength(80) c7?: string;
  @IsOptional() @IsString() @MaxLength(80) c8?: string;

  /** The reader's word for this register, used in the filename. */
  @IsOptional() @IsString() @MaxLength(60) fileLabel?: string;

  /**
   * The operator's own date, so the filename says the day they took it.
   *
   * Constrained to the shape, then re-validated as a real date below:
   * a string reaching a filename must be provably harmless, and
   * `2026-13-45` would be neither a date nor a lie worth carrying.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  /** Translated enum values, as `KEY:label` pairs. */
  @IsOptional() @IsString() @MaxLength(400) statuses?: string;
  @IsOptional() @IsString() @MaxLength(400) roles?: string;
  @IsOptional() @IsString() @MaxLength(400) userStatuses?: string;
  @IsOptional() @IsString() @MaxLength(2000) actions?: string;

  @IsOptional() @IsString() @MaxLength(60) passwordSet?: string;
  @IsOptional() @IsString() @MaxLength(60) passwordPending?: string;

  /** The supplied date when it is a real one, otherwise the server's. */
  safeDate(): string {
    if (this.date) {
      const parsed = new Date(`${this.date}T00:00:00Z`);
      if (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === this.date
      ) {
        return this.date;
      }
    }
    return new Date().toISOString().slice(0, 10);
  }

  statusLabel(key: string): string | undefined {
    return decodePairs(this.statuses)[key];
  }

  roleLabel(key: string): string | undefined {
    return decodePairs(this.roles)[key];
  }

  userStatusLabel(key: string): string | undefined {
    return decodePairs(this.userStatuses)[key];
  }

  actionLabel(key: string): string | undefined {
    return decodePairs(this.actions)[key];
  }
}

/**
 * `KEY:label,KEY:label` into a lookup.
 *
 * A missing or malformed pair simply does not translate — the caller
 * falls back to the machine key, which is worse to read but never
 * wrong.
 */
function decodePairs(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const at = pair.indexOf(":");
    if (at <= 0) continue;
    const key = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (key !== "" && value !== "") out[key] = value;
  }
  return out;
}
