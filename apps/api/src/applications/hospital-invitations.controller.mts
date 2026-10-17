import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { createSessionToken, createTotpSecret, encryptTotpSecret, hashPassword, hashRateLimitKey, hashSessionToken, verifyTotp } from "../security/security.crypto.mjs";
import { consumeFixedWindowLimit } from "../security/rate-limit.mjs";
import { AcceptExistingInvitationDto, CompleteInvitationDto, PrepareInvitationDto } from "./hospital-application.dto.mjs";

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const invalidInvitation = () => new BadRequestException("This invitation is invalid, expired, or no longer available.");

@ApiTags("hospital onboarding")
@Controller("hospital-invitations")
export class HospitalInvitationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("prepare")
  @HttpCode(200)
  @ApiOperation({ summary: "Prepare an invited hospital administrator account and start mandatory MFA setup" })
  async prepare(@Body() body: PrepareInvitationDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`invitation-prepare-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`invitation-prepare-token:${tokenHash}`),
    ], 8, 15);

    const now = new Date();
    const invitation = await this.prisma.hospitalInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true, organizationId: true, hospitalId: true, intendedEmail: true, role: true, status: true,
        deliveryStatus: true, expiresAt: true, preparedAt: true, hospital: { select: { status: true } },
      },
    });
    if (!invitation || invitation.status !== "PENDING" || invitation.deliveryStatus !== "SENT" || invitation.preparedAt || invitation.expiresAt <= now || invitation.hospital.status !== "PROVISIONING" || invitation.role !== "HOSPITAL_ADMIN") {
      throw invalidInvitation();
    }

    const existing = await this.prisma.user.findUnique({ where: { email: invitation.intendedEmail }, select: { id: true, status: true } });
    if (existing && existing.status !== "INVITED") {
      throw new ConflictException("Sign in to your existing account before accepting this hospital invitation.");
    }

    const { raw, base32 } = createTotpSecret();
    const encryptedSecret = encryptTotpSecret(raw);
    const passwordHash = await hashPassword(body.password);
    const setup = await this.prisma.$transaction(async (transaction) => {
      if (existing) {
        const currentUser = await transaction.user.findUnique({ where: { id: existing.id }, select: { status: true } });
        if (!currentUser || currentUser.status !== "INVITED") throw new ConflictException("Sign in to your existing account before accepting this hospital invitation.");
        const otherPreparedInvitation = await transaction.hospitalInvitation.findFirst({
          where: { preparedUserId: existing.id, id: { not: invitation.id }, status: "PENDING", expiresAt: { gt: now } },
          select: { id: true },
        });
        if (otherPreparedInvitation) throw new ConflictException("Finish the other hospital account setup first. You can then accept this invitation with that account.");
      }
      const current = await transaction.hospitalInvitation.findUnique({
        where: { id: invitation.id },
        select: { status: true, deliveryStatus: true, expiresAt: true, preparedAt: true },
      });
      if (!current || current.status !== "PENDING" || current.deliveryStatus !== "SENT" || current.expiresAt <= now) {
        throw invalidInvitation();
      }
      const claimed = await transaction.hospitalInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", deliveryStatus: "SENT", preparedAt: null, expiresAt: { gt: now } },
        data: { preparedAt: now },
      });
      if (claimed.count !== 1) throw invalidInvitation();

      const user = existing
        ? await transaction.user.update({
            where: { id: existing.id },
            data: { displayName: body.displayName.trim(), passwordHash, status: "INVITED", emailVerifiedAt: now, mfaEnabled: false, mfaSecretEncrypted: encryptedSecret, mfaLastUsedCounter: null },
            select: { id: true },
          })
        : await transaction.user.create({
            data: { email: invitation.intendedEmail, displayName: body.displayName.trim(), passwordHash, status: "INVITED", emailVerifiedAt: now, mfaEnabled: false, mfaSecretEncrypted: encryptedSecret },
            select: { id: true },
          });

      const membership = await transaction.membership.findFirst({
        where: { userId: user.id, organizationId: invitation.organizationId, hospitalId: invitation.hospitalId, branchId: null, role: "HOSPITAL_ADMIN" },
        select: { id: true, status: true },
      });
      if (membership?.status === "ACTIVE") throw new ConflictException("This account already has active access to the hospital.");
      if (membership) {
        await transaction.membership.update({ where: { id: membership.id }, data: { status: "INVITED", expiresAt: null } });
      } else {
        await transaction.membership.create({
          data: { userId: user.id, organizationId: invitation.organizationId, hospitalId: invitation.hospitalId, role: "HOSPITAL_ADMIN", status: "INVITED" },
        });
      }

      await transaction.hospitalInvitation.update({ where: { id: invitation.id }, data: { preparedUserId: user.id } });
      await transaction.auditEvent.create({
        data: {
          organizationId: invitation.organizationId,
          action: "hospital.invitation_setup_started",
          resourceType: "hospital_invitation",
          resourceId: invitation.id,
          metadata: { role: "HOSPITAL_ADMIN", mfaRequired: true } as Prisma.InputJsonObject,
        },
      });
      return user;
    });

    const label = encodeURIComponent(`JR Xpert HMS:${invitation.intendedEmail}`);
    const authenticatorUri = `otpauth://totp/${label}?secret=${base32}&issuer=JR%20Xpert%20HMS&algorithm=SHA1&digits=6&period=30`;
    return { accountId: setup.id, authenticatorSecret: base32, authenticatorUri, nextStep: "Confirm the authenticator code to activate your account." };
  }

  @Post("complete")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify MFA and activate a new hospital administrator membership" })
  async complete(@Body() body: CompleteInvitationDto, @Req() request: RequestLike) {
    const tokenHash = hashSessionToken(body.token);
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`invitation-complete-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`invitation-complete-token:${tokenHash}`),
    ], 8, 15);

    const now = new Date();
    const invitation = await this.prisma.hospitalInvitation.findUnique({
      where: { tokenHash },
      include: { preparedUser: { select: { id: true, status: true, mfaEnabled: true, mfaSecretEncrypted: true, mfaLastUsedCounter: true } } },
    });
    if (!invitation || invitation.status !== "PENDING" || !invitation.preparedAt || invitation.expiresAt <= now || !invitation.preparedUser || invitation.preparedUser.status !== "INVITED" || invitation.preparedUser.mfaEnabled || !invitation.preparedUser.mfaSecretEncrypted) {
      throw invalidInvitation();
    }
    const preparedUser = invitation.preparedUser;
    const matchedCounter = verifyTotp(preparedUser.mfaSecretEncrypted!, body.mfaCode);
    if (matchedCounter === null || (preparedUser.mfaLastUsedCounter !== null && matchedCounter <= preparedUser.mfaLastUsedCounter)) {
      throw new ForbiddenException("The authenticator code is invalid or already used.");
    }

    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.hospitalInvitation.findUnique({ where: { id: invitation.id }, select: { status: true, expiresAt: true, preparedUserId: true } });
      if (!current || current.status !== "PENDING" || current.expiresAt <= now || current.preparedUserId !== invitation.preparedUserId) throw invalidInvitation();
      const consumedCounter = await transaction.user.updateMany({
        where: { id: invitation.preparedUserId!, status: "INVITED", mfaLastUsedCounter: preparedUser.mfaLastUsedCounter },
        data: { status: "ACTIVE", mfaEnabled: true, mfaLastUsedCounter: matchedCounter },
      });
      if (consumedCounter.count !== 1) throw invalidInvitation();
      const membership = await transaction.membership.updateMany({
        where: { userId: invitation.preparedUserId!, organizationId: invitation.organizationId, hospitalId: invitation.hospitalId, role: "HOSPITAL_ADMIN", status: "INVITED" },
        data: { status: "ACTIVE" },
      });
      if (membership.count !== 1) throw invalidInvitation();
      await transaction.organization.updateMany({ where: { id: invitation.organizationId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.hospital.updateMany({ where: { id: invitation.hospitalId, organizationId: invitation.organizationId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.branch.updateMany({ where: { hospitalId: invitation.hospitalId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.hospitalInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: now } });
      await transaction.auditEvent.create({
        data: {
          organizationId: invitation.organizationId,
          actorUserId: invitation.preparedUserId,
          action: "hospital.invitation_accepted",
          resourceType: "hospital_invitation",
          resourceId: invitation.id,
          metadata: { role: "HOSPITAL_ADMIN", mfaEnabled: true } as Prisma.InputJsonObject,
        },
      });
    });
    return { message: "Your administrator account is active. Sign in using your new credentials and authenticator code." };
  }

  @Post("accept-existing")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth("jr-xpert-session")
  @ApiOperation({ summary: "Accept a hospital invitation with an existing verified MFA-enabled account" })
  async acceptExisting(@Body() body: AcceptExistingInvitationDto, @Req() request: RequestLike) {
    const user = await this.prisma.user.findUnique({ where: { id: request.authSession!.user.id }, select: { id: true, email: true, status: true, mfaEnabled: true } });
    const invitation = await this.prisma.hospitalInvitation.findUnique({ where: { tokenHash: hashSessionToken(body.token) } });
    const now = new Date();
    if (!user || user.status !== "ACTIVE" || !user.mfaEnabled || !invitation || user.email !== invitation.intendedEmail || invitation.status !== "PENDING" || invitation.deliveryStatus !== "SENT" || invitation.expiresAt <= now || invitation.role !== "HOSPITAL_ADMIN") {
      throw invalidInvitation();
    }
    await this.activateExistingInvite(invitation.id, user.id, invitation.organizationId, invitation.hospitalId);
    return { message: "Hospital administrator access was added to your account." };
  }

  private async activateExistingInvite(invitationId: string, userId: string, organizationId: string, hospitalId: string) {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.hospitalInvitation.findUnique({ where: { id: invitationId }, select: { status: true, expiresAt: true, intendedEmail: true, deliveryStatus: true } });
      const user = await transaction.user.findUnique({ where: { id: userId }, select: { email: true, status: true, mfaEnabled: true } });
      if (!invitation || invitation.status !== "PENDING" || invitation.deliveryStatus !== "SENT" || invitation.expiresAt <= now || !user || user.status !== "ACTIVE" || !user.mfaEnabled || user.email !== invitation.intendedEmail) throw invalidInvitation();
      const existing = await transaction.membership.findFirst({ where: { userId, organizationId, hospitalId, branchId: null, role: "HOSPITAL_ADMIN" }, select: { id: true, status: true } });
      if (existing?.status === "ACTIVE") throw new ConflictException("This account already has active access to the hospital.");
      if (existing) await transaction.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
      else await transaction.membership.create({ data: { userId, organizationId, hospitalId, role: "HOSPITAL_ADMIN", status: "ACTIVE" } });
      await transaction.organization.updateMany({ where: { id: organizationId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.hospital.updateMany({ where: { id: hospitalId, organizationId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.branch.updateMany({ where: { hospitalId, status: "PROVISIONING" }, data: { status: "ACTIVE" } });
      await transaction.hospitalInvitation.update({ where: { id: invitationId }, data: { status: "ACCEPTED", acceptedAt: now, preparedUserId: userId } });
      await transaction.auditEvent.create({
        data: { organizationId, actorUserId: userId, action: "hospital.invitation_accepted", resourceType: "hospital_invitation", resourceId: invitationId, metadata: { role: "HOSPITAL_ADMIN", existingAccount: true } as Prisma.InputJsonObject },
      });
    });
  }
}
