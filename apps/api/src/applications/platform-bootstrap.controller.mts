import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { EmailDeliveryService } from "../auth/email-delivery.service.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { PrismaService } from "../database/prisma.service.mjs";
import { consumeFixedWindowLimit } from "../security/rate-limit.mjs";
import { createEmailVerificationCode, createSessionToken, hashEmailVerificationCode, hashPassword, hashRateLimitKey, hashSessionToken, verifyEmailVerificationCode } from "../security/security.crypto.mjs";
import { CompletePlatformBootstrapDto, PrepareInvitationDto, ResendPlatformBootstrapCodeDto } from "./hospital-application.dto.mjs";

const BOOTSTRAP_LIFETIME_MS = 30 * 60 * 1000;
const EMAIL_CODE_LIFETIME_MS = 10 * 60 * 1000;
const MAX_EMAIL_CODE_ATTEMPTS = 5;
const invalidSetup = () => new BadRequestException("This secure setup link is invalid, expired, or already used.");
const emailUnavailable = () => new ServiceUnavailableException({
  code: "LOGIN_EMAIL_NOT_CONFIGURED",
  message: "Email verification is not configured. Contact the system administrator.",
});

@ApiTags("platform administrator setup")
@Controller("platform/bootstrap")
export class PlatformBootstrapController {
  constructor(private readonly prisma: PrismaService, private readonly emailDelivery: EmailDeliveryService) {}

