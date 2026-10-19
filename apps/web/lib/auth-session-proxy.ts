import { NextResponse, type NextRequest } from "next/server";
import { configuredApiBase } from "@/lib/api-base";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
const SAFE_SESSION_ID = /^[a-z0-9_-]{1,64}$/i;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ statusCode: status, code, message }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function sessionCookie(request: NextRequest): string | null {
  const values = request.cookies.getAll(SESSION_COOKIE);
  if (values.length !== 1 || !/^[a-f0-9]{64}$/i.test(values[0].value)) return null;
  return `${SESSION_COOKIE}=${values[0].value}`;
}

function resolveTarget(path: string, method: "GET" | "POST" | "DELETE"): string | null {
  if (path === "sessions" && method === "GET") return "auth/sessions";
  if (path === "sessions/revoke-others" && method === "POST") return "auth/sessions/revoke-others";
  if (method === "DELETE") {
    const match = /^sessions\/([a-z0-9_-]{1,64})$/i.exec(path);
    if (match && SAFE_SESSION_ID.test(match[1])) return `auth/sessions/${encodeURIComponent(match[1])}`;
  }
  return null;
}

export async function proxyAuthSession(request: NextRequest, path: string, method: "GET" | "POST" | "DELETE") {
  const targetPath = resolveTarget(path, method);
  if (!targetPath) return errorResponse(404, "NOT_FOUND", "The requested endpoint was not found.");

  if (method !== "GET") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return errorResponse(403, "ORIGIN_NOT_ALLOWED", "This request could not be verified.");
  }

  const base = configuredApiBase();
  if (!base) return errorResponse(503, "API_NOT_CONFIGURED", "Secure account management is not available yet.");
  const cookie = sessionCookie(request);
  if (!cookie) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in again to manage account sessions.");

  const target = new URL(targetPath, `${base.toString().replace(/\/$/, "")}/`);
  try {
    const response = await fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        Origin: process.env.WEB_ORIGIN?.split(",")[0]?.trim() ?? new URL(request.url).origin,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if (response.status === 401) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in again to manage account sessions.");
      if (response.status === 429) return errorResponse(429, "RATE_LIMITED", "Too many requests. Try again later.");
      return errorResponse(response.status >= 500 ? 503 : response.status, "SESSION_ACTION_FAILED", "The session request could not be completed.");
    }

    const headers = new Headers({ "Cache-Control": "no-store", Pragma: "no-cache" });
    if (response.status === 204) return new NextResponse(null, { status: 204, headers });
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Buffer.byteLength(JSON.stringify(body)) > 32_768) {
      return errorResponse(502, "UPSTREAM_ERROR", "The service returned an invalid response.");
    }
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new NextResponse(JSON.stringify(body), { status: response.status, headers });
  } catch {
    return errorResponse(503, "SERVICE_UNAVAILABLE", "Account sessions are temporarily unavailable. Try again later.");
  }
}
