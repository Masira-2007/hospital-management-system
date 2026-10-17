import assert from "node:assert/strict";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import type { RequestLike } from "../src/auth/auth.types.mjs";
import { PrismaService } from "../src/database/prisma.service.mjs";
import { AppointmentsController } from "../src/appointments/appointments.controller.mjs";
import type { AppointmentListDto, CreateAppointmentDto } from "../src/appointments/appointment.dto.mjs";

function staffRequest(role: "RECEPTIONIST" | "PHARMACIST" = "RECEPTIONIST"): RequestLike {
  return {
    headers: { "x-organization-id": "forged-org", "x-hospital-id": "forged-hospital" },
    authSession: { id: "session-a", user: { id: "user-a", email: "staff@example.test", displayName: "Staff" } },
    tenant: {
      organizationId: "org-a", organizationName: "Hospital group A",
      hospitalId: "hospital-a", hospitalName: "Hospital A",
      branchId: "branch-a", branchName: "Branch A",
      memberships: [{ id: "membership-a", role, department: null }],
    },
  };
}

test("appointment listing enforces permission and tenant/branch filters inside an RLS-scoped transaction", async () => {
  let query: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  let rlsApplied = false;
  const prisma = {
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.read" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => { rlsApplied = true; return []; },
      appointment: {
        findMany: async (input: Record<string, unknown>) => { query = input; return [{ id: "appointment-a" }]; },
        count: async () => 1,
      },
      auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { audit = data; } },
    }),
  } as unknown as PrismaService;
  const controller = new AppointmentsController(prisma);
  const result = await controller.list({ from: "2026-10-17T00:00:00.000Z", to: "2026-10-18T00:00:00.000Z", page: 2, limit: 10 } as AppointmentListDto, staffRequest());

  assert.deepEqual(query?.where, {
    organizationId: "org-a", hospitalId: "hospital-a", branchId: "branch-a",
    startsAt: { gte: new Date("2026-10-17T00:00:00.000Z"), lt: new Date("2026-10-18T00:00:00.000Z") },
  });
  assert.equal(query?.skip, 10);
  assert.equal(JSON.stringify(query?.select).includes("reason"), false);
  assert.equal(rlsApplied, true);
  assert.equal(audit?.action, "appointment.listed");
  assert.equal(JSON.stringify(audit).includes("forged"), false);
  assert.deepEqual(result, { items: [{ id: "appointment-a" }], page: 2, limit: 10, total: 1, totalPages: 1 });
});

test("appointment listing rejects reversed or oversized date ranges before querying", async () => {
  const controller = new AppointmentsController({ rolePermission: { findFirst: async () => ({ permissionId: "appointment.read" }) } } as unknown as PrismaService);
  await assert.rejects(
    () => controller.list({ from: "2026-10-18T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z", page: 1, limit: 25 } as AppointmentListDto, staffRequest()),
    (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test("appointment listing defaults to a 31-day window instead of scanning all tenant history", async () => {
  let query: Record<string, unknown> | undefined;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.read" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      appointment: { findMany: async (input: Record<string, unknown>) => { query = input; return []; }, count: async () => 0 },
      auditEvent: { create: async () => undefined },
    }),
  } as unknown as PrismaService);
  const before = Date.now();
  await controller.list({ page: 1, limit: 25 } as AppointmentListDto, staffRequest());
  const after = Date.now();
  const range = query?.where as { startsAt: { gte: Date; lt: Date } };
  assert.ok(range.startsAt.gte.getTime() >= before && range.startsAt.gte.getTime() <= after);
  assert.equal(range.startsAt.lt.getTime() - range.startsAt.gte.getTime(), 31 * 24 * 60 * 60 * 1000);
});

test("appointment listing requires explicit appointment read permission", async () => {
  let transactions = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => null },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(() => controller.list({ page: 1, limit: 25 } as AppointmentListDto, staffRequest()), ForbiddenException);
  assert.equal(transactions, 0);
});

