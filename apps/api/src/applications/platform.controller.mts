import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "../generated/prisma/client.mjs";
import { PrismaService } from "../database/prisma.service.mjs";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { SuperAdminGuard } from "../auth/super-admin.guard.mjs";
import { EmailDeliveryService } from "../auth/email-delivery.service.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { createSessionToken, hashSessionToken } from "../security/security.crypto.mjs";
import { ApplicationDecisionDto, HospitalApplicationQueryDto } from "./hospital-application.dto.mjs";

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;

@ApiTags("platform administration")
@ApiCookieAuth("jr-xpert-session")
@UseGuards(SessionAuthGuard, SuperAdminGuard)
@Controller("platform")
export class PlatformController {
  constructor(private readonly prisma: PrismaService, private readonly emailDelivery: EmailDeliveryService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Read platform-level onboarding and account counts without clinical data" })
  async dashboard() {
    const [applications, hospitals, invitations, activeUsers] = await Promise.all([
      this.prisma.hospitalApplication.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.hospital.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.hospitalInvitation.groupBy({ by: ["status", "deliveryStatus"], _count: { _all: true } }),
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
    ]);
    return {
      applications: Object.fromEntries(applications.map(({ status, _count }) => [status, _count._all])),
      hospitals: Object.fromEntries(hospitals.map(({ status, _count }) => [status, _count._all])),
      invitations: invitations.map(({ status, deliveryStatus, _count }) => ({ status, deliveryStatus, count: _count._all })),
      activeUsers,
    };
  }

  @Get("applications")
  @ApiOperation({ summary: "List hospital onboarding requests for platform review" })
  async listApplications(@Query() query: HospitalApplicationQueryDto) {
    const applications = await this.prisma.hospitalApplication.findMany({
      ...(query.status ? { where: { status: query.status } } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, status: true, hospitalName: true, hospitalType: true, officialEmail: true, contactPhone: true,
        website: true, streetAddress: true, city: true, state: true, country: true, postalCode: true,
        bedCount: true, branchCount: true, representativeName: true, representativeDesignation: true,
        proposedAdminName: true, proposedAdminEmail: true, requestedPlanCode: true, termsAcceptedAt: true,
        emailVerifiedAt: true, reviewedAt: true, reviewReason: true, createdHospitalId: true, createdAt: true,
        createdHospital: { select: { id: true, name: true, status: true, invitations: { select: { id: true, status: true, deliveryStatus: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 1 } } },
      },
    });
    return { applications };
  }

  @Post("applications/:applicationId/decision")
  @ApiOperation({ summary: "Approve, reject, or request more information for a verified hospital application" })
  async decide(@Param("applicationId") applicationId: string, @Body() body: ApplicationDecisionDto, @Req() request: RequestLike) {
    const reason = body.reason?.trim() ?? "";
    if (body.decision !== "APPROVE" && reason.length < 10) {
      throw new BadRequestException("Provide a clear reason of at least 10 characters for this decision.");
    }

    if (body.decision === "APPROVE") {
      return this.approve(applicationId, request.authSession!.user.id);
    }

    const status = body.decision === "REJECT" ? "REJECTED" : "NEEDS_INFORMATION";
    const now = new Date();
    const application = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.hospitalApplication.findUnique({ where: { id: applicationId } });
      if (!current) throw new NotFoundException("Hospital application not found.");
      if (current.status !== "PENDING_REVIEW" && current.status !== "NEEDS_INFORMATION") {
        throw new ConflictException("Only verified applications awaiting review can be updated.");
      }
      if (!current.emailVerifiedAt) throw new ConflictException("The hospital email must be verified before review.");
      const updated = await transaction.hospitalApplication.update({
        where: { id: current.id },
        data: { status, reviewedAt: now, reviewedByUserId: request.authSession!.user.id, reviewReason: reason },
        select: { id: true, hospitalName: true, officialEmail: true, status: true },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: request.authSession!.user.id,
          action: status === "REJECTED" ? "hospital.application_rejected" : "hospital.application_information_requested",
          resourceType: "hospital_application",
          resourceId: current.id,
          reason,
        },
      });
      return updated;
    });

