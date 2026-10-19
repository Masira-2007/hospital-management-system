import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { configuredApiBase } from "@/lib/api-base";

export type PlatformIdentity = { name: string; email: string };

export async function requirePlatformIdentity(): Promise<PlatformIdentity | null> {
  const cookieStore = await cookies();
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
  const token = cookieStore.get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) redirect("/super-admin/login");
  const api = configuredApiBase();
  if (!api) return null;

  let response: Response;
  try {
    const endpoint = new URL("auth/me", `${api.toString().replace(/\/$/, "")}/`);
    response = await fetch(endpoint, { headers: { Cookie: `${cookieName}=${token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    return null;
  }

  if (response.status === 401) redirect("/super-admin/login");
  if (!response.ok) return null;
  let identity: {
    user?: { id: string; email: string; displayName: string };
    memberships?: Array<{ role: string; hospital: { id: string } | null }>;
  };
  try { identity = await response.json(); } catch { return null; }
  const hasPlatformRole = identity.memberships?.some(({ role, hospital }) => (role === "SUPER_ADMIN" || role === "PLATFORM_ADMIN") && hospital === null);
  if (!identity.user || !hasPlatformRole) redirect("/super-admin/login");
  return { name: identity.user.displayName, email: identity.user.email };
}
