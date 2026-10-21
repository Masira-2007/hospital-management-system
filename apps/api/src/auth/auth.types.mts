import type { MembershipRole } from "@prisma/client";

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  authSession?: {
    id: string;
    activeMembershipId?: string | null;
    user: { id: string; email: string; displayName: string };
  };
  tenant?: {
    organizationId: string;
    organizationName: string;
    hospitalId: string | null;
    hospitalName: string | null;
    branchId: string | null;
    branchName: string | null;
    memberships: Array<{ id: string; role: MembershipRole; department: string | null }>;
  };
}

export interface ResponseLike {
  setHeader(name: string, value: string | string[]): void;
  statusCode?: number;
}

export function getHeader(request: RequestLike, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
