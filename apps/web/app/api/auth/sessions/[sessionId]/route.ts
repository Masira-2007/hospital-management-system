import type { NextRequest } from "next/server";
import { proxyAuthSession } from "@/lib/auth-session-proxy";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/auth/sessions/[sessionId]">) {
  const { sessionId } = await context.params;
  return proxyAuthSession(request, `sessions/${sessionId}`, "DELETE");
}
