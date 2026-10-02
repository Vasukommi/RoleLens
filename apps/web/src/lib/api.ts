export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    const detail =
      typeof data.detail === "string" ? data.detail : "The request could not be processed.";
    throw new Error(detail);
  }
  return data as T;
}
