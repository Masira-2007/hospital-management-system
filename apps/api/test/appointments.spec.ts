import assert from "node:assert/strict";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { test } from "node:test";
import type { RequestLike } from "../src/auth/auth.types.mjs";
import { PrismaService } from "../src/database/prisma.service.mjs";
import { AppointmentsController } from "../src/appointments/appointments.controller.mjs";
import type { AppointmentListDto, CreateAppointmentDto, RescheduleAppointmentDto } from "../src/appointments/appointment.dto.mjs";

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
      auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { audit = data; } },
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
      auditEvent: { createMany: async () => undefined },
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
      auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { auditData = data; } },
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
      auditEvent: { createMany: async () => undefined },
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

test("appointment cancellation is tenant-scoped, permission-gated, and writes only a categorical audit reason", async () => {
  let scopeQuery: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  let rlsApplied = false;
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const prisma = {
    rolePermission: { findFirst: async ({ where }: { where: Record<string, unknown> }) => ({ permissionId: where.permissionId }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => { rlsApplied = true; return []; },
      appointment: {
        findFirst: async (input: Record<string, unknown>) => { scopeQuery = input; return { id: "appointment-a", startsAt, status: "CONFIRMED" }; },
        updateMany: async (input: Record<string, unknown>) => { update = input; return { count: 1 }; },
      },
      auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { audit = data; } },
    }),
  } as unknown as PrismaService;
  const controller = new AppointmentsController(prisma);

  const result = await controller.cancel("appointment-a", { reasonCode: "PATIENT_REQUESTED" }, staffRequest());

  assert.deepEqual(scopeQuery?.where, { id: "appointment-a", organizationId: "org-a", hospitalId: "hospital-a", branchId: "branch-a" });
  assert.equal(rlsApplied, true);
  assert.equal((update?.where as { status: string }).status, "CONFIRMED");
  assert.deepEqual(update?.data, { status: "CANCELLED" });
  assert.equal(audit?.action, "appointment.cancelled");
  assert.deepEqual(audit?.metadata, { hospitalId: "hospital-a", branchId: "branch-a", reasonCode: "PATIENT_REQUESTED" });
  assert.equal(JSON.stringify(audit).includes("forged"), false);
  assert.deepEqual(result, { appointment: { id: "appointment-a", status: "CANCELLED" }, changed: true });
});

test("appointment cancellation requires the dedicated role permission", async () => {
  let transactions = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => null },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(() => controller.cancel("appointment-a", { reasonCode: "OTHER" }, staffRequest("PHARMACIST")), ForbiddenException);
  assert.equal(transactions, 0);
});

test("appointment cancellation does not reveal guessed IDs outside the verified hospital scope", async () => {
  let updateAttempts = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.cancel" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      appointment: { findFirst: async () => null, updateMany: async () => { updateAttempts += 1; return { count: 1 }; } },
      auditEvent: { createMany: async () => undefined },
    }),
  } as unknown as PrismaService);
  await assert.rejects(
    () => controller.cancel("guessed-hospital-b-appointment", { reasonCode: "OTHER" }, staffRequest()),
    (error: unknown) => error instanceof NotFoundException && error.getStatus() === 404,
  );
  assert.equal(updateAttempts, 0);
});

test("appointment cancellation rejects started or non-cancellable appointments and handles replay safely", async () => {
  let updateAttempts = 0;
  let auditAttempts = 0;
  let current: { id: string; startsAt: Date; status: string } = { id: "appointment-a", startsAt: new Date(Date.now() + 60 * 60 * 1000), status: "CHECKED_IN" };
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.cancel" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      appointment: {
        findFirst: async () => current,
        updateMany: async () => { updateAttempts += 1; return { count: 1 }; },
      },
      auditEvent: { createMany: async () => { auditAttempts += 1; } },
    }),
  } as unknown as PrismaService);
  await assert.rejects(() => controller.cancel("appointment-a", { reasonCode: "OTHER" }, staffRequest()), ConflictException);
  current = { ...current, startsAt: new Date(Date.now() - 1_000), status: "REQUESTED" };
  await assert.rejects(() => controller.cancel("appointment-a", { reasonCode: "OTHER" }, staffRequest()), ConflictException);
  assert.equal(updateAttempts, 0);

  current = { ...current, status: "CANCELLED" };
  const replay = await controller.cancel("appointment-a", { reasonCode: "OTHER" }, staffRequest());
  assert.deepEqual(replay, { appointment: { id: "appointment-a", status: "CANCELLED" }, changed: false });
  assert.equal(auditAttempts, 0);
});

