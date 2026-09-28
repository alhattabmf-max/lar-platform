/**
 * The query an export route reads, built by whoever asked for the file.
 *
 * A PLAIN MODULE, ON PURPOSE. It has no directive, so a Server
 * Component and a Client Component may both call it. It lived in
 * `export-to-excel.tsx` — a `"use client"` module — which made every
 * server render that called it throw at request time: a client module's
 * exports are client REFERENCES, not functions, and calling one on the
 * server is not something TypeScript, `next build`, or a component test
 * can see.
 *
 * Kept beside the button rather than inlined at each call site because
 * the API's DTO names the parameters `c1…c8`, and spelling those by
 * hand at four call sites is four chances to send `c3` where `c4` was
 * meant.
 */
export function exportLabelQuery(input: {
  columns: readonly string[];
  fileLabel: string;
  /** The reader's own day, so the filename says when they took it. */
  date: string;
  statuses?: Record<string, string>;
  roles?: Record<string, string>;
  userStatuses?: Record<string, string>;
  actions?: Record<string, string>;
  passwordSet?: string;
  passwordPending?: string;
}): URLSearchParams {
  const query = new URLSearchParams();

  input.columns.forEach((header, index) => {
    query.set(`c${index + 1}`, header);
  });
  query.set("fileLabel", input.fileLabel);
  query.set("date", input.date);

  for (const [name, pairs] of [
    ["statuses", input.statuses],
    ["roles", input.roles],
    ["userStatuses", input.userStatuses],
    ["actions", input.actions],
  ] as const) {
    if (!pairs) continue;
    query.set(
      name,
      Object.entries(pairs)
        // A comma or a colon inside a label would break the pairs
        // apart, so they are dropped rather than escaped — a heading is
        // decoration and losing a comma from one costs nothing.
        .map(([key, value]) => `${key}:${value.replaceAll(/[,:]/g, " ")}`)
        .join(","),
    );
  }

  if (input.passwordSet) query.set("passwordSet", input.passwordSet);
  if (input.passwordPending)
    query.set("passwordPending", input.passwordPending);

  return query;
}
