import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { getHeader, RequestLike } from "./auth.types";
import { sessionCookieName } from "./session-auth.guard";

@Injectable()
export class SameSiteCsrfGuard implements CanActivate {
  constructor(private readonly allowedOrigins: string[]) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike & { method?: string }>();
    const method = request.method?.toUpperCase() ?? "GET";
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

    const origin = getHeader(request, "origin");
    if (origin && !this.allowedOrigins.includes(origin)) {
      throw new ForbiddenException("Request origin is not allowed.");
    }

    const cookieHeader = getHeader(request, "cookie") ?? "";
    const hasSessionCookie = cookieHeader
      .split(";")
      .some((part) => part.trim().startsWith(`${sessionCookieName()}=`));
    if (hasSessionCookie && !origin) {
      throw new ForbiddenException("An Origin header is required for session-authenticated changes.");
    }
    return true;
  }
}
