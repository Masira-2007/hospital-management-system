import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service.mjs";
import type { RequestLike } from "../auth/auth.types.mjs";
import { SessionAuthGuard } from "../auth/session-auth.guard.mjs";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard.mjs";
import { PatientListDto } from "./patient-list.dto.mjs";
import { PatientRegistrationDto } from "./patient-registration.dto.mjs";

@ApiTags("patients")
@ApiCookieAuth("jr-xpert-session")
@UseGuards(SessionAuthGuard, TenantMembershipGuard)
@Controller("patients")
export class PatientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against the signed-in patient's active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against the signed-in patient's active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against the signed-in patient's active membership." })
  @ApiOperation({ summary: "List patient records explicitly granted to the signed-in patient account" })
  async listMyPatientRecords(@Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const tenant = request.tenant!;
    if (!tenant.hospitalId || !tenant.memberships.some(({ role }) => role === "PATIENT")) {
      throw new ForbiddenException("A patient account and an active hospital context are required.");
    }

    const grants = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT
        set_config('app.user_id', ${userId}, true),
        set_config('app.organization_id', ${tenant.organizationId}, true),
        set_config('app.hospital_id', ${tenant.hospitalId}, true),
        set_config('app.branch_id', ${tenant.branchId ?? ""}, true)`;
      const visibleGrants = await transaction.patientAccessGrant.findMany({
        where: {
          userId,
          organizationId: tenant.organizationId,
          canViewRecords: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          patient: { is: {
            organizationId: tenant.organizationId,
            hospitalId: tenant.hospitalId!,
            ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
          } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          relationship: true,
          patient: { select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          } },
        },
      });
      await transaction.auditEvent.createMany({
        data: {
          organizationId: tenant.organizationId,
          actorUserId: userId,
          action: "patient.self_service_records_listed",
          resourceType: "patient_self_service",
          metadata: {
            hospitalId: tenant.hospitalId,
            branchScoped: Boolean(tenant.branchId),
            resultCount: visibleGrants.length,
          } as Prisma.InputJsonObject,
        },
      });
      return visibleGrants;
    });

    return {
      patients: grants.map(({ relationship, patient }) => ({ relationship, patient })),
      total: grants.length,
    };
  }

  @Get()
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "List a bounded, tenant- and hospital-scoped patient directory" })
  async listPatients(@Query() query: PatientListDto, @Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const tenant = request.tenant!;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for patient data.");
    const permission = await this.prisma.rolePermission.findFirst({
      where: {
        permissionId: "patient.directory.read",
        roleCode: { in: tenant.memberships.map(({ role }) => role) },
      },
      select: { permissionId: true },
    });
    if (!permission) {
      throw new ForbiddenException("Your active role does not grant patient-directory access.");
    }

    const searchTerm = query.q?.trim();
    const where: Prisma.PatientWhereInput = {
      organizationId: tenant.organizationId,
      hospitalId: tenant.hospitalId,
      ...(tenant.branchId ? { branchId: tenant.branchId } : {}),
      ...(searchTerm
        ? {
            OR: [
              { mrn: { contains: searchTerm, mode: "insensitive" } },
              { firstName: { contains: searchTerm, mode: "insensitive" } },
              { lastName: { contains: searchTerm, mode: "insensitive" } },
              { phone: { contains: searchTerm, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await this.prisma.$transaction(async (transaction) => {
      // Transaction-local settings are consumed by PostgreSQL RLS policies and cannot leak through a pooled connection.
      await transaction.$queryRaw`SELECT
        set_config('app.user_id', ${userId}, true),
        set_config('app.organization_id', ${tenant.organizationId}, true),
        set_config('app.hospital_id', ${tenant.hospitalId}, true),
        set_config('app.branch_id', ${tenant.branchId ?? ""}, true)`;
      const [items, total] = await Promise.all([
        transaction.patient.findMany({
          where,
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
          skip,
          take: query.limit,
          select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, createdAt: true },
        }),
        transaction.patient.count({ where }),
      ]);
      await transaction.auditEvent.createMany({
        data: {
          organizationId: tenant.organizationId,
          actorUserId: userId,
          action: "patient.directory_listed",
          resourceType: "patient_directory",
          metadata: {
            hospitalId: tenant.hospitalId,
            branchScoped: Boolean(tenant.branchId),
            page: query.page,
            limit: query.limit,
            resultCount: items.length,
            searchUsed: Boolean(searchTerm),
          } as Prisma.InputJsonObject,
        },
      });
      return { items, total };
    });

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  @Post()
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "Register a patient in the verified hospital scope; MRN is server-generated" })
  async registerPatient(@Body() body: PatientRegistrationDto, @Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const tenant = request.tenant!;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for patient registration.");
    const permission = await this.prisma.rolePermission.findFirst({
      where: {
        permissionId: "patient.record.create",
        roleCode: { in: tenant.memberships.map(({ role }) => role) },
      },
      select: { permissionId: true },
    });
    if (!permission) throw new ForbiddenException("Your active role does not grant patient registration.");

    const firstName = body.firstName.trim();
    const lastName = body.lastName.trim();
    if (!firstName || !lastName) throw new BadRequestException("Provide the patient's first and last name.");
    const dateOfBirth = body.dateOfBirth ? new Date(`${body.dateOfBirth}T00:00:00.000Z`) : null;
    if (dateOfBirth) {
      const earliestAllowed = new Date();
      earliestAllowed.setUTCFullYear(earliestAllowed.getUTCFullYear() - 130);
      if (dateOfBirth.getTime() > Date.now() || dateOfBirth < earliestAllowed) {
        throw new BadRequestException("The date of birth is outside the accepted range.");
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const mrn = `JRX-${randomBytes(12).toString("hex").toUpperCase()}`;
      try {
        return await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT
            set_config('app.user_id', ${userId}, true),
            set_config('app.organization_id', ${tenant.organizationId}, true),
            set_config('app.hospital_id', ${tenant.hospitalId}, true),
            set_config('app.branch_id', ${tenant.branchId ?? ""}, true)`;
          const patient = await transaction.patient.create({
            data: {
              organizationId: tenant.organizationId,
              hospitalId: tenant.hospitalId!,
              branchId: tenant.branchId,
              mrn,
              firstName,
              lastName,
              dateOfBirth,
              phone: body.phone?.trim() || null,
              email: body.email?.trim().toLowerCase() || null,
            },
            select: { id: true, mrn: true, firstName: true, lastName: true, createdAt: true },
          });
          await transaction.auditEvent.createMany({ data: {
            organizationId: tenant.organizationId,
            actorUserId: userId,
            action: "patient.registered",
            resourceType: "patient",
            resourceId: patient.id,
            metadata: { hospitalId: tenant.hospitalId, branchId: tenant.branchId } as Prisma.InputJsonObject,
          } });
          return { patient };
        });
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
        const isMrnCollision = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
        if (isMrnCollision && attempt < 2) continue;
        if (isMrnCollision) throw new BadRequestException("Unable to allocate a patient number. Retry the registration.");
        throw error;
      }
    }
    throw new BadRequestException("Unable to allocate a patient number. Retry the registration.");
  }
}
