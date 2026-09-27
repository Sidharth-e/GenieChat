import { ArtifactSummary, ArtifactDetail } from "./types";

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;

  if (!response.ok) {
    const payload =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as ApiErrorPayload)
        : null;
    const message =
      payload?.error ||
      payload?.message ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return parsedBody as T;
}

export async function getArtifacts(
  search?: string,
  type?: string,
): Promise<ArtifactSummary[]> {
  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  if (type?.trim()) params.set("type", type.trim());
  const query = params.toString();
  const response = await fetch(
    query ? `/api/artifacts?${query}` : "/api/artifacts",
    { cache: "no-store" },
  );
  return parseResponse<ArtifactSummary[]>(response);
}

export async function getArtifact(id: string): Promise<ArtifactDetail> {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  return parseResponse<ArtifactDetail>(response);
}

export async function deleteArtifact(id: string): Promise<void> {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  await parseResponse<{ success: true }>(response);
}
