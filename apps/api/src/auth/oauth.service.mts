import { Injectable, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import type { Prisma, MembershipRole } from "@prisma/client";
import { calculatePKCECodeChallenge } from "openid-client";
import { createSessionToken, hashRateLimitKey, hashSessionToken } from "../security/security.crypto.mjs";
import { getHeader, type RequestLike, type ResponseLike } from "./auth.types.mjs";
import { sessionCookieName } from "./session-auth.guard.mjs";
import { OAuthCallbackDto, OAuthStartDto } from "./oauth.dto.mjs";
import { OidcClientService, type OAuthProvider } from "./oidc-client.service.mjs";
import { PrismaService } from "../database/prisma.service.mjs";

const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const invalidLogin = () => new UnauthorizedException({ code: "AUTHENTICATION_FAILED", message: "Sign-in could not be verified." });

type OAuthMode = "HOSPITAL" | "PATIENT" | "SUPER_ADMIN";

@Injectable()
export class OAuthService {
  constructor(private readonly prisma: PrismaService, private readonly oidc: OidcClientService) {}

  async start(provider: OAuthProvider, body: OAuthStartDto, request: RequestLike) {
    this.assertProvider(provider);
    await this.consumeAttempt(`start:${provider}`, request.ip ?? "unknown");
    const now = new Date();
    const url = await this.oidc.createAuthorizationUrl(provider, {
      state: body.state,
      nonce: body.nonce,
      codeChallenge: body.codeChallenge,
    });
    await this.prisma.$transaction(async (transaction) => {
      await transaction.oAuthLoginTransaction.deleteMany({ where: { expiresAt: { lt: now } } });
      const pending = await transaction.oAuthLoginTransaction.create({
        data: {
          provider,
          mode: body.mode,
          stateHash: hashRateLimitKey(`oauth-state:${provider}:${body.state}`),
          nonceHash: hashRateLimitKey(`oauth-nonce:${provider}:${body.nonce}`),
          codeChallenge: body.codeChallenge,
          rememberMe: body.rememberMe ?? false,
          expiresAt: new Date(now.getTime() + TRANSACTION_LIFETIME_MS),
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "auth.oauth_started",
          resourceType: "oauth_transaction",
          resourceId: pending.id,
          metadata: { provider, loginMode: body.mode } as Prisma.InputJsonObject,
        },
      });
      return pending;
    });
    return { authorizationUrl: url, expiresInSeconds: TRANSACTION_LIFETIME_MS / 1000 };
  }

  async callback(provider: OAuthProvider, body: OAuthCallbackDto, request: RequestLike, response: ResponseLike) {
    this.assertProvider(provider);
    const stateHash = hashRateLimitKey(`oauth-state:${provider}:${body.state}`);
    const nonceHash = hashRateLimitKey(`oauth-nonce:${provider}:${body.nonce}`);
    const now = new Date();
    const pending = await this.prisma.oAuthLoginTransaction.findUnique({
      where: { stateHash },
      select: { id: true, provider: true, mode: true, nonceHash: true, codeChallenge: true, rememberMe: true, expiresAt: true, usedAt: true },
    });
    const actualChallenge = await calculatePKCECodeChallenge(body.codeVerifier);
    if (!pending || pending.provider !== provider || pending.nonceHash !== nonceHash || pending.codeChallenge !== actualChallenge || pending.usedAt || pending.expiresAt <= now) {
      await this.consumeAttempt(`callback:${provider}`, request.ip ?? "unknown");
      await this.recordFailedLogin(provider);
      throw invalidLogin();
    }

    await this.consumeAttempt(`callback:${provider}`, request.ip ?? "unknown");
    let identity: Awaited<ReturnType<OidcClientService["verifyAuthorizationCode"]>>;
    try {
      identity = await this.oidc.verifyAuthorizationCode(provider, {
        code: body.code,
        state: body.state,
        nonce: body.nonce,
        codeVerifier: body.codeVerifier,
      });
    } catch {
      await this.recordFailedLogin(provider);
      throw invalidLogin();
    }
    const token = createSessionToken();
    const userAgent = getHeader(request, "user-agent")?.slice(0, 512) ?? null;
    const result = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.oAuthLoginTransaction.updateMany({
        where: { id: pending.id, stateHash, nonceHash, provider, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return null;

      const linked = await transaction.externalIdentity.findUnique({
        where: { provider_subject: { provider, subject: identity.subject } },
        select: { userId: true },
      });
      const account = await transaction.user.findUnique({
        where: linked ? { id: linked.userId } : { email: identity.email },
        include: { memberships: {
          where: {
            status: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            organization: { status: "ACTIVE" },
            AND: [{ OR: [{ hospitalId: null }, { hospital: { is: { status: "ACTIVE" } } }] }],
          },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
            hospital: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        } },
      });
      if (!account || account.status !== "ACTIVE" || !account.emailVerifiedAt) return null;

      const allowedMemberships = account.memberships.filter(({ role, hospitalId, branchId }) => this.roleMatches(pending.mode as OAuthMode, role, hospitalId, branchId));
      if (!allowedMemberships.length || (pending.mode === "SUPER_ADMIN" && !account.mfaEnabled)) return null;

      if (!linked) {
        await transaction.externalIdentity.create({
          data: { provider, subject: identity.subject, userId: account.id },
        });
      }

      const expiresAt = new Date(Date.now() + (pending.rememberMe ? REMEMBERED_SESSION_DURATION_MS : SESSION_DURATION_MS));
      const session = await transaction.session.create({
        data: { userId: account.id, tokenHash: hashSessionToken(token), userAgent, expiresAt, lastUsedAt: now },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: account.id,
          action: "auth.oauth_login_succeeded",
          resourceType: "session",
          resourceId: session.id,
          metadata: { provider, loginMode: pending.mode } as Prisma.InputJsonObject,
        },
      });
      await transaction.authRateLimit.deleteMany({
        where: { keyHash: hashRateLimitKey(`oauth:callback:${provider}:${request.ip ?? "unknown"}`) },
      });
      return { account, allowedMemberships, session, expiresAt, mode: pending.mode as OAuthMode };
    });

    if (!result) {
      await this.recordFailedLogin(provider);
      throw invalidLogin();
    }
    response.setHeader("Set-Cookie", this.createSessionCookie(token, result.expiresAt));
    return {
      mode: result.mode,
      user: { id: result.account.id, email: result.account.email, displayName: result.account.displayName },
      memberships: result.allowedMemberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        department: membership.department,
        organization: membership.organization,
        hospital: membership.hospital,
        branch: membership.branch,
      })),
      session: { id: result.session.id, expiresAt: result.expiresAt.toISOString() },
    };
  }

  private roleMatches(mode: OAuthMode, role: MembershipRole, hospitalId: string | null, branchId: string | null): boolean {
    if (mode === "PATIENT") return role === "PATIENT";
    if (mode === "SUPER_ADMIN") return (role === "SUPER_ADMIN" || role === "PLATFORM_ADMIN") && hospitalId === null && branchId === null;
    return role !== "PATIENT";
  }

  private assertProvider(provider: string): asserts provider is OAuthProvider {
    if (provider !== "google" && provider !== "apple") throw invalidLogin();
  }

  private createSessionCookie(token: string, expiresAt: Date): string {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${sessionCookieName()}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  private async recordFailedLogin(provider: OAuthProvider): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { action: "auth.oauth_login_failed", resourceType: "authentication", metadata: { provider } as Prisma.InputJsonObject },
    });
  }

  private async consumeAttempt(action: string, ip: string): Promise<void> {
    const keyHash = hashRateLimitKey(`oauth:${action}:${ip}`);
    const now = Date.now();
    const windowStartedAt = new Date(now);
    const existing = await this.prisma.authRateLimit.findUnique({ where: { keyHash } });
    const row = existing && now - existing.windowStartedAt.getTime() < RATE_WINDOW_MS
      ? await this.prisma.authRateLimit.update({ where: { keyHash }, data: { failedAttempts: { increment: 1 } } })
      : await this.prisma.authRateLimit.upsert({
          where: { keyHash },
          create: { keyHash, failedAttempts: 1, windowStartedAt },
          update: { failedAttempts: 1, windowStartedAt },
        });
    if (row.failedAttempts > MAX_ATTEMPTS) throw new HttpException("Too many sign-in attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
  }
}
