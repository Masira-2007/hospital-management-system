import assert from "node:assert/strict";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import type { RequestLike } from "../src/auth/auth.types.mjs";
import { PrismaService } from "../src/database/prisma.service.mjs";
import { PatientsController } from "../src/patients/patients.controller.mjs";
import type { PatientRegistrationDto } from "../src/patients/patient-registration.dto.mjs";

function receptionistRequest(): RequestLike {
  return {
    headers: { "x-organization-id": "client-org", "x-hospital-id": "client-hospital", "x-branch-id": "client-branch" },
    authSession: { id: "session-a", user: { id: "user-a", email: "staff@example.test", displayName: "Receptionist" } },
    tenant: {
      organizationId: "org-a", organizationName: "Group A", hospitalId: "hospital-a", hospitalName: "Hospital A",
      branchId: "branch-a", branchName: "Main Branch", memberships: [{ id: "membership-a", role: "RECEPTIONIST", department: null }],
    },
  };
}

test("patient registration derives all tenant fields from verified context and minimizes audit metadata", async () => {
  let insert: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  let contextApplied = false;
  const saved = { id: "patient-a", mrn: "JRX-EXAMPLE", firstName: "Asha", lastName: "Shah", createdAt: new Date("2026-10-17T00:00:00Z") };
  const controller = new PatientsController({
    rolePermission: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.permissionId, "patient.record.create");
      assert.deepEqual((where.roleCode as { in: string[] }).in, ["RECEPTIONIST"]);
      return { permissionId: "patient.record.create" };
    } },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => { contextApplied = true; return []; },
      patient: { create: async ({ data }: { data: Record<string, unknown> }) => { insert = data; return saved; } },
      auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { audit = data; } },
    }),
  } as unknown as PrismaService);
  const body = {
    firstName: " Asha ", lastName: " Shah ", dateOfBirth: "1990-02-03", phone: "+91 98765 43210", email: "ASHA@example.test",
    organizationId: "attacker-org", hospitalId: "attacker-hospital", branchId: "attacker-branch", mrn: "ATTACKER-MRN",
  } as PatientRegistrationDto;

  const result = await controller.registerPatient(body, receptionistRequest());

  assert.equal(insert?.organizationId, "org-a");
  assert.equal(insert?.hospitalId, "hospital-a");
  assert.equal(insert?.branchId, "branch-a");
  assert.match(String(insert?.mrn), /^JRX-[A-F0-9]{24}$/);
  assert.equal(insert?.firstName, "Asha");
  assert.equal(insert?.lastName, "Shah");
  assert.equal(insert?.email, "asha@example.test");
  assert.equal(contextApplied, true);
  assert.equal(audit?.action, "patient.registered");
  assert.equal(audit?.resourceId, "patient-a");
  assert.equal(JSON.stringify(audit).includes("Asha"), false);
  assert.equal(JSON.stringify(audit).includes("98765"), false);
  assert.deepEqual(result, { patient: saved });
});

test("patient registration requires explicit create permission", async () => {
  let transactions = 0;
  const controller = new PatientsController({
    rolePermission: { findFirst: async () => null },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(
    () => controller.registerPatient({ firstName: "Asha", lastName: "Shah" } as PatientRegistrationDto, receptionistRequest()),
    ForbiddenException,
  );
  assert.equal(transactions, 0);
});

test("invalid date of birth is rejected before database access", async () => {
  let transactions = 0;
  const controller = new PatientsController({
    rolePermission: { findFirst: async () => ({ permissionId: "patient.record.create" }) },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(
    () => controller.registerPatient({ firstName: "Asha", lastName: "Shah", dateOfBirth: "2999-01-01" } as PatientRegistrationDto, receptionistRequest()),
    BadRequestException,
  );
  assert.equal(transactions, 0);
});

test("patient MRN collision retries with a new opaque identifier", async () => {
  const mrns: string[] = [];
  let attempt = 0;
  const saved = { id: "patient-a", mrn: "JRX-SAVED", firstName: "Asha", lastName: "Shah", createdAt: new Date() };
  const controller = new PatientsController({
    rolePermission: { findFirst: async () => ({ permissionId: "patient.record.create" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      patient: { create: async ({ data }: { data: Record<string, unknown> }) => {
        mrns.push(String(data.mrn));
        attempt += 1;
        if (attempt === 1) throw { code: "P2002" };
        return saved;
      } },
      auditEvent: { createMany: async () => undefined },
    }),
  } as unknown as PrismaService);

  await controller.registerPatient({ firstName: "Asha", lastName: "Shah" } as PatientRegistrationDto, receptionistRequest());
  assert.equal(attempt, 2);
  assert.notEqual(mrns[0], mrns[1]);
});
