import { BadRequestException, Body, Controller, HttpCode, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "../generated/prisma/client.cjs";
import { PrismaService } from "../database/prisma.service.mjs";
import { getHeader, type RequestLike } from "../auth/auth.types.mjs";
import { EmailDeliveryService } from "../auth/email-delivery.service.mjs";
import { createSessionToken, hashRateLimitKey, hashSessionToken } from "../security/security.crypto.mjs";
import { consumeFixedWindowLimit } from "../security/rate-limit.mjs";
import { CreateHospitalApplicationDto, VerifyHospitalApplicationDto } from "./hospital-application.dto.mjs";

const APPLICATION_PENDING_STATUSES = ["EMAIL_PENDING", "PENDING_REVIEW", "NEEDS_INFORMATION", "APPROVED"] as const;
const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

@ApiTags("hospital onboarding")
@Controller("hospital-applications")
export class HospitalApplicationsController {
  constructor(private readonly prisma: PrismaService, private readonly emailDelivery: EmailDeliveryService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: "Submit a hospital application and send an email-verification link" })
  async submit(@Body() body: CreateHospitalApplicationDto, @Req() request: RequestLike) {
    if (!this.emailDelivery.isConfigured()) {
      throw new ServiceUnavailableException({
        code: "APPLICATION_EMAIL_NOT_CONFIGURED",
        message: "Hospital applications are temporarily unavailable. Please contact JR Xpert support.",
      });
    }

    const officialEmail = body.officialEmail.trim().toLowerCase();
    const adminEmail = body.proposedAdminEmail.trim().toLowerCase();
    const ipKey = hashRateLimitKey(`hospital-application-ip:${request.ip ?? "unknown"}`);
    const emailKey = hashRateLimitKey(`hospital-application-email:${officialEmail}`);
    await consumeFixedWindowLimit(this.prisma, [ipKey, emailKey], 5, 60);

    const now = new Date();
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const existing = await this.prisma.hospitalApplication.findFirst({
      where: { officialEmail, status: { in: [...APPLICATION_PENDING_STATUSES] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    const application = await this.prisma.$transaction(async (transaction) => {
      const data = {
        hospitalName: body.hospitalName.trim(),
        hospitalType: body.hospitalType,
        officialEmail,
        contactPhone: body.contactPhone.trim(),
        website: body.website?.trim() || null,
        streetAddress: body.streetAddress.trim(),
        city: body.city.trim(),
        state: body.state.trim(),
        country: body.country.trim(),
        postalCode: body.postalCode.trim(),
        bedCount: body.bedCount,
        branchCount: body.branchCount,
        representativeName: body.representativeName.trim(),
        representativeDesignation: body.representativeDesignation.trim(),
        proposedAdminName: body.proposedAdminName.trim(),
        proposedAdminEmail: adminEmail,
        requestedPlanCode: body.requestedPlanCode?.trim() || null,
        termsAcceptedAt: now,
      };

      if (existing?.status === "EMAIL_PENDING") {
        return transaction.hospitalApplication.update({
          where: { id: existing.id },
          data: { ...data, verificationTokenHash: tokenHash, verificationExpiresAt: new Date(now.getTime() + VERIFICATION_LIFETIME_MS) },
          select: { id: true, status: true },
        });
      }
      if (existing) return existing;

      const created = await transaction.hospitalApplication.create({
        data: {
          ...data,
          status: "EMAIL_PENDING",
          verificationTokenHash: tokenHash,
          verificationExpiresAt: new Date(now.getTime() + VERIFICATION_LIFETIME_MS),
        },
        select: { id: true, status: true },
      });
      await transaction.auditEvent.create({
        data: {
          action: "hospital.application_submitted",
          resourceType: "hospital_application",
          resourceId: created.id,
          metadata: { hospitalType: body.hospitalType, bedCount: body.bedCount, branchCount: body.branchCount } as Prisma.InputJsonObject,
        },
      });
      return created;
    });

    if (application.status === "EMAIL_PENDING") {
      try {
        await this.emailDelivery.sendHospitalApplicationVerification(officialEmail, token);
      } catch {
        await this.prisma.$transaction([
          this.prisma.hospitalApplication.updateMany({
            where: { id: application.id, verificationTokenHash: tokenHash },
            data: { verificationTokenHash: null, verificationExpiresAt: null },
          }),
          this.prisma.auditEvent.create({
            data: {
              action: "hospital.application_verification_delivery_failed",
              resourceType: "hospital_application",
              resourceId: application.id,
              metadata: { provider: "resend" } as Prisma.InputJsonObject,
            },
          }),
        ]);
        throw new ServiceUnavailableException({
          code: "APPLICATION_EMAIL_UNAVAILABLE",
          message: "The application could not be verified because email delivery is temporarily unavailable. Please try again later.",
        });
      }
    }

    return { message: "If the application can be accepted, verification instructions will be sent to the official email." };
  }

  @Post("verify-email")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify the official email on a one-time hospital application link" })
  async verifyEmail(@Body() body: VerifyHospitalApplicationDto, @Req() request: RequestLike) {
    await consumeFixedWindowLimit(this.prisma, [
      hashRateLimitKey(`application-verification-ip:${request.ip ?? "unknown"}`),
      hashRateLimitKey(`application-verification-token:${hashSessionToken(body.token)}`),
    ], 10, 15);

    const tokenHash = hashSessionToken(body.token);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (transaction) => {
        const application = await transaction.hospitalApplication.findUnique({
          where: { verificationTokenHash: tokenHash },
          select: { id: true, status: true, verificationExpiresAt: true },
        });
        if (!application || application.status !== "EMAIL_PENDING" || !application.verificationExpiresAt || application.verificationExpiresAt <= now) {
          throw new BadRequestException("This verification link is invalid or expired. Submit the application again to request a new link.");
        }
        const updated = await transaction.hospitalApplication.updateMany({
          where: { id: application.id, status: "EMAIL_PENDING", verificationTokenHash: tokenHash, verificationExpiresAt: { gt: now } },
          data: { status: "PENDING_REVIEW", emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null },
        });
        if (updated.count !== 1) throw new BadRequestException("This verification link is invalid or expired.");
        await transaction.auditEvent.create({
          data: { action: "hospital.application_email_verified", resourceType: "hospital_application", resourceId: application.id },
        });
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw error;
    }
    return { message: "Your official email has been verified. The application is now queued for review." };
  }
}
