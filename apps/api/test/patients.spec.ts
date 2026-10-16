import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import { RequestLike } from "../src/auth/auth.types";
import { PrismaService } from "../src/database/prisma.service";
import { PatientsController } from "../src/patients/patients.controller";

test("patient directory applies organization, hospital and branch filters and returns a limited field set", async () => {
  let listQuery: Record<string, unknown> | undefined;
  let auditData: Record<string, unknown> | undefined;
  const patient = {
    id: "patient-1",
    mrn: "MRN-1",
    firstName: "Asha",
    lastName: "Shah",
    phone: "+910000000000",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const prisma = {
    patient: {
      findMany: async (query: Record<string, unknown>) => {
        listQuery = query;
        return [patient];
      },
      count: async () => 1,
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { auditData = data; } },
  } as unknown as PrismaService;
  const controller = new PatientsController(prisma);
  const request: RequestLike = {
    headers: {},
    authSession: { id: "session-1", user: { id: "user-1", email: "doctor@example.test", displayName: "Doctor" } },
    tenant: {
      organizationId: "org-1",
      organizationName: "JR Xpert Group",
      hospitalId: "hospital-1",
      hospitalName: "Ahmedabad Hospital",
      branchId: "branch-1",
      branchName: "Main Branch",
      memberships: [{ id: "membership-1", role: "DOCTOR", department: "Medicine" }],
    },
  };

  const result = await controller.listPatients({ q: "Shah", page: 2, limit: 10 }, request);

  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(listQuery?.where, {
    organizationId: "org-1",
    hospitalId: "hospital-1",
    branchId: "branch-1",
    OR: [
      { mrn: { contains: "Shah", mode: "insensitive" } },
      { firstName: { contains: "Shah", mode: "insensitive" } },
      { lastName: { contains: "Shah", mode: "insensitive" } },
      { phone: { contains: "Shah", mode: "insensitive" } },
    ],
  });
  assert.deepEqual(listQuery?.select, { id: true, mrn: true, firstName: true, lastName: true, phone: true, createdAt: true });
  assert.deepEqual(result.items, [patient]);
  assert.equal(JSON.stringify(auditData).includes("Shah"), false);
});

test("patient directory denies an authenticated role without directory permission", async () => {
  const controller = new PatientsController({} as PrismaService);
  const request: RequestLike = {
    headers: {},
    authSession: { id: "session-1", user: { id: "user-1", email: "staff@example.test", displayName: "Staff" } },
    tenant: {
      organizationId: "org-1",
      organizationName: "JR Xpert Group",
      hospitalId: "hospital-1",
      hospitalName: "Ahmedabad Hospital",
      branchId: null,
      branchName: null,
      memberships: [{ id: "membership-1", role: "PHARMACIST", department: null }],
    },
  };

  await assert.rejects(() => controller.listPatients({ page: 1, limit: 25 }, request), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    return true;
  });
});
