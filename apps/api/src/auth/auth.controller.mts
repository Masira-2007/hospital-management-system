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
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.mjs";
import {
  createSessionToken,
  hashPassword,
  hashRateLimitKey,
  hashSessionToken,
  performDummyPasswordCheck,
  verifyPassword,
  verifyTotp,
} from "../security/security.crypto.mjs";
import { LoginDto } from "./login.dto.mjs";
import { ChangePasswordDto } from "./change-password.dto.mjs";
import { PasswordResetDto, PasswordResetRequestDto } from "./password-reset.dto.mjs";
import { EmailDeliveryService } from "./email-delivery.service.mjs";
import { getHeader, type RequestLike, type ResponseLike } from "./auth.types.mjs";
import { SessionAuthGuard, sessionCookieName } from "./session-auth.guard.mjs";

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_DURATION_MS = 20 * 60 * 1000;
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

  constructor(private readonly prisma: PrismaService, private readonly emailDelivery: EmailDeliveryService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Create a secure, server-managed session for a verified hospital account" })
  async login(@Body() body: LoginDto, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    const email = body.email.trim().toLowerCase();
    const mode = body.mode ?? "HOSPITAL";
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
            organization: { status: "ACTIVE" },
            AND: [{ OR: [{ hospitalId: null }, { hospital: { is: { status: "ACTIVE" } } }] }],
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
      user && user.status === "ACTIVE" && user.emailVerifiedAt && user.memberships.some(({ role }) =>
        mode === "PATIENT" ? role === "PATIENT" : role !== "PATIENT",
      ),
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
    const expiresAt = new Date(Date.now() + (body.rememberMe ? REMEMBERED_SESSION_DURATION_MS : SESSION_DURATION_MS));
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
          metadata: { membershipCount: user.memberships.length, loginMode: mode, mfaVerified: user.mfaEnabled } as Prisma.InputJsonObject,
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
      memberships: user.memberships.filter(({ role }) => mode === "PATIENT" ? role === "PATIENT" : role !== "PATIENT").map((membership) => ({
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

  @Post("forgot-password")
  @HttpCode(202)
  @ApiOperation({ summary: "Request a time-limited, one-use password reset link" })
  async requestPasswordReset(@Body() body: PasswordResetRequestDto, @Req() request: RequestLike) {
    if (!this.emailDelivery.isConfigured()) {
      throw new ServiceUnavailableException({
        code: "PASSWORD_RECOVERY_NOT_CONFIGURED",
        message: "Password recovery is not configured. Contact your hospital administrator.",
      });
    }

    const email = body.email.trim().toLowerCase();
    const identifierHash = hashRateLimitKey(`password-reset:${email}`);
    await this.consumeLoginAttempt([identifierHash]);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, emailVerifiedAt: true },
    });
    if (user?.status === "ACTIVE" && user.emailVerifiedAt) {
      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        await transaction.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        });
        await transaction.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_DURATION_MS) },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: user.id,
            action: "auth.password_reset_requested",
            resourceType: "password_reset",
            metadata: { identifierHash } as Prisma.InputJsonObject,
          },
        });
      });

      try {
        await this.emailDelivery.sendPasswordReset(email, token);
      } catch {
        await this.prisma.$transaction([
          this.prisma.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: new Date() } }),
          this.prisma.auditEvent.create({
            data: {
              actorUserId: user.id,
              action: "auth.password_reset_delivery_failed",
              resourceType: "password_reset",
              metadata: { identifierHash } as Prisma.InputJsonObject,
            },
          }),
        ]);
      }
    }

    return { message: "If the account is eligible, password reset instructions will be sent." };
  }

  @Post("reset-password")
  @HttpCode(204)
  @ApiOperation({ summary: "Consume a one-use password reset token and revoke active sessions" })
  async resetPassword(@Body() body: PasswordResetDto, @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike) {
    const tokenHash = hashSessionToken(body.token);
    await this.consumeLoginAttempt([
      hashRateLimitKey(`password-reset-token:${tokenHash}`),
      hashRateLimitKey(`password-reset-ip:${request.ip ?? "unknown"}`),
    ]);
    const newPasswordHash = await hashPassword(body.password);
    const now = new Date();

    try {
      await this.prisma.$transaction(async (transaction) => {
        const reset = await transaction.passwordResetToken.findUnique({
          where: { tokenHash },
          include: { user: { select: { id: true, status: true, emailVerifiedAt: true } } },
        });
        if (!reset || reset.usedAt || reset.expiresAt <= now || reset.user.status !== "ACTIVE" || !reset.user.emailVerifiedAt) {
          throw authenticationFailure();
        }
        const consumed = await transaction.passwordResetToken.updateMany({
          where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) throw authenticationFailure();

        await transaction.user.update({ where: { id: reset.user.id }, data: { passwordHash: newPasswordHash } });
        await transaction.session.updateMany({
          where: { userId: reset.user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId: reset.user.id, usedAt: null },
          data: { usedAt: now },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: reset.user.id,
            action: "auth.password_reset_completed",
            resourceType: "user",
            resourceId: reset.user.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw authenticationFailure();
      throw error;
    }

    response.setHeader("Set-Cookie", this.clearSessionCookie());
    return undefined;
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  @ApiOperation({ summary: "Return the identity attached to the current session" })
  async getCurrentUser(@Req() request: RequestLike) {
    const user = request.authSession!.user;
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        organization: { status: "ACTIVE" },
        AND: [{ OR: [{ hospitalId: null }, { hospital: { is: { status: "ACTIVE" } } }] }],
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        hospital: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ organizationId: "asc" }, { hospitalId: "asc" }, { branchId: "asc" }],
    });
    return { user, memberships };
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