test("appointment creation derives tenant from verified membership and audits a bounded request", async () => {
  let patientQuery: Record<string, unknown> | undefined;
  let doctorQuery: Record<string, unknown> | undefined;
  let appointmentData: Record<string, unknown> | undefined;
  let auditData: Record<string, unknown> | undefined;
  const created = { id: "appointment-a", status: "REQUESTED" };
  const prisma = {
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.schedule" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      patient: { findFirst: async (input: Record<string, unknown>) => { patientQuery = input; return { id: "patient-a" }; } },
      membership: { findFirst: async (input: Record<string, unknown>) => { doctorQuery = input; return { id: "doctor-a" }; } },
      appointment: { create: async ({ data }: { data: Record<string, unknown> }) => { appointmentData = data; return created; } },
      auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { auditData = data; } },
    }),
  } as unknown as PrismaService;
  const controller = new AppointmentsController(prisma);
  const body = {
    patientId: "patient-a", doctorMembershipId: "doctor-a",
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), durationMinutes: 30,
    organizationId: "attacker-org", hospitalId: "attacker-hospital",
  } as CreateAppointmentDto;
  const result = await controller.create(body, staffRequest());

  assert.deepEqual(patientQuery?.where, { id: "patient-a", organizationId: "org-a", hospitalId: "hospital-a", branchId: "branch-a" });
  assert.equal((doctorQuery?.where as { organizationId: string }).organizationId, "org-a");
  assert.equal((doctorQuery?.where as { hospitalId: string }).hospitalId, "hospital-a");
  assert.deepEqual((doctorQuery?.where as { AND: unknown[] }).AND[1], { OR: [{ branchId: null }, { branchId: "branch-a" }] });
  assert.equal(JSON.stringify(doctorQuery?.where).includes("attacker"), false);
  assert.equal(appointmentData?.organizationId, "org-a");
  assert.equal(appointmentData?.hospitalId, "hospital-a");
  assert.equal(appointmentData?.branchId, "branch-a");
  assert.equal("status" in (appointmentData ?? {}), false, "database default keeps runtime-created appointments in REQUESTED state");
  assert.equal("reason" in (appointmentData ?? {}), false);
  assert.equal(auditData?.action, "appointment.requested");
  assert.deepEqual(result, { appointment: created });
});

test("appointment creation rejects patients outside the verified hospital scope", async () => {
  let appointmentsCreated = 0;
  const prisma = {
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.schedule" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      patient: { findFirst: async () => null },
      membership: { findFirst: async () => ({ id: "doctor-a" }) },
      appointment: { create: async () => { appointmentsCreated += 1; } },
      auditEvent: { create: async () => undefined },
    }),
  } as unknown as PrismaService;
  const controller = new AppointmentsController(prisma);
  const body = { patientId: "patient-from-hospital-b", doctorMembershipId: "doctor-a", startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), durationMinutes: 20 } as CreateAppointmentDto;

  await assert.rejects(() => controller.create(body, staffRequest()), BadRequestException);
  assert.equal(appointmentsCreated, 0);
});

test("appointment scheduling requires its own role permission", async () => {
  let transactions = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => null },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  const body = { patientId: "patient-a", doctorMembershipId: "doctor-a", startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), durationMinutes: 20 } as CreateAppointmentDto;

  await assert.rejects(() => controller.create(body, staffRequest("PHARMACIST")), ForbiddenException);
  assert.equal(transactions, 0);
});

test("appointment creation rejects malformed or unzoned times before opening a database transaction", async () => {
  let transactions = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.schedule" }) },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  const body = { patientId: "patient-a", doctorMembershipId: "doctor-a", startsAt: "2030-01-01T12:00:00", durationMinutes: 20 } as CreateAppointmentDto;

  await assert.rejects(() => controller.create(body, staffRequest()), BadRequestException);
  assert.equal(transactions, 0);
});

test("database overlap and serializable conflicts return a safe scheduling conflict", async () => {
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.schedule" }) },
    $transaction: async () => { throw { code: "P2004" }; },
  } as unknown as PrismaService);
  const body = { patientId: "patient-a", doctorMembershipId: "doctor-a", startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), durationMinutes: 20 } as CreateAppointmentDto;

  await assert.rejects(() => controller.create(body, staffRequest()), (error: unknown) => error instanceof ConflictException && !error.message.includes("P2004"));
});
