import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { RequestLike } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { TenantMembershipGuard } from "../auth/tenant-membership.guard";
import { PatientListDto } from "./patient-list.dto";

const PATIENT_DIRECTORY_ROLES = new Set([
  "HOSPITAL_ADMIN",
  "HOSPITAL_MANAGER",
  "MEDICAL_DIRECTOR",
  "DOCTOR",
  "SPECIALIST_DOCTOR",
  "NURSE",
  "RECEPTIONIST",
]);

@ApiTags("patients")
@ApiCookieAuth("jr-xpert-session")
@UseGuards(SessionAuthGuard, TenantMembershipGuard)
@Controller("patients")
export class PatientsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiHeader({ name: "x-organization-id", required: true, description: "Organization context; checked against active membership." })
  @ApiHeader({ name: "x-hospital-id", required: true, description: "Hospital context; checked against active membership." })
  @ApiHeader({ name: "x-branch-id", required: false, description: "Optional branch scope; checked against active membership." })
  @ApiOperation({ summary: "List a bounded, tenant- and hospital-scoped patient directory" })
  async listPatients(@Query() query: PatientListDto, @Req() request: RequestLike) {
    const userId = request.authSession!.user.id;
    const tenant = request.tenant!;
    if (!tenant.hospitalId) throw new ForbiddenException("A hospital context is required for patient data.");
    if (!tenant.memberships.some((membership) => PATIENT_DIRECTORY_ROLES.has(membership.role))) {
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        skip,
        take: query.limit,
        select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, createdAt: true },
      }),
      this.prisma.patient.count({ where }),
    ]);

    await this.prisma.auditEvent.create({
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

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
