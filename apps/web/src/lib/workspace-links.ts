export function safeWorkspaceReturn(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  // Accept only workspace routes and a job UUID, never arbitrary redirects.
  return /^(\/|\/jobs|\/exports)(?:\?job=([a-f0-9-]{36}))?$/.test(value) ? value : "/";
}
