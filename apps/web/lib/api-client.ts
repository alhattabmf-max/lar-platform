const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * All business logic lives in apps/api (Blueprint §Non-Negotiable
 * Architecture Decisions). This helper is intentionally thin: it only
 * knows how to reach the API and surface its Error Envelope shape —
 * it makes no decisions of its own.
 */
export async function fetchHealth(): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
  return response.json();
}
