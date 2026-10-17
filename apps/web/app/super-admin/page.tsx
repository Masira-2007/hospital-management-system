import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PlatformDashboard } from "@/components/onboarding-forms";
import "../auth.css";
import "../onboarding.css";

export const metadata: Metadata = { title: "Platform administration | JR Xpert HMS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type IdentityResponse = { user?: { id: string; email: string; displayName: string }; memberships?: Array<{ role: string; hospital: { id: string } | null }> };

export default async function SuperAdminPage() {
  const cookieStore = await cookies();
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
  const token = cookieStore.get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) redirect("/super-admin/login");
  const configured = process.env.JR_XPERT_API_URL;
  if (!configured) return <main className="onboarding-page"><section className="onboarding-card"><h1>Platform service unavailable</h1><p>Platform administration is not configured. Contact the system operator.</p></section></main>;

  let response: Response;
  try {
    const api = new URL(configured);
    if (api.username || api.password || api.search || api.hash || (process.env.NODE_ENV === "production" && api.protocol !== "https:")) throw new Error("invalid API service");
    api.pathname = "/api/v1/auth/me";
    response = await fetch(api, { headers: { Cookie: `${cookieName}=${token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    return <main className="onboarding-page"><section className="onboarding-card"><h1>Platform service unavailable</h1><p>We couldn’t verify the secure session with the platform API.</p></section></main>;
  }
  if (response.status === 401) redirect("/super-admin/login");
  if (!response.ok) return <main className="onboarding-page"><section className="onboarding-card"><h1>Platform service unavailable</h1><p>We couldn’t verify the secure session. Try again shortly.</p></section></main>;
  const identity = await response.json() as IdentityResponse;
  const hasPlatformRole = identity.memberships?.some(({ role, hospital }) => (role === "SUPER_ADMIN" || role === "PLATFORM_ADMIN") && hospital === null);
  if (!identity.user || !hasPlatformRole) redirect("/super-admin/login");
  return <PlatformDashboard identity={{ name: identity.user.displayName, email: identity.user.email }}/>;
}
