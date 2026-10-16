import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  createSessionToken,
  hashPassword,
  hashRateLimitKey,
  hashSessionToken,
  performDummyPasswordCheck,
  verifyPassword,
  verifyTotp,
} from "../security/security.crypto";
import { LoginDto } from "./login.dto";
import { ChangePasswordDto } from "./change-password.dto";
import { getHeader, RequestLike, ResponseLike } from "./auth.types";
import { SessionAuthGuard, sessionCookieName } from "./session-auth.guard";

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const PRIVILEGED_ROLES = new Set([
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "HOSPITAL_ADMIN",
  "HOSPITAL_MANAGER",
  "MEDICAL_DIRECTOR",
  "SECURITY_AUDITOR",
]);

const authenticationFailure = () => new UnauthorizedException({
  code: "AUTHENTICATION_FAILED",
  message: "Email, password, or second factor is invalid.",
});

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  private throttleCleanupCounter = 0;

  constructor(private readonly prisma: PrismaService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Create a secure, server-managed session for a verified hospital account" })
  async login(@Body() body: LoginDto, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    const email = body.email.trim().toLowerCase();
    const keys = this.getRateKeys(email, request.ip ?? "unknown");
    await this.consumeLoginAttempt(keys);

    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: {
            status: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
            hospital: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) await performDummyPasswordCheck(body.password);
    const passwordIsValid = user
      ? await verifyPassword(body.password, user.passwordHash)
      : false;
    const accountIsValid = Boolean(
      user && user.status === "ACTIVE" && user.emailVerifiedAt && user.memberships.length > 0,
    );
    const hasPrivilegedRole = user?.memberships.some((membership) => PRIVILEGED_ROLES.has(membership.role)) ?? false;
    let matchedMfaCounter: bigint | null = null;
    let mfaIsValid = true;

    if (user?.mfaEnabled) {
      matchedMfaCounter = body.mfaCode && user.mfaSecretEncrypted
        ? verifyTotp(user.mfaSecretEncrypted, body.mfaCode)
        : null;
      mfaIsValid = matchedMfaCounter !== null && (user.mfaLastUsedCounter === null || matchedMfaCounter > user.mfaLastUsedCounter);
    } else if (hasPrivilegedRole) {
      mfaIsValid = false;
    }

    if (!passwordIsValid || !accountIsValid || !mfaIsValid || !user) {
      await this.recordAuthenticationFailure(keys, user?.id);
      throw authenticationFailure();
    }

    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const userAgent = getHeader(request, "user-agent")?.slice(0, 512) ?? null;
    const session = await this.prisma.$transaction(async (transaction) => {
      if (matchedMfaCounter !== null) {
        const consumed = await transaction.user.updateMany({
          where: {
            id: user.id,
            OR: [
              { mfaLastUsedCounter: null },
              { mfaLastUsedCounter: { lt: matchedMfaCounter } },
            ],
          },
          data: { mfaLastUsedCounter: matchedMfaCounter },
        });
        if (consumed.count !== 1) return null;
      }

      const created = await transaction.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(rawToken),
          userAgent,
          expiresAt,
          lastUsedAt: now,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: user.id,
          action: "auth.login_succeeded",
          resourceType: "session",
          resourceId: created.id,
          metadata: { membershipCount: user.memberships.length, mfaVerified: user.mfaEnabled } as Prisma.InputJsonObject,
        },
      });
      await transaction.authRateLimit.deleteMany({ where: { keyHash: { in: keys } } });
      return created;
    });
    if (!session) {
      await this.recordAuthenticationFailure(keys, user.id);
      throw authenticationFailure();
    }

    response.setHeader("Set-Cookie", this.createSessionCookie(rawToken, expiresAt));
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        department: membership.department,
        organization: membership.organization,
        hospital: membership.hospital,
        branch: membership.branch,
      })),
      session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    };
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  @ApiOperation({ summary: "Return the identity attached to the current session" })
  getCurrentUser(@Req() request: RequestLike) {
    return { user: request.authSession?.user };
  }

  @Post("password")
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const userId = request.authSession!.user.id;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, mfaEnabled: true, mfaSecretEncrypted: true, mfaLastUsedCounter: true },
    });
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) throw authenticationFailure();
    if (body.currentPassword === body.newPassword) {
      throw new UnauthorizedException("Choose a new password that is different from the current password.");
    }

    let matchedMfaCounter: bigint | null = null;
    if (user.mfaEnabled) {
      matchedMfaCounter = body.mfaCode && user.mfaSecretEncrypted
        ? verifyTotp(user.mfaSecretEncrypted, body.mfaCode)
        : null;
      if (matchedMfaCounter === null) throw authenticationFailure();
    }

    const newHash = await hashPassword(body.newPassword);
    await this.prisma.$transaction(async (transaction) => {
      if (matchedMfaCounter !== null) {
        const consumed = await transaction.user.updateMany({
          where: {
            id: userId,
            OR: [
              { mfaLastUsedCounter: null },
              { mfaLastUsedCounter: { lt: matchedMfaCounter } },
            ],
          },
          data: { mfaLastUsedCounter: matchedMfaCounter },
        });
        if (consumed.count !== 1) throw authenticationFailure();
      }
      await transaction.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
      await transaction.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await transaction.auditEvent.create({
        data: { actorUserId: userId, action: "auth.password_changed", resourceType: "user", resourceId: userId },
      });
    });
    response.setHeader("Set-Cookie", this.clearSessionCookie());
    return undefined;
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  async logout(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    const userId = request.authSession!.user.id;
    const sessionId = request.authSession!.id;
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditEvent.create({
        data: { actorUserId: userId, action: "auth.logout", resourceType: "session", resourceId: sessionId },
      }),
    ]);
    response.setHeader("Set-Cookie", this.clearSessionCookie());
    return undefined;
  }

  @Get("sessions")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  async listSessions(@Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return { sessions: sessions.map((session) => ({ ...session, current: session.id === request.authSession!.id })) };
  }

  @Delete("sessions/:sessionId")
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  async revokeSession(@Param("sessionId") sessionId: string, @Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count) {
      await this.prisma.auditEvent.create({
        data: { actorUserId: userId, action: "auth.session_revoked", resourceType: "session", resourceId: sessionId },
      });
    }
    return undefined;
  }

  @Post("sessions/revoke-others")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  async revokeOtherSessions(@Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const result = await this.prisma.session.updateMany({
      where: { userId, id: { not: request.authSession!.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "auth.other_sessions_revoked",
        resourceType: "session",
        metadata: { revokedCount: result.count } as Prisma.InputJsonObject,
      },
    });
    return { revokedCount: result.count };
  }

  private getRateKeys(email: string, ip: string): string[] {
    return [hashRateLimitKey(`email:${email}`), hashRateLimitKey(`ip:${ip}`)];
  }

  private async consumeLoginAttempt(keys: string[]) {
    const now = Date.now();
    this.throttleCleanupCounter += 1;
    if (this.throttleCleanupCounter % 100 === 0) {
      await this.prisma.authRateLimit.deleteMany({
        where: { windowStartedAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
      });
    }
    const timestamp = new Date(now);
    for (const keyHash of keys) {
      const existing = await this.prisma.authRateLimit.findUnique({ where: { keyHash } });
      const row = existing && now - existing.windowStartedAt.getTime() < RATE_WINDOW_MS
        ? await this.prisma.authRateLimit.update({
            where: { keyHash },
            data: { failedAttempts: { increment: 1 } },
          })
        : await this.prisma.authRateLimit.upsert({
            where: { keyHash },
            create: { keyHash, failedAttempts: 1, windowStartedAt: timestamp },
            update: { failedAttempts: 1, windowStartedAt: timestamp },
          });
      if (row.failedAttempts > MAX_FAILED_ATTEMPTS) {
        throw new HttpException("Too many sign-in attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  private async recordAuthenticationFailure(keys: string[], userId?: string) {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "auth.login_failed",
        resourceType: "authentication",
        metadata: { identifierHash: keys[0] } as Prisma.InputJsonObject,
      },
    });
  }

  private createSessionCookie(token: string, expiresAt: Date): string {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${sessionCookieName()}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  private clearSessionCookie(): string {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${sessionCookieName()}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`;
  }
}
