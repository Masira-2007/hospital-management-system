const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const LOGIN_PATH = "/api/auth/login";

export function loginChallengeCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-jrxpert_login_challenge"
    : "jrxpert_login_challenge";
}

export function readLoginChallengeToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const name = loginChallengeCookieName();
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function createLoginChallengeCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${loginChallengeCookieName()}=${token}; HttpOnly; Path=${LOGIN_PATH}; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearLoginChallengeCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${loginChallengeCookieName()}=; HttpOnly; Path=${LOGIN_PATH}; SameSite=Strict; Max-Age=0${secure}`;
}
