export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  authSession?: {
    id: string;
    user: { id: string; email: string; displayName: string };
  };
  tenant?: {
    organizationId: string;
    organizationName: string;
    hospitalId: string | null;
    hospitalName: string | null;
    branchId: string | null;
    branchName: string | null;
    memberships: Array<{ id: string; role: string; department: string | null }>;
  };
}

export interface ResponseLike {
  setHeader(name: string, value: string): void;
}

export function getHeader(request: RequestLike, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
