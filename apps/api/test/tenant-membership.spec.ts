import assert from "node:assert/strict";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import { RequestLike } from "../src/auth/auth.types";
import { TenantMembershipGuard } from "../src/auth/tenant-membership.guard";
import { PrismaService } from "../src/database/prisma.service";

function contextFor(request: RequestLike): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

test("tenant guard rejects a client-selected hospital when no active membership grants it", async () => {
  const prisma = {
    membership: { findMany: async () => [] },
    hospital: { findFirst: async () => ({ name: "Other hospital" }) },
    branch: { findFirst: async () => ({ name: "Other branch" }) },
  } as unknown as PrismaService;
  const guard = new TenantMembershipGuard(prisma);
  const request: RequestLike = {
    headers: { "x-organization-id": "org-1", "x-hospital-id": "hospital-2" },
    authSession: { id: "session-1", user: { id: "user-1", email: "staff@example.test", displayName: "Staff" } },
  };

  await assert.rejects(() => guard.canActivate(contextFor(request)), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    assert.equal(error.getStatus(), 403);
    return true;
  });
});

test("tenant guard attaches verified membership scope and allows an organization role in its own hospital", async () => {
  const prisma = {
    membership: {
      findMany: async () => [{
        id: "membership-1",
        role: "ORGANIZATION_OWNER",
        department: null,
        hospitalId: null,
        branchId: null,
        organization: { id: "org-1", name: "JR Xpert Group" },
      }],
    },
    hospital: { findFirst: async () => ({ name: "Ahmedabad Hospital" }) },
    branch: { findFirst: async () => ({ name: "Main Branch" }) },
  } as unknown as PrismaService;
  const guard = new TenantMembershipGuard(prisma);
  const request: RequestLike = {
    headers: { "x-organization-id": "org-1", "x-hospital-id": "hospital-1", "x-branch-id": "branch-1" },
    authSession: { id: "session-1", user: { id: "user-1", email: "owner@example.test", displayName: "Owner" } },
  };

  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.tenant, {
    organizationId: "org-1",
    organizationName: "JR Xpert Group",
    hospitalId: "hospital-1",
    hospitalName: "Ahmedabad Hospital",
    branchId: "branch-1",
    branchName: "Main Branch",
    memberships: [{ id: "membership-1", role: "ORGANIZATION_OWNER", department: null }],
  });
});

test("a branch-scoped member cannot broaden access by omitting the branch header", async () => {
  const prisma = {
    membership: {
      findMany: async () => [{
        id: "membership-1",
        role: "DOCTOR",
        department: "Medicine",
        hospitalId: "hospital-1",
        branchId: "branch-1",
        organization: { id: "org-1", name: "JR Xpert Group" },
      }],
    },
    hospital: { findFirst: async () => ({ name: "Ahmedabad Hospital" }) },
    branch: { findFirst: async () => ({ name: "Main Branch" }) },
  } as unknown as PrismaService;
  const guard = new TenantMembershipGuard(prisma);
  const request: RequestLike = {
    headers: { "x-organization-id": "org-1", "x-hospital-id": "hospital-1" },
    authSession: { id: "session-1", user: { id: "user-1", email: "doctor@example.test", displayName: "Doctor" } },
  };

  await assert.rejects(() => guard.canActivate(contextFor(request)), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    return true;
  });
});
