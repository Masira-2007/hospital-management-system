import type { NextRequest } from "next/server";
import { proxyAuthSession } from "@/lib/auth-session-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return proxyAuthSession(request, "sessions", "GET");
}
