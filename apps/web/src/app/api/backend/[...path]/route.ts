import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Map([
  ["health", "GET"],
  ["sample", "GET"],
  ["resumes", "POST"],
  ["assessments", "POST"],
  ["job-interpretations", "POST"],
]);
const MAX_BODY = 6 * 1024 * 1024;
const ID = "[0-9a-f-]{36}";
const INBOX_ROUTES = [
  { path: /^jobs$/, methods: ["GET", "POST"] },
  { path: new RegExp(`^jobs/${ID}/summary$`), methods: ["GET"] },
  { path: new RegExp(`^jobs/${ID}/batches$`), methods: ["POST"] },
  { path: new RegExp(`^jobs/${ID}/applications$`), methods: ["GET", "POST"] },
  { path: new RegExp(`^jobs/${ID}/retry$`), methods: ["POST"] },
  { path: new RegExp(`^applications/${ID}$`), methods: ["GET"] },
  { path: new RegExp(`^applications/${ID}/review$`), methods: ["PATCH"] },
  { path: new RegExp(`^applications/${ID}/retry$`), methods: ["POST"] },
  { path: new RegExp(`^jobs/${ID}/comparison$`), methods: ["GET"] },
  { path: new RegExp(`^jobs/${ID}/screening-policy$`), methods: ["PATCH"] },
  { path: new RegExp(`^jobs/${ID}/shortlist/csv$`), methods: ["GET"] },
  { path: new RegExp(`^jobs/${ID}/reassess$`), methods: ["POST"] },
  { path: new RegExp(`^jobs/${ID}/shortlist/documents$`), methods: ["GET"] },
  { path: new RegExp(`^applications/${ID}/document$`), methods: ["GET"] },
];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  const allowed =
    (path.length === 1 && ALLOWED.get(path[0]) === request.method) ||
    INBOX_ROUTES.some((entry) => entry.path.test(route) && entry.methods.includes(request.method));
  if (!allowed) {
    return NextResponse.json({ detail: "Endpoint not found." }, { status: 404 });
  }
  const protectedWorkspaceRequest =
    route === "job-interpretations" ||
    /\/(?:comparison|screening-policy|reassess|document|shortlist\/(?:documents|csv))$/.test(route);
  if (protectedWorkspaceRequest) {
    const origin = request.headers.get("origin");
    // Next.js can normalize nextUrl.hostname to localhost in development. Compare the
    // browser's actual authority to Host, while still checking the scheme and fetch metadata.
    let sameOrigin = origin === null;
    if (origin !== null) {
      try {
        const parsed = new URL(origin);
        sameOrigin =
          parsed.host === request.headers.get("host") &&
          parsed.protocol === request.nextUrl.protocol;
      } catch {
        sameOrigin = false;
      }
    }
    if (request.headers.get("sec-fetch-site") === "cross-site" || !sameOrigin) {
      return NextResponse.json(
        { detail: "Cross-origin workspace requests are not allowed." },
        { status: 403 },
      );
    }
    if (!process.env.WORKSPACE_API_KEY) {
      return NextResponse.json(
        {
          detail:
            "Configure WORKSPACE_API_KEY on the web and API servers to enable analysis and matching results.",
        },
        { status: 503 },
      );
    }
  }
  let body: Uint8Array | undefined;
  if (["POST", "PATCH"].includes(request.method) && request.body) {
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_BODY) {
      return NextResponse.json({ detail: "Files must be 5 MB or smaller." }, { status: 413 });
    }
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ detail: "Request body is required." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return NextResponse.json({ detail: "Request is too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  try {
    const base = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
    const query = new URLSearchParams();
    for (const key of ["page", "search", "status", "scope", "criterion_id", "finding_status"]) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) query.set(key, value);
    }
    const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/${route}?${query}`, {
      method: request.method,
      headers: {
        ...(body
          ? { "Content-Type": request.headers.get("content-type") ?? "application/json" }
          : {}),
        ...(protectedWorkspaceRequest
          ? { Authorization: `Bearer ${process.env.WORKSPACE_API_KEY}` }
          : {}),
      },
      body: body as BodyInit | undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const responseHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const disposition = response.headers.get("content-disposition");
    if (disposition) responseHeaders["Content-Disposition"] = disposition;
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { detail: "The API is unavailable. Start the FastAPI server and try again." },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
