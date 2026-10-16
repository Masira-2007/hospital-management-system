import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { hashSessionToken } from "../security/security.crypto.js";
import { getHeader, type RequestLike } from "./auth.types.js";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session";
}

export function readSessionToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName();
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(token) ? token : null;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const token = readSessionToken(getHeader(request, "cookie"));
    if (!token) throw new UnauthorizedException("Authentication required.");

    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { select: { id: true, email: true, displayName: true, status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || session.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Authentication required.");
    }

    const refreshed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    if (refreshed.count !== 1) throw new UnauthorizedException("Authentication required.");
    request.authSession = { id: session.id, user: session.user };
    return true;
  }
}
