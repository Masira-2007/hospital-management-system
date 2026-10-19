import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import { RequestLike } from "../src/auth/auth.types.mjs";
import { PrismaService } from "../src/database/prisma.service.mjs";
import { PatientsController } from "../src/patients/patients.controller.mjs";

test("patient directory applies organization, hospital and branch filters and returns a limited field set", async () => {
  let listQuery: Record<string, unknown> | undefined;
  let auditData: Record<string, unknown> | undefined;
  let rlsContext: unknown;
  const patient = {
    id: "patient-1",
    mrn: "MRN-1",
    firstName: "Asha",
    lastName: "Shah",
    phone: "+910000000000",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const prisma = {
    rolePermission: { findFirst: async () => ({ permissionId: "patient.directory.read" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async (query: unknown) => { rlsContext = query; return []; },
      patient: {
        findMany: async (query: Record<string, unknown>) => { listQuery = query; return [patient]; },
        count: async () => 1,
      },
      auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { auditData = data; } },
    }),
    patient: {
      findMany: async (query: Record<string, unknown>) => {
        listQuery = query;
        return [patient];
      },
      count: async () => 1,
    },
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
  assert.ok(rlsContext, "request installs transaction-scoped tenant context for PostgreSQL RLS");
  assert.equal(JSON.stringify(auditData).includes("Shah"), false);
});

test("patient directory denies an authenticated role without directory permission", async () => {
  const controller = new PatientsController({
    rolePermission: { findFirst: async () => null },
  } as unknown as PrismaService);
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

test("patient self-service returns only explicitly granted records in the selected tenant and audits the read", async () => {
  let grantQuery: Record<string, unknown> | undefined;
  let auditData: Record<string, unknown> | undefined;
  let rlsContext: unknown;
  const patient = {
    id: "patient-self-1",
    mrn: "JRX-TEST-1",
    firstName: "Asha",
    lastName: "Shah",
    dateOfBirth: new Date("1990-01-01T00:00:00Z"),
  };
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async (query: unknown) => { rlsContext = query; return []; },
      patientAccessGrant: {
        findMany: async (query: Record<string, unknown>) => {
          grantQuery = query;
          return [{ relationship: "SELF", patient }];
        },
      },
      auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { auditData = data; } },
    }),
  } as unknown as PrismaService;
  const controller = new PatientsController(prisma);
  const request: RequestLike = {
    headers: {},
    authSession: { id: "session-1", user: { id: "patient-user-1", email: "asha@example.test", displayName: "Asha" } },
    tenant: {
      organizationId: "org-1",
      organizationName: "JR Xpert Group",
      hospitalId: "hospital-1",
      hospitalName: "Ahmedabad Hospital",
      branchId: "branch-1",
      branchName: "Main Branch",
      memberships: [{ id: "membership-1", role: "PATIENT", department: null }],
    },
  };

  const result = await controller.listMyPatientRecords(request);

  assert.deepEqual(result, { patients: [{ relationship: "SELF", patient }], total: 1 });
  assert.deepEqual(grantQuery?.where && (grantQuery.where as Record<string, unknown>).patient, {
    is: { organizationId: "org-1", hospitalId: "hospital-1", branchId: "branch-1" },
  });
  const filters = grantQuery?.where as Record<string, unknown>;
  assert.equal(filters.userId, "patient-user-1");
  assert.equal(filters.organizationId, "org-1");
  assert.equal(filters.canViewRecords, true);
  assert.equal(filters.revokedAt, null);
  assert.equal(Array.isArray(filters.OR), true);
  assert.ok(((filters.OR as Array<Record<string, unknown>>)[1].expiresAt as { gt: unknown }).gt instanceof Date);
  assert.deepEqual(grantQuery?.select, {
    relationship: true,
    patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true } },
  });
  assert.ok(rlsContext, "request installs transaction-scoped patient and tenant context");
  assert.equal(JSON.stringify(auditData).includes(patient.id), false);
  assert.deepEqual(auditData?.metadata, { hospitalId: "hospital-1", branchScoped: true, resultCount: 1 });
});

test("patient self-service denies staff identities and contexts without an active hospital", async () => {
  const controller = new PatientsController({} as unknown as PrismaService);
  const staffRequest: RequestLike = {
    headers: {},
    authSession: { id: "session-1", user: { id: "staff-1", email: "staff@example.test", displayName: "Staff" } },
    tenant: {
      organizationId: "org-1", organizationName: "JR Xpert Group", hospitalId: "hospital-1", hospitalName: "Hospital",
      branchId: null, branchName: null, memberships: [{ id: "staff-membership", role: "DOCTOR", department: null }],
    },
  };
  await assert.rejects(() => controller.listMyPatientRecords(staffRequest), (error: unknown) => error instanceof ForbiddenException);

  const unscopedPatientRequest: RequestLike = {
    ...staffRequest,
    authSession: { id: "session-2", user: { id: "patient-1", email: "patient@example.test", displayName: "Patient" } },
    tenant: {
      organizationId: "org-1", organizationName: "JR Xpert Group", hospitalId: null, hospitalName: null,
      branchId: null, branchName: null, memberships: [{ id: "patient-membership", role: "PATIENT", department: null }],
    },
  };
  await assert.rejects(() => controller.listMyPatientRecords(unscopedPatientRequest), (error: unknown) => error instanceof ForbiddenException);
});
