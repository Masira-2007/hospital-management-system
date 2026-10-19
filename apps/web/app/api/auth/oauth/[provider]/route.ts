import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function apiBase(): URL | null {
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

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  if (provider !== "google" && provider !== "apple") return safeRedirect(request, "error");
  const mode = request.nextUrl.searchParams.get("mode") ?? "HOSPITAL";
  if (!(mode === "HOSPITAL" || mode === "PATIENT" || mode === "SUPER_ADMIN")) return safeRedirect(request, "error", mode);
  const base = apiBase();
  if (!base) return safeRedirect(request, "unavailable", mode, provider);

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const url = new URL(`auth/oauth/${provider}/start`, `${base.toString().replace(/\/$/, "")}/`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: process.env.WEB_ORIGIN?.split(",")[0]?.trim() ?? request.nextUrl.origin,
      },
      body: JSON.stringify({ state, nonce, codeChallenge, mode, rememberMe: request.nextUrl.searchParams.get("rememberMe") === "true" }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => null) as { authorizationUrl?: string } | null;
    if (!response.ok || !result?.authorizationUrl) return safeRedirect(request, "unavailable", mode, provider);
    const authorizationUrl = new URL(result.authorizationUrl);
    const allowedHost = provider === "google" ? "accounts.google.com" : "appleid.apple.com";
    if (authorizationUrl.protocol !== "https:" || authorizationUrl.hostname !== allowedHost || authorizationUrl.username || authorizationUrl.password) {
      return safeRedirect(request, "error", mode, provider);
    }

    const responseToBrowser = NextResponse.redirect(authorizationUrl, 303);
    const secure = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true,
      secure,
      sameSite: secure ? "none" as const : "lax" as const,
      path: `/api/auth/oauth/${provider}`,
      maxAge: 600,
    };
    responseToBrowser.cookies.set(cookieName(provider, "state"), state, cookieOptions);
    responseToBrowser.cookies.set(cookieName(provider, "nonce"), nonce, cookieOptions);
    responseToBrowser.cookies.set(cookieName(provider, "verifier"), codeVerifier, cookieOptions);
    responseToBrowser.cookies.set(cookieName(provider, "mode"), mode, cookieOptions);
    responseToBrowser.headers.set("Cache-Control", "no-store");
    responseToBrowser.headers.set("Referrer-Policy", "no-referrer");
    return responseToBrowser;
  } catch {
    return safeRedirect(request, "unavailable", mode, provider);
  }
}

function cookieName(provider: string, field: "state" | "nonce" | "verifier" | "mode") {
  return `jrxpert_oauth_${provider}_${field}`;
}

function safeRedirect(request: NextRequest, outcome: "unavailable" | "error", mode?: string, provider?: string) {
  const isAdmin = mode === "SUPER_ADMIN";
  const destination = new URL(isAdmin ? "/super-admin/login" : "/login", request.nextUrl.origin);
  destination.searchParams.set("oauth", outcome);
  if (mode === "HOSPITAL" || mode === "PATIENT" || mode === "SUPER_ADMIN") destination.searchParams.set("mode", mode);
  if (provider) destination.searchParams.set("provider", provider);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
