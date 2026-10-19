import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ provider: string }> };
type CallbackFields = { code?: string; state?: string; error?: string };
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";

export async function GET(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  return finish(request, provider, {
    code: request.nextUrl.searchParams.get("code") ?? undefined,
    state: request.nextUrl.searchParams.get("state") ?? undefined,
    error: request.nextUrl.searchParams.get("error") ?? undefined,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (provider !== "apple" || !contentType.startsWith("application/x-www-form-urlencoded")) return safeRedirect(request, provider, "error");
  try {
    const form = await request.formData();
    return finish(request, provider, {
      code: typeof form.get("code") === "string" ? String(form.get("code")) : undefined,
      state: typeof form.get("state") === "string" ? String(form.get("state")) : undefined,
      error: typeof form.get("error") === "string" ? String(form.get("error")) : undefined,
    });
  } catch {
    return safeRedirect(request, provider, "error");
  }
}

async function finish(request: NextRequest, provider: string, fields: CallbackFields) {
  if (provider !== "google" && provider !== "apple") return safeRedirect(request, provider, "error");
  const state = fields.state ?? "";
  const stateCookie = request.cookies.get(cookieName(provider, "state"))?.value ?? "";
  const nonce = request.cookies.get(cookieName(provider, "nonce"))?.value ?? "";
  const codeVerifier = request.cookies.get(cookieName(provider, "verifier"))?.value ?? "";
  const mode = request.cookies.get(cookieName(provider, "mode"))?.value ?? "HOSPITAL";
  if (fields.error || !fields.code || fields.code.length > 4096 || !/^[A-Za-z0-9_-]{43,128}$/.test(state) || !equalConstantTime(state, stateCookie) || !/^[A-Za-z0-9_-]{43,128}$/.test(nonce) || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) {
    return safeRedirect(request, provider, mode, "error");
  }

  const base = getApiBase();
  if (!base) return safeRedirect(request, provider, mode, "unavailable");
  try {
    const target = new URL(`auth/oauth/${provider}/callback`, `${base.toString().replace(/\/$/, "")}/`);
    const apiResponse = await fetch(target, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: process.env.WEB_ORIGIN?.split(",")[0]?.trim() ?? request.nextUrl.origin,
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ code: fields.code, state, nonce, codeVerifier }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!apiResponse.ok) return safeRedirect(request, provider, mode, "error");
    const result = await apiResponse.json().catch(() => null) as { mode?: string } | null;
    const authenticatedMode = result?.mode;
    const redirectPath = authenticatedMode === "SUPER_ADMIN" ? "/super-admin" : authenticatedMode === "PATIENT" || authenticatedMode === "HOSPITAL" ? "/workspace" : null;
    const setCookie = apiResponse.headers.get("set-cookie");
    if (!redirectPath || !validSessionCookie(setCookie)) return safeRedirect(request, provider, mode, "error");

    const response = NextResponse.redirect(new URL(redirectPath, request.nextUrl.origin), 303);
    response.headers.append("Set-Cookie", setCookie);
    clearOAuthCookies(response, provider);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return safeRedirect(request, provider, mode, "unavailable");
  }
}

function getApiBase(): URL | null {
  const configured = process.env.JR_XPERT_API_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.username || url.password || url.search || url.hash || (process.env.NODE_ENV === "production" && url.protocol !== "https:") || (url.protocol !== "https:" && !local)) return null;
    const path = url.pathname.replace(/\/$/, "");
    if (path && path !== "/api/v1") return null;
    url.pathname = "/api/v1";
    return url;
  } catch {
    return null;
  }
}

function cookieName(provider: string, field: "state" | "nonce" | "verifier" | "mode") {
  return `jrxpert_oauth_${provider}_${field}`;
}

function equalConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function validSessionCookie(value: string | null): value is string {
  if (!value) return false;
  const token = value.match(new RegExp(`^${SESSION_COOKIE}=([a-f0-9]{64});`, "i"))?.[1];
  return Boolean(token && /httponly/i.test(value) && /path=\//i.test(value) && /samesite=strict/i.test(value) && (process.env.NODE_ENV !== "production" || /;\s*secure/i.test(value)));
}

function clearOAuthCookies(response: NextResponse, provider: string) {
  const secure = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" as const : "lax" as const,
    path: `/api/auth/oauth/${provider}`,
    maxAge: 0,
  };
  for (const field of ["state", "nonce", "verifier", "mode"] as const) response.cookies.set(cookieName(provider, field), "", options);
}

function safeRedirect(request: NextRequest, provider: string, mode = "HOSPITAL", outcome: "error" | "unavailable" = "error") {
  const destination = new URL(mode === "SUPER_ADMIN" ? "/super-admin/login" : "/login", request.nextUrl.origin);
  destination.searchParams.set("oauth", outcome);
  if (mode === "HOSPITAL" || mode === "PATIENT" || mode === "SUPER_ADMIN") destination.searchParams.set("mode", mode);
  if (provider === "google" || provider === "apple") destination.searchParams.set("provider", provider);
  const response = NextResponse.redirect(destination, 303);
  if (provider === "google" || provider === "apple") clearOAuthCookies(response, provider);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
