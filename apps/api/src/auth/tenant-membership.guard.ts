import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { getHeader, RequestLike } from "./auth.types";

@Injectable()
export class TenantMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const user = request.authSession?.user;
    if (!user) throw new UnauthorizedException("Authentication required.");

    const organizationId = getHeader(request, "x-organization-id")?.trim();
    const hospitalId = getHeader(request, "x-hospital-id")?.trim() || null;
    const branchId = getHeader(request, "x-branch-id")?.trim() || null;
    if (!organizationId || organizationId.length > 64 || (hospitalId && hospitalId.length > 64) || (branchId && branchId.length > 64)) {
      throw new ForbiddenException("Select an authorized hospital context.");
    }
    if (branchId && !hospitalId) throw new ForbiddenException("A branch requires a hospital context.");

    const now = new Date();
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: user.id,
        organizationId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        organization: { select: { id: true, name: true } },
        hospital: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, hospitalId: true } },
      },
    });

    const eligible = memberships.filter((membership) => {
      if (membership.hospitalId && membership.hospitalId !== hospitalId) return false;
      if (membership.branchId && membership.branchId !== branchId) return false;
      return true;
    });
    if (eligible.length === 0) throw new ForbiddenException("No active membership grants access to this hospital context.");

    let hospitalName: string | null = null;
    let branchName: string | null = null;
    if (hospitalId) {
      const hospital = await this.prisma.hospital.findFirst({
        where: { id: hospitalId, organizationId },
        select: { name: true },
      });
      if (!hospital) throw new ForbiddenException("No active membership grants access to this hospital context.");
      hospitalName = hospital.name;
    }
    if (branchId && hospitalId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, hospitalId },
        select: { name: true },
      });
      if (!branch) throw new ForbiddenException("No active membership grants access to this hospital context.");
      branchName = branch.name;
    }

    request.tenant = {
      organizationId,
      organizationName: eligible[0].organization.name,
      hospitalId,
      hospitalName,
      branchId,
      branchName,
      memberships: eligible.map(({ id, role, department }) => ({ id, role, department })),
    };
    return true;
  }
}