  @Post("prepare")
  @HttpCode(200)
  @ApiOperation({ summary: "Set a password and send a one-time email verification code for first platform administrator setup" })
  async prepare(@Body() body: PrepareInvitationDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`platform-bootstrap-prepare-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`platform-bootstrap-prepare-token:${tokenHash}`),
    ], 5, 15);
    if (!this.emailDelivery.isEmailDeliveryConfigured()) throw emailUnavailable();

    const now = new Date();
    const record = await this.prisma.platformBootstrapToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, status: true, mfaEnabled: true } } },
    });
    if (!record || record.usedAt || record.preparedAt || record.expiresAt <= now || record.user.status !== "INVITED" || record.user.mfaEnabled) throw invalidSetup();
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, role: "SUPER_ADMIN", hospitalId: null, branchId: null, status: "INVITED", organization: { status: "ACTIVE" } },
      select: { id: true, organizationId: true },
    });
    if (!membership) throw invalidSetup();

    const passwordHash = await hashPassword(body.password);
    await this.prisma.$transaction(async (transaction) => {
      const valid = await transaction.platformBootstrapToken.updateMany({
        where: { id: record.id, usedAt: null, preparedAt: null, expiresAt: { gt: now } },
        data: { preparedAt: now },
      });
      if (valid.count !== 1) throw invalidSetup();
      await transaction.user.update({
        where: { id: record.userId },
        data: { displayName: body.displayName.trim(), passwordHash, mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedCounter: null },
      });
      await transaction.auditEvent.create({
        data: { organizationId: membership.organizationId, actorUserId: record.userId, action: "platform.bootstrap_setup_started", resourceType: "platform_bootstrap", resourceId: record.id, metadata: { emailVerificationRequired: true } as Prisma.InputJsonObject },
      });
    });

    try {
      return await this.issueEmailCode(record.userId, record.user.email, membership.organizationId, "platform-bootstrap");
    } catch (error) {
      // A failed provider delivery must not consume the one-time setup invitation.
      await this.prisma.platformBootstrapToken.updateMany({ where: { id: record.id, usedAt: null, preparedAt: now }, data: { preparedAt: null } });
      throw error;
    }
  }

  @Post("resend")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a fresh one-time email code for a pending first platform administrator setup" })
  async resend(@Body() body: ResendPlatformBootstrapCodeDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`platform-bootstrap-resend-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`platform-bootstrap-resend-token:${tokenHash}`),
    ], 5, 15);
    if (!this.emailDelivery.isEmailDeliveryConfigured()) throw emailUnavailable();

    const now = new Date();
    const record = await this.prisma.platformBootstrapToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, status: true, mfaEnabled: true } } },
    });
    if (!record || record.usedAt || !record.preparedAt || record.expiresAt <= now || record.user.status !== "INVITED" || record.user.mfaEnabled) throw invalidSetup();
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, role: "SUPER_ADMIN", hospitalId: null, branchId: null, status: "INVITED", organization: { status: "ACTIVE" } },
      select: { organizationId: true },
    });
    if (!membership) throw invalidSetup();
    return this.issueEmailCode(record.userId, record.user.email, membership.organizationId, "platform-bootstrap-resend");
  }

  @Post("complete")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify the emailed code and activate the first platform administrator" })
  async complete(@Body() body: CompletePlatformBootstrapDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    const challengeHash = hashSessionToken(body.challengeToken);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`platform-bootstrap-complete-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`platform-bootstrap-complete-token:${tokenHash}`),
      hashRateLimitKey(`platform-bootstrap-complete-code:${challengeHash}`),
    ], 8, 15);

    const now = new Date();
    const record = await this.prisma.platformBootstrapToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, status: true, mfaEnabled: true } } },
    });
    if (!record || record.usedAt || !record.preparedAt || record.expiresAt <= now || record.user.status !== "INVITED" || record.user.mfaEnabled) throw invalidSetup();
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, role: "SUPER_ADMIN", hospitalId: null, branchId: null, status: "INVITED", organization: { status: "ACTIVE" } },
      select: { id: true, organizationId: true },
    });
    if (!membership) throw invalidSetup();

    const challenge = await this.prisma.loginVerificationCode.findUnique({ where: { tokenHash: challengeHash } });
    if (!challenge || challenge.userId !== record.userId || challenge.mode !== "SUPER_ADMIN_BOOTSTRAP" || challenge.usedAt || challenge.expiresAt <= now || challenge.failedAttempts >= MAX_EMAIL_CODE_ATTEMPTS) throw invalidSetup();
    if (!verifyEmailVerificationCode(body.emailCode, challenge.codeHash)) {
      await this.prisma.$transaction([
        this.prisma.loginVerificationCode.updateMany({ where: { id: challenge.id, usedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: MAX_EMAIL_CODE_ATTEMPTS } }, data: { failedAttempts: { increment: 1 } } }),
        this.prisma.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: record.userId, action: "platform.bootstrap_email_code_failed", resourceType: "platform_bootstrap", resourceId: record.id } }),
      ]);
      throw new ForbiddenException("The email verification code is invalid or expired.");
    }

    await this.prisma.$transaction(async (transaction) => {
      const consumedChallenge = await transaction.loginVerificationCode.updateMany({
        where: { id: challenge.id, userId: record.userId, tokenHash: challengeHash, codeHash: challenge.codeHash, mode: "SUPER_ADMIN_BOOTSTRAP", usedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: MAX_EMAIL_CODE_ATTEMPTS } },
        data: { usedAt: now },
      });
      if (consumedChallenge.count !== 1) throw invalidSetup();
      const consumedToken = await transaction.platformBootstrapToken.updateMany({ where: { id: record.id, usedAt: null, preparedAt: { not: null }, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (consumedToken.count !== 1) throw invalidSetup();
      const activatedUser = await transaction.user.updateMany({
        where: { id: record.userId, status: "INVITED", mfaEnabled: false },
        data: { status: "ACTIVE", emailVerifiedAt: now, mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedCounter: null },
      });
      if (activatedUser.count !== 1) throw invalidSetup();
      const activatedMembership = await transaction.membership.updateMany({ where: { id: membership.id, status: "INVITED", role: "SUPER_ADMIN" }, data: { status: "ACTIVE" } });
      if (activatedMembership.count !== 1) throw invalidSetup();
      await transaction.auditEvent.create({
        data: { organizationId: membership.organizationId, actorUserId: record.userId, action: "platform.bootstrap_completed", resourceType: "user", resourceId: record.userId, metadata: { emailCodeVerified: true } as Prisma.InputJsonObject },
      });
    });
    return { message: "Your platform administrator account is active. Sign in with your password and the one-time code sent to your email." };
  }

  private async issueEmailCode(userId: string, email: string, organizationId: string, auditPrefix: string) {
    const challengeToken = createSessionToken();
    const code = createEmailVerificationCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EMAIL_CODE_LIFETIME_MS);
    const challenge = await this.prisma.$transaction(async (transaction) => {
      await transaction.loginVerificationCode.updateMany({ where: { userId, mode: "SUPER_ADMIN_BOOTSTRAP", usedAt: null }, data: { usedAt: now } });
      const created = await transaction.loginVerificationCode.create({
        data: { userId, tokenHash: hashSessionToken(challengeToken), codeHash: hashEmailVerificationCode(code), mode: "SUPER_ADMIN_BOOTSTRAP", rememberMe: false, expiresAt },
        select: { id: true },
      });
      return created;
    });
    try {
      await this.emailDelivery.sendLoginVerificationCode(email, code);
      await this.prisma.auditEvent.create({ data: { organizationId, actorUserId: userId, action: `${auditPrefix}_email_code_sent`, resourceType: "platform_bootstrap", resourceId: challenge.id } });
    } catch {
      await this.prisma.$transaction([
        this.prisma.loginVerificationCode.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: new Date() } }),
        this.prisma.auditEvent.create({ data: { organizationId, actorUserId: userId, action: `${auditPrefix}_email_code_delivery_failed`, resourceType: "platform_bootstrap", resourceId: challenge.id } }),
      ]);
      throw new ServiceUnavailableException("Email verification could not be sent. Try again later.");
    }
    return { challengeToken, emailHint: maskEmail(email), expiresInSeconds: EMAIL_CODE_LIFETIME_MS / 1000 };
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "your verified email address";
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}
