import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/auth/[action]/route.js";

const sessionCookieName = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
const challengeCookieName = process.env.NODE_ENV === "production" ? "__Secure-jrxpert_login_challenge" : "jrxpert_login_challenge";

async function withApiProxyEnvironment(run: (calls: Array<{ url: string; cookie: string | null }>) => Promise<void>) {
  const priorApiUrl = process.env.JR_XPERT_API_URL;
  const priorFetch = globalThis.fetch;
  const calls: Array<{ url: string; cookie: string | null }> = [];
  process.env.JR_XPERT_API_URL = "https://api.example.test/api/v1";
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), cookie: headers.get("cookie") });
    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    responseHeaders.append("Set-Cookie", `${challengeCookieName}=b${"b".repeat(63)}; HttpOnly; Path=/api/auth/login; SameSite=Strict; Max-Age=600`);
    responseHeaders.append("Set-Cookie", `${sessionCookieName}=${"c".repeat(64)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`);
    return new Response(JSON.stringify({ requiresEmailCode: true, emailHint: "m•••@example.test" }), { status: 202, headers: responseHeaders });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorApiUrl === undefined) delete process.env.JR_XPERT_API_URL;
    else process.env.JR_XPERT_API_URL = priorApiUrl;
  }
}

test("auth proxy forwards only the allowlisted session and challenge cookies and preserves separate Set-Cookie headers", async () => {
  const session = "a".repeat(64);
  const challenge = "d".repeat(64);
  await withApiProxyEnvironment(async (calls) => {
    const request = new NextRequest("https://hms.example.test/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://hms.example.test",
        "content-type": "application/json",
        cookie: `${sessionCookieName}=${session}; ${challengeCookieName}=${challenge}; attacker_cookie=do-not-forward`,
      },
      body: JSON.stringify({ email: "person@example.test", password: "synthetic password", mode: "HOSPITAL", emailCode: "123456" }),
    });

    const response = await POST(request, { params: Promise.resolve({ action: "login" }) });
    assert.equal(response.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/api/v1/auth/login");
    assert.equal(calls[0].cookie, `${sessionCookieName}=${session}; ${challengeCookieName}=${challenge}`);
    assert.deepEqual(response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]), [
      `${challengeCookieName}=b${"b".repeat(63)}`,
      `${sessionCookieName}=${"c".repeat(64)}`,
    ]);
  });
});

test("auth proxy drops duplicate challenge cookies instead of forwarding an ambiguous bearer", async () => {
  const session = "e".repeat(64);
  const challenge = "f".repeat(64);
  await withApiProxyEnvironment(async (calls) => {
    const request = new NextRequest("https://hms.example.test/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://hms.example.test",
        "content-type": "application/json",
        cookie: `${sessionCookieName}=${session}; ${challengeCookieName}=${challenge}; ${challengeCookieName}=${challenge}`,
      },
      body: JSON.stringify({ email: "person@example.test", password: "synthetic password", mode: "HOSPITAL", emailCode: "123456" }),
    });
    const response = await POST(request, { params: Promise.resolve({ action: "login" }) });
    assert.equal(response.status, 202);
    assert.equal(calls[0].cookie, `${sessionCookieName}=${session}`);
  });
});
