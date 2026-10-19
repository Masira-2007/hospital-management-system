import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.mjs";
import type { RequestLike } from "./auth.types.mjs";

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const userId = request.authSession?.user.id;
    if (!userId) throw new UnauthorizedException("Authentication required.");

    const membership = await this.prisma.membership.findFirst({
        where: {
          userId,
          role: { in: ["SUPER_ADMIN", "PLATFORM_ADMIN"] },
          status: "ACTIVE",
          hospitalId: null,
          branchId: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          organization: { is: { status: "ACTIVE" } },
        },
        select: { id: true },
      });

    if (!membership) {
      throw new ForbiddenException("Platform administrator access is required.");
    }
    return true;
  }
}
