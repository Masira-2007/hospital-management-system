import { NextResponse, type NextRequest } from "next/server";
import { configuredApiBase } from "@/lib/api-base";

const actions = new Set(["login", "logout", "me", "forgot-password", "reset-password", "select-membership"]);
const sessionCookie = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
const challengeCookie = process.env.NODE_ENV === "production" ? "__Secure-jrxpert_login_challenge" : "jrxpert_login_challenge";
export const runtime = "nodejs";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ statusCode: status, code, message }, {
    status,
    headers: { "Cache-Control": "no-store", "Pragma": "no-cache" },
  });
}

function safeAuthCookies(request: NextRequest): string | null {
  const pairs: string[] = [];
  const rawCookieHeader = request.headers.get("cookie") ?? "";
  for (const name of [sessionCookie, challengeCookie]) {
    const matches = rawCookieHeader.split(";").map((part) => part.trim()).filter((part) => part.slice(0, part.indexOf("=")).trim() === name);
    if (matches.length !== 1) continue;
    const value = matches[0].slice(name.length + 1);
    if (/^[a-f0-9]{64}$/i.test(value)) pairs.push(`${name}=${value}`);
  }
  return pairs.length ? pairs.join("; ") : null;
}

async function proxy(request: NextRequest, action: string, method: "GET" | "POST") {
  if (!actions.has(action) || (action === "me") !== (method === "GET")) {
    return jsonError(404, "NOT_FOUND", "The requested endpoint was not found.");
  }
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return jsonError(403, "ORIGIN_NOT_ALLOWED", "This request could not be verified.");
    }
  }
  const base = configuredApiBase();
  if (!base) {
    return jsonError(503, "API_NOT_CONFIGURED", "Secure sign-in is not available yet. Contact your hospital administrator.");
  }

  let body: string | undefined;
  if (method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return jsonError(415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON request.");
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return jsonError(413, "REQUEST_TOO_LARGE", "Request is too large.");
    }
    const raw = await request.text();
    if (raw.length > 16_384) return jsonError(413, "REQUEST_TOO_LARGE", "Request is too large.");
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      body = JSON.stringify(parsed);
    } catch {
      return jsonError(400, "INVALID_REQUEST", "Check the submitted information and try again.");
    }
  }

  const path = action === "me" ? "auth/me" : `auth/${action}`;
  const target = new URL(path, `${base.toString().replace(/\/$/, "")}/`);
  const requestCookie = safeAuthCookies(request);
  try {
    const response = await fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        Origin: process.env.WEB_ORIGIN?.split(",")[0]?.trim() ?? new URL(request.url).origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(requestCookie ? { Cookie: requestCookie } : {}),
        ...(request.headers.get("x-organization-id") ? { "x-organization-id": request.headers.get("x-organization-id")! } : {}),
        ...(request.headers.get("x-hospital-id") ? { "x-hospital-id": request.headers.get("x-hospital-id")! } : {}),
        ...(request.headers.get("x-branch-id") ? { "x-branch-id": request.headers.get("x-branch-id")! } : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) return jsonError(401, "AUTHENTICATION_FAILED", "Email, password, or verification code is invalid.");
      if (response.status === 429) return jsonError(429, "RATE_LIMITED", "Too many requests. Try again later.");
      if (response.status === 503 && action === "forgot-password" && responseBody && typeof responseBody === "object" && "code" in responseBody && responseBody.code === "PASSWORD_RECOVERY_NOT_CONFIGURED") {
        return jsonError(503, "PASSWORD_RECOVERY_NOT_CONFIGURED", "Password recovery is not configured. Contact your hospital administrator.");
      }
      if (response.status === 503 && action === "login" && responseBody && typeof responseBody === "object" && "code" in responseBody && responseBody.code === "LOGIN_EMAIL_NOT_CONFIGURED") {
        return jsonError(503, "LOGIN_EMAIL_NOT_CONFIGURED", "Email verification is not configured yet. Contact your administrator.");
      }
      if (response.status === 400) return jsonError(400, "INVALID_REQUEST", "Check the submitted information and try again.");
      return jsonError(response.status >= 500 ? 503 : response.status, "SERVICE_UNAVAILABLE", "The secure service could not complete this request.");
    }
    if (responseBody !== null && (typeof responseBody !== "object" || Buffer.byteLength(JSON.stringify(responseBody)) > 32_768)) {
      return jsonError(502, "UPSTREAM_ERROR", "The service returned an invalid response.");
    }
    const headers = new Headers({ "Cache-Control": "no-store", "Pragma": "no-cache" });
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
    for (const setCookie of setCookies) headers.append("Set-Cookie", setCookie);
    if (responseBody !== null) headers.set("Content-Type", "application/json; charset=utf-8");
    return new NextResponse(responseBody === null ? null : JSON.stringify(responseBody), {
      status: response.status,
      headers,
    });
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "The secure service is temporarily unavailable. Try again later.");
  }
}

type RouteContext = { params: Promise<{ action: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  return proxy(request, action, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  return proxy(request, action, "POST");
}
