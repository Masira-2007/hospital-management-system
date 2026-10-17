import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "../generated/prisma/client.cjs";
import { PrismaService } from "../database/prisma.service.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { PrepareInvitationDto, CompleteInvitationDto } from "./hospital-application.dto.mjs";
import { consumeFixedWindowLimit } from "../security/rate-limit.mjs";
import { createTotpSecret, encryptTotpSecret, hashPassword, hashRateLimitKey, hashSessionToken, verifyTotp } from "../security/security.crypto.mjs";

const BOOTSTRAP_LIFETIME_MS = 30 * 60 * 1000;
const invalidSetup = () => new BadRequestException("This secure setup link is invalid, expired, or already used.");

@ApiTags("platform administrator setup")
@Controller("platform/bootstrap")
export class PlatformBootstrapController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("prepare")
  @HttpCode(200)
  @ApiOperation({ summary: "Prepare a one-time platform administrator password and MFA enrollment" })
  async prepare(@Body() body: PrepareInvitationDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`platform-bootstrap-prepare-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`platform-bootstrap-prepare-token:${tokenHash}`),
    ], 5, 15);

    const now = new Date();
    const record = await this.prisma.platformBootstrapToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, status: true, mfaEnabled: true } } },
    });
    if (!record || record.usedAt || record.expiresAt <= now || record.user.status !== "INVITED" || record.user.mfaEnabled) throw invalidSetup();
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, role: "SUPER_ADMIN", hospitalId: null, branchId: null, status: "INVITED", organization: { status: "ACTIVE" } },
      select: { id: true, organizationId: true },
    });
    if (!membership) throw invalidSetup();

    const { raw, base32 } = createTotpSecret();
    const encrypted = encryptTotpSecret(raw);
    const passwordHash = await hashPassword(body.password);
    await this.prisma.$transaction(async (transaction) => {
      const valid = await transaction.platformBootstrapToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { preparedAt: now },
      });
      if (valid.count !== 1) throw invalidSetup();
      await transaction.user.update({
        where: { id: record.userId },
        data: { displayName: body.displayName.trim(), passwordHash, mfaEnabled: false, mfaSecretEncrypted: encrypted, mfaLastUsedCounter: null },
      });
      await transaction.auditEvent.create({
        data: { organizationId: membership.organizationId, actorUserId: record.userId, action: "platform.bootstrap_setup_started", resourceType: "platform_bootstrap", resourceId: record.id, metadata: { mfaRequired: true } as Prisma.InputJsonObject },
      });
    });

    const label = encodeURIComponent(`JR Xpert HMS:${record.user.email}`);
    const authenticatorUri = `otpauth://totp/${label}?secret=${base32}&issuer=JR%20Xpert%20HMS&algorithm=SHA1&digits=6&period=30`;
    return { authenticatorSecret: base32, authenticatorUri, nextStep: "Add this account to an authenticator app, then confirm its current six-digit code." };
  }

  @Post("complete")
  @HttpCode(200)
  @ApiOperation({ summary: "Confirm MFA and activate the one-time first platform administrator" })
  async complete(@Body() body: CompleteInvitationDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`platform-bootstrap-complete-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`platform-bootstrap-complete-token:${tokenHash}`),
    ], 8, 15);
    const now = new Date();
    const record = await this.prisma.platformBootstrapToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, status: true, mfaEnabled: true, mfaSecretEncrypted: true, mfaLastUsedCounter: true } } },
    });
    if (!record || record.usedAt || !record.preparedAt || record.expiresAt <= now || record.user.status !== "INVITED" || record.user.mfaEnabled || !record.user.mfaSecretEncrypted) throw invalidSetup();
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, role: "SUPER_ADMIN", hospitalId: null, branchId: null, status: "INVITED", organization: { status: "ACTIVE" } },
      select: { id: true, organizationId: true },
    });
    if (!membership) throw invalidSetup();
    const counter = verifyTotp(record.user.mfaSecretEncrypted, body.mfaCode);
    if (counter === null || (record.user.mfaLastUsedCounter !== null && counter <= record.user.mfaLastUsedCounter)) {
      throw new ForbiddenException("The authenticator code is invalid or already used.");
    }

    await this.prisma.$transaction(async (transaction) => {
      const consumedToken = await transaction.platformBootstrapToken.updateMany({ where: { id: record.id, usedAt: null, preparedAt: { not: null }, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (consumedToken.count !== 1) throw invalidSetup();
      const activatedUser = await transaction.user.updateMany({
        where: { id: record.userId, status: "INVITED", mfaEnabled: false, mfaLastUsedCounter: record.user.mfaLastUsedCounter },
        data: { status: "ACTIVE", emailVerifiedAt: now, mfaEnabled: true, mfaLastUsedCounter: counter },
      });
      if (activatedUser.count !== 1) throw invalidSetup();
      const activatedMembership = await transaction.membership.updateMany({ where: { id: membership.id, status: "INVITED", role: "SUPER_ADMIN" }, data: { status: "ACTIVE" } });
      if (activatedMembership.count !== 1) throw invalidSetup();
      await transaction.auditEvent.create({
        data: { organizationId: membership.organizationId, actorUserId: record.userId, action: "platform.bootstrap_completed", resourceType: "user", resourceId: record.userId, metadata: { mfaEnabled: true } as Prisma.InputJsonObject },
      });
    });
    return { message: "Your platform administrator account is active. Sign in with the password and authenticator code you just configured." };
  }
}
