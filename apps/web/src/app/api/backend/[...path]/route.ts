import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Map([
  ["health", "GET"],
  ["sample", "GET"],
  ["resumes", "POST"],
  ["assessments", "POST"],
]);
const MAX_BODY = 6 * 1024 * 1024;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length !== 1 || ALLOWED.get(path[0]) !== request.method) {
    return NextResponse.json({ detail: "Endpoint not found." }, { status: 404 });
  }
  let body: Uint8Array | undefined;
  if (request.method === "POST") {
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
    const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/${path[0]}`, {
      method: request.method,
      headers: body
        ? { "Content-Type": request.headers.get("content-type") ?? "application/json" }
        : {},
      body: body as BodyInit | undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
