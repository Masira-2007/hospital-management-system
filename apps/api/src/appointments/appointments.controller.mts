import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Body, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MembershipRole, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.mjs";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { AppointmentListDto, CancelAppointmentDto, CreateAppointmentDto } from "./appointment.dto.mjs";

const BOOKABLE_DOCTOR_ROLES: MembershipRole[] = ["DOCTOR", "SPECIALIST_DOCTOR"];
const MAX_SCHEDULE_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;
const MINIMUM_BOOKING_NOTICE_MS = 10 * 60 * 1000;

@ApiTags("appointments")
@ApiCookieAuth("jr-xpert-session")
@UseGuards(SessionAuthGuard, TenantMembershipGuard)
@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "List bounded appointment metadata for an authorized hospital scope" })
  async list(@Query() query: AppointmentListDto, @Req() request: RequestLike) {
    const tenant = request.tenant!;
    const userId = request.authSession!.user.id;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for appointments.");
    await this.requirePermission("appointment.read", tenant.memberships.map(({ role }) => role));

    const from = query.from ? new Date(query.from) : query.to ? new Date(new Date(query.to).getTime() - MAX_SCHEDULE_RANGE_MS) : new Date();
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + MAX_SCHEDULE_RANGE_MS);
    if (from && to && (from >= to || to.getTime() - from.getTime() > MAX_SCHEDULE_RANGE_MS)) {
      throw new BadRequestException("Choose a valid date range of no more than 31 days.");
    }
    const startsAt = { gte: from, lt: to };
    const where: Prisma.AppointmentWhereInput = {
      organizationId: tenant.organizationId,
      hospitalId: tenant.hospitalId,
      ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(startsAt ? { startsAt } : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const result = await this.prisma.$transaction(async (transaction) => {
      await this.setTenantContext(transaction, userId, tenant.organizationId, tenant.hospitalId!, tenant.branchId);
      const [items, total] = await Promise.all([
        transaction.appointment.findMany({
          where,
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          skip,
          take: query.limit,
          select: {
            id: true, startsAt: true, durationMinutes: true, status: true, createdAt: true,
            patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
            doctor: { select: { id: true, user: { select: { displayName: true } } } },
          },
        }),
        transaction.appointment.count({ where }),
      ]);
      await transaction.auditEvent.createMany({ data: {
        organizationId: tenant.organizationId,
        actorUserId: userId,
        action: "appointment.listed",
        resourceType: "appointment_collection",
        metadata: { hospitalId: tenant.hospitalId, branchScoped: Boolean(tenant.branchId), page: query.page, resultCount: items.length } as Prisma.InputJsonObject,
      } });
      return { items, total };
    });

    return { items: result.items, page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) };
  }

  @Post()
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "Request an appointment with verified patient and doctor membership scope" })
  async create(@Body() body: CreateAppointmentDto, @Req() request: RequestLike) {
    const tenant = request.tenant!;
    const userId = request.authSession!.user.id;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for appointments.");
    await this.requirePermission("appointment.schedule", tenant.memberships.map(({ role }) => role));

    const startsAt = new Date(body.startsAt);
    const now = Date.now();
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now + MINIMUM_BOOKING_NOTICE_MS || startsAt.getTime() > now + MAX_FUTURE_SCHEDULE_MS) {
      throw new BadRequestException("Appointments must be scheduled at least 10 minutes ahead and within the next year.");
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.setTenantContext(transaction, userId, tenant.organizationId, tenant.hospitalId!, tenant.branchId);
        const patient = await transaction.patient.findFirst({
          where: {
            id: body.patientId,
            organizationId: tenant.organizationId,
            hospitalId: tenant.hospitalId!,
            ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
          },
          select: { id: true },
        });
        if (!patient) throw new BadRequestException("The selected patient is not available in this hospital scope.");

        const doctor = await transaction.membership.findFirst({
          where: {
            id: body.doctorMembershipId,
            organizationId: tenant.organizationId,
            hospitalId: tenant.hospitalId!,
            role: { in: BOOKABLE_DOCTOR_ROLES },
            status: "ACTIVE",
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
              tenant.branchId ? { OR: [{ branchId: null }, { branchId: tenant.branchId }] } : { branchId: null },
            ],
            organization: { status: "ACTIVE" },
            hospital: { is: { status: "ACTIVE" } },
            user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
          },
          select: { id: true },
        });
        if (!doctor) throw new BadRequestException("The selected clinician is not available in this hospital scope.");

        const appointment = await transaction.appointment.create({
          data: {
            organizationId: tenant.organizationId,
            hospitalId: tenant.hospitalId!,
            branchId: tenant.branchId,
            patientId: patient.id,
            doctorMembershipId: doctor.id,
            startsAt,
            durationMinutes: body.durationMinutes,
          },
          select: { id: true, startsAt: true, durationMinutes: true, status: true, patientId: true, doctorMembershipId: true, createdAt: true },
        });
        await transaction.auditEvent.createMany({ data: {
          organizationId: tenant.organizationId,
          actorUserId: userId,
          action: "appointment.requested",
          resourceType: "appointment",
          resourceId: appointment.id,
          metadata: { hospitalId: tenant.hospitalId, branchId: tenant.branchId, patientId: patient.id, doctorMembershipId: doctor.id, startsAt: startsAt.toISOString() } as Prisma.InputJsonObject,
        } });
        return { appointment };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      if (typeof error === "object" && error !== null && "code" in error && ["P2004", "P2034"].includes(String(error.code))) {
        throw new ConflictException("That clinician already has an appointment during this time. Choose another time.");
      }
      throw error;
    }
  }

  @Post(":appointmentId/cancel")
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "Cancel a future requested or confirmed appointment in the authorized hospital scope" })
  async cancel(@Param("appointmentId") appointmentId: string, @Body() body: CancelAppointmentDto, @Req() request: RequestLike) {
    const tenant = request.tenant!;
    const userId = request.authSession!.user.id;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for appointments.");
    await this.requirePermission("appointment.cancel", tenant.memberships.map(({ role }) => role));

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.setTenantContext(transaction, userId, tenant.organizationId, tenant.hospitalId!, tenant.branchId);
        const scope: Prisma.AppointmentWhereInput = {
          id: appointmentId,
          organizationId: tenant.organizationId,
          hospitalId: tenant.hospitalId!,
          ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
        };
        const current = await transaction.appointment.findFirst({
          where: scope,
          select: { id: true, startsAt: true, status: true },
        });
        if (!current) throw new NotFoundException("Appointment not found.");
        if (current.status === "CANCELLED") return { appointment: { id: current.id, status: current.status }, changed: false };

        const now = new Date();
        if ((current.status !== "REQUESTED" && current.status !== "CONFIRMED") || current.startsAt <= now) {
          throw new ConflictException("Only future requested or confirmed appointments can be cancelled.");
        }

        const updated = await transaction.appointment.updateMany({
          where: { ...scope, status: current.status, startsAt: { gt: now } },
          data: { status: "CANCELLED" },
        });
        if (updated.count !== 1) throw new ConflictException("Appointment changed while cancellation was in progress. Refresh and try again.");

        await transaction.auditEvent.createMany({
          data: {
            organizationId: tenant.organizationId,
            actorUserId: userId,
            action: "appointment.cancelled",
            resourceType: "appointment",
            resourceId: current.id,
            metadata: { hospitalId: tenant.hospitalId, branchId: tenant.branchId, reasonCode: body.reasonCode } as Prisma.InputJsonObject,
          },
        });
        return { appointment: { id: current.id, status: "CANCELLED" as const }, changed: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2034") {
        throw new ConflictException("Appointment changed while cancellation was in progress. Refresh and try again.");
      }
      throw error;
    }
  }

  private async requirePermission(permissionId: string, roles: MembershipRole[]) {
    const permission = await this.prisma.rolePermission.findFirst({
      where: { permissionId, roleCode: { in: roles } },
      select: { permissionId: true },
    });
    if (!permission) throw new ForbiddenException("Your active role does not grant this appointment action.");
  }

  private async setTenantContext(transaction: Prisma.TransactionClient, userId: string, organizationId: string, hospitalId: string, branchId: string | null) {
    await transaction.$queryRaw`SELECT
      set_config('app.user_id', ${userId}, true),
      set_config('app.organization_id', ${organizationId}, true),
      set_config('app.hospital_id', ${hospitalId}, true),
      set_config('app.branch_id', ${branchId ?? ""}, true)`;
  }
}
