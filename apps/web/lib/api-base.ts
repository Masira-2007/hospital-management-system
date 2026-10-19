export function configuredApiBase(): URL | null {
  const configured = process.env.JR_XPERT_API_URL;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const path = url.pathname.replace(/\/$/, "");
    if (url.username || url.password || url.search || url.hash || (path && path !== "/api/v1")) return null;
    if (process.env.NODE_ENV === "production" ? url.protocol !== "https:" : url.protocol !== "https:" && !local) return null;
    url.pathname = "/api/v1";
    return url;
  } catch {
    return null;
  }
}