    let notification: "SENT" | "FAILED" = "SENT";
    try {
      await this.emailDelivery.sendApplicationDecision(application.officialEmail, status, reason);
    } catch {
      notification = "FAILED";
      await this.prisma.auditEvent.create({
        data: { actorUserId: request.authSession!.user.id, action: "hospital.application_notification_failed", resourceType: "hospital_application", resourceId: application.id, metadata: { status } as Prisma.InputJsonObject },
      });
    }
    return { application, notification };
  }

  @Post("invitations/:invitationId/resend")
  @ApiOperation({ summary: "Rotate and resend a pending hospital administrator invitation" })
  async resendInvitation(@Param("invitationId") invitationId: string, @Req() request: RequestLike) {
    const invitation = await this.prisma.hospitalInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.status !== "PENDING") throw new NotFoundException("Pending invitation not found.");
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.hospitalInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { tokenHash: hashSessionToken(token), expiresAt, deliveryStatus: "PENDING", preparedAt: null, preparedUserId: null },
      });
      if (current.count !== 1) throw new ConflictException("This invitation changed. Refresh and try again.");
      await transaction.auditEvent.create({
        data: { actorUserId: request.authSession!.user.id, organizationId: invitation.organizationId, action: "hospital.invitation_resent", resourceType: "hospital_invitation", resourceId: invitation.id },
      });
      return transaction.hospitalInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: { id: true, intendedEmail: true, organizationId: true, status: true, expiresAt: true } });
    });
    return { invitation: await this.deliverInvitation(updated, token, request.authSession!.user.id) };
  }

  @Post("invitations/:invitationId/revoke")
  @ApiOperation({ summary: "Revoke a pending hospital administrator invitation" })
  async revokeInvitation(@Param("invitationId") invitationId: string, @Req() request: RequestLike) {
    const invitation = await this.prisma.hospitalInvitation.findUnique({ where: { id: invitationId }, select: { id: true, status: true, organizationId: true, preparedUserId: true, hospitalId: true } });
    if (!invitation || invitation.status !== "PENDING") throw new NotFoundException("Pending invitation not found.");
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.hospitalInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "REVOKED", revokedAt: now } });
      if (changed.count !== 1) throw new ConflictException("This invitation changed. Refresh and try again.");
      if (invitation.preparedUserId) {
        await transaction.membership.updateMany({ where: { userId: invitation.preparedUserId, organizationId: invitation.organizationId, hospitalId: invitation.hospitalId, role: "HOSPITAL_ADMIN", status: "INVITED" }, data: { status: "DISABLED" } });
      }
      await transaction.auditEvent.create({ data: { actorUserId: request.authSession!.user.id, organizationId: invitation.organizationId, action: "hospital.invitation_revoked", resourceType: "hospital_invitation", resourceId: invitation.id } });
    });
    return { invitation: { id: invitation.id, status: "REVOKED", revokedAt: now.toISOString() } };
  }

  private async approve(applicationId: string, reviewerId: string) {
    const token = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const provisioned = await this.prisma.$transaction(async (transaction) => {
      const application = await transaction.hospitalApplication.findUnique({ where: { id: applicationId } });
      if (!application) throw new NotFoundException("Hospital application not found.");
      if ((application.status !== "PENDING_REVIEW" && application.status !== "NEEDS_INFORMATION") || !application.emailVerifiedAt || application.createdHospitalId) {
        throw new ConflictException("Only verified applications awaiting review can be approved.");
      }
      const baseSlug = slugify(application.hospitalName) || "hospital";
      const suffix = createSessionToken().slice(0, 8);
      const organization = await transaction.organization.create({
        data: { name: application.hospitalName, slug: `${baseSlug}-${suffix}`, status: "PROVISIONING" },
        select: { id: true, name: true, slug: true },
      });
      const hospital = await transaction.hospital.create({
        data: { organizationId: organization.id, name: application.hospitalName, slug: baseSlug, status: "PROVISIONING" },
        select: { id: true, name: true, slug: true },
      });
      await transaction.branch.createMany({
        data: Array.from({ length: application.branchCount }, (_, index) => ({
          hospitalId: hospital.id,
          name: index === 0 ? "Main Branch" : `Branch ${index + 1}`,
          code: index === 0 ? "MAIN" : `BR-${String(index + 1).padStart(3, "0")}`,
          status: "PROVISIONING" as const,
        })),
      });
      await transaction.hospitalSettings.create({ data: { hospitalId: hospital.id } });
      const invitation = await transaction.hospitalInvitation.create({
        data: {
          organizationId: organization.id,
          hospitalId: hospital.id,
          createdByUserId: reviewerId,
          intendedEmail: application.proposedAdminEmail,
          intendedName: application.proposedAdminName,
          role: "HOSPITAL_ADMIN",
          tokenHash: hashSessionToken(token),
          expiresAt,
          deliveryStatus: "PENDING",
        },
        select: { id: true, intendedEmail: true, organizationId: true, status: true, expiresAt: true },
      });
      await transaction.hospitalApplication.update({
        where: { id: application.id },
        data: { status: "APPROVED", reviewedAt: now, reviewedByUserId: reviewerId, reviewReason: null, createdHospitalId: hospital.id },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: reviewerId,
          action: "hospital.application_approved",
          resourceType: "hospital_application",
          resourceId: application.id,
          metadata: { organizationId: organization.id, hospitalId: hospital.id, invitationId: invitation.id, branchCount: application.branchCount } as Prisma.InputJsonObject,
        },
      });
      return { applicationId: application.id, organization, hospital, invitation };
    });

    const invitation = await this.deliverInvitation(provisioned.invitation, token, reviewerId);
    return { applicationId: provisioned.applicationId, organization: provisioned.organization, hospital: provisioned.hospital, invitation };
  }

  private async deliverInvitation(invitation: { id: string; intendedEmail: string; organizationId: string; status: string; expiresAt: Date }, token: string, actorUserId: string) {
    let deliveryStatus: "SENT" | "FAILED" = "SENT";
    try {
      await this.emailDelivery.sendHospitalAdminInvitation(invitation.intendedEmail, token);
    } catch {
      deliveryStatus = "FAILED";
    }
    await this.prisma.$transaction([
      this.prisma.hospitalInvitation.update({ where: { id: invitation.id }, data: { deliveryStatus } }),
      this.prisma.auditEvent.create({
        data: { actorUserId, organizationId: invitation.organizationId, action: deliveryStatus === "SENT" ? "hospital.invitation_email_sent" : "hospital.invitation_email_failed", resourceType: "hospital_invitation", resourceId: invitation.id, metadata: { deliveryStatus } as Prisma.InputJsonObject },
      }),
    ]);
    return { id: invitation.id, status: invitation.status, deliveryStatus, expiresAt: invitation.expiresAt.toISOString() };
  }
}

function slugify(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
