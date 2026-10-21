const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LEGACY_STRICT_SSL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

/**
 * Keep remote Postgres connections on certificate- and hostname-verified TLS.
 * pg-connection-string currently treats `require` as `verify-full`, but that
 * alias changes in its next major release; normalizing here preserves today's
 * effective security while preventing a future downgrade.
 */
export function securePostgresConnectionString(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The PostgreSQL connection URL is invalid.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("The database URL must use PostgreSQL.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const remote = !LOOPBACK_HOSTS.has(hostname);
  if (!remote) return connectionString;

  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode === "disable") {
    throw new Error("Remote PostgreSQL connections must use verified TLS.");
  }

  if (!sslMode || LEGACY_STRICT_SSL_ALIASES.has(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  }

  if (sslMode !== "verify-full") {
    throw new Error("Remote PostgreSQL connections must use sslmode=verify-full.");
  }

  return connectionString;
}