test("appointment cancellation reports a conflict if the status changes concurrently", async () => {
  let auditAttempts = 0;
  const controller = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.cancel" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      appointment: {
        findFirst: async () => ({ id: "appointment-a", startsAt: new Date(Date.now() + 60 * 60 * 1000), status: "REQUESTED" }),
        updateMany: async () => ({ count: 0 }),
      },
      auditEvent: { createMany: async () => { auditAttempts += 1; } },
    }),
  } as unknown as PrismaService);
  await assert.rejects(
    () => controller.cancel("appointment-a", { reasonCode: "OTHER" }, staffRequest()),
    (error: unknown) => error instanceof ConflictException && error.message.includes("changed"),
  );
  assert.equal(auditAttempts, 0);
});

test("appointment rescheduling is tenant-scoped, permission-gated, and records only bounded audit metadata", async () => {
  let scopeQuery: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  let rlsApplied = false;
  const oldStart = new Date(Date.now() + 60 * 60 * 1000);
  const newStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const prisma = {
    rolePermission: { findFirst: async ({ where }: { where: Record<string, unknown> }) => ({ permissionId: where.permissionId }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => { rlsApplied = true; return []; },
      appointment: {
        findFirst: async (input: Record<string, unknown>) => { scopeQuery = input; return { id: "appointment-a", startsAt: oldStart, durationMinutes: 20, status: "CONFIRMED" }; },
        updateMany: async (input: Record<string, unknown>) => { update = input; return { count: 1 }; },
      },
      auditEvent: { createMany: async ({ data }: { data: Record<string, unknown> }) => { audit = data; } },
    }),
  } as unknown as PrismaService;
  const controller = new AppointmentsController(prisma);
  const body = {
    startsAt: newStart.toISOString(), durationMinutes: 45, reasonCode: "PATIENT_REQUESTED",
    organizationId: "forged-org", hospitalId: "forged-hospital", patientId: "forged-patient",
  } as RescheduleAppointmentDto;

  const result = await controller.reschedule("appointment-a", body, staffRequest());

  assert.deepEqual(scopeQuery?.where, { id: "appointment-a", organizationId: "org-a", hospitalId: "hospital-a", branchId: "branch-a" });
  assert.equal(rlsApplied, true);
  assert.deepEqual(update?.where, {
    id: "appointment-a", organizationId: "org-a", hospitalId: "hospital-a", branchId: "branch-a",
    status: "CONFIRMED", startsAt: oldStart, durationMinutes: 20,
  });
  assert.deepEqual(update?.data, { startsAt: newStart, durationMinutes: 45, updatedAt: (update?.data as { updatedAt: Date }).updatedAt });
  assert.equal(audit?.action, "appointment.rescheduled");
  assert.deepEqual(audit?.metadata, {
    hospitalId: "hospital-a", branchId: "branch-a", reasonCode: "PATIENT_REQUESTED",
    startsAt: newStart.toISOString(), durationMinutes: 45,
  });
  assert.equal(JSON.stringify(audit).includes("forged"), false);
  assert.deepEqual(result, { appointment: { id: "appointment-a", status: "CONFIRMED", startsAt: newStart, durationMinutes: 45 }, changed: true });
});

test("appointment rescheduling requires its dedicated permission and validates time before opening a transaction", async () => {
  let transactions = 0;
  const denied = new AppointmentsController({
    rolePermission: { findFirst: async () => null },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(
    () => denied.reschedule("appointment-a", { startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reasonCode: "OTHER" }, staffRequest("PHARMACIST")),
    ForbiddenException,
  );
  assert.equal(transactions, 0);

  const allowed = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.reschedule" }) },
    $transaction: async () => { transactions += 1; },
  } as unknown as PrismaService);
  await assert.rejects(
    () => allowed.reschedule("appointment-a", { startsAt: "2030-01-01T12:00:00", reasonCode: "OTHER" }, staffRequest()),
    BadRequestException,
  );
  assert.equal(transactions, 0);
});

test("appointment rescheduling hides guessed cross-tenant IDs and returns safe schedule conflicts", async () => {
  let updateAttempts = 0;
  const scoped = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.reschedule" }) },
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async () => [],
      appointment: { findFirst: async () => null, updateMany: async () => { updateAttempts += 1; return { count: 1 }; } },
      auditEvent: { createMany: async () => undefined },
    }),
  } as unknown as PrismaService);
  await assert.rejects(
    () => scoped.reschedule("guessed-hospital-b-appointment", { startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reasonCode: "OTHER" }, staffRequest()),
    NotFoundException,
  );
  assert.equal(updateAttempts, 0);

  const conflict = new AppointmentsController({
    rolePermission: { findFirst: async () => ({ permissionId: "appointment.reschedule" }) },
    $transaction: async () => { throw { code: "P2004" }; },
  } as unknown as PrismaService);
  await assert.rejects(
    () => conflict.reschedule("appointment-a", { startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reasonCode: "OTHER" }, staffRequest()),
    (error: unknown) => error instanceof ConflictException && !error.message.includes("P2004"),
  );
});
