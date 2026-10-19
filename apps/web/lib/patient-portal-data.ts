import { configuredApiBase } from "@/lib/api-base";

type JsonRecord = Record<string, unknown>;
type PatientMembership = {
  id: string;
  role: string;
  organization: { id: string; name: string };
  hospital: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
};

export type PatientPortalPatient = {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  relationship: string;
};

export type PatientPortalData = {
  user: { displayName: string; email: string };
  organizationName: string;
  hospitalName: string;
  branchName: string | null;
  patients: PatientPortalPatient[];
};

export type PatientPortalResult =
  | { state: "login" }
  | { state: "select-workspace" }
  | { state: "denied" }
  | { state: "unavailable" }
  | { state: "ready"; data: PatientPortalData };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseIdentity(value: unknown) {
  if (!isRecord(value) || !isRecord(value.user) || !Array.isArray(value.memberships)) return null;
  if (!isString(value.user.displayName) || !isString(value.user.email)) return null;
  if (value.selectedMembershipId !== null && !isString(value.selectedMembershipId)) return null;

  const memberships: PatientMembership[] = [];
  for (const item of value.memberships) {
    if (!isRecord(item) || !isString(item.id) || !isString(item.role) || !isRecord(item.organization)) return null;
    if (!isString(item.organization.id) || !isString(item.organization.name)) return null;
    if (item.hospital !== null && (!isRecord(item.hospital) || !isString(item.hospital.id) || !isString(item.hospital.name))) return null;
    if (item.branch !== null && (!isRecord(item.branch) || !isString(item.branch.id) || !isString(item.branch.name))) return null;
    memberships.push({
      id: item.id,
      role: item.role,
      organization: { id: item.organization.id, name: item.organization.name },
      hospital: item.hospital === null ? null : { id: (item.hospital as JsonRecord).id as string, name: (item.hospital as JsonRecord).name as string },
      branch: item.branch === null ? null : { id: (item.branch as JsonRecord).id as string, name: (item.branch as JsonRecord).name as string },
    });
  }

  return {
    user: { displayName: value.user.displayName, email: value.user.email },
    selectedMembershipId: value.selectedMembershipId as string | null,
    memberships,
  };
}

function parsePatientAccessResponse(value: unknown): PatientPortalPatient[] | null {
  if (!isRecord(value) || !Array.isArray(value.patients) || !Number.isInteger(value.total) || value.total !== value.patients.length) return null;
  const patients: PatientPortalPatient[] = [];
  for (const row of value.patients) {
    if (!isRecord(row) || !isString(row.relationship) || !isRecord(row.patient)) return null;
    const patient = row.patient;
    if (!isString(patient.id) || !isString(patient.mrn) || !isString(patient.firstName) || !isString(patient.lastName)) return null;
    if (patient.dateOfBirth !== null && !isString(patient.dateOfBirth)) return null;
    if (isString(patient.dateOfBirth) && !Number.isFinite(Date.parse(patient.dateOfBirth))) return null;
    patients.push({
      id: patient.id,
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: isString(patient.dateOfBirth) ? patient.dateOfBirth : null,
      relationship: row.relationship,
    });
  }
  return patients;
}

export async function loadPatientPortalData(
  token: string | undefined,
  options: { apiBase?: URL | null; cookieName?: string; fetcher?: typeof fetch } = {},
): Promise<PatientPortalResult> {
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return { state: "login" };
  const apiBase = options.apiBase ?? configuredApiBase();
  if (!apiBase) return { state: "unavailable" };
  const cookieName = options.cookieName ?? (process.env.NODE_ENV === "production" ? "__Host-jrxpert_session" : "jrxpert_session");
  const fetcher = options.fetcher ?? fetch;
  const cookie = `${cookieName}=${token}`;

  try {
    const identityUrl = new URL("auth/me", `${apiBase.toString().replace(/\/$/, "")}/`);
    const identityResponse = await fetcher(identityUrl, {
      headers: { Accept: "application/json", Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (identityResponse.status === 401) return { state: "login" };
    if (!identityResponse.ok) return { state: "unavailable" };
    const identity = parseIdentity(await identityResponse.json().catch(() => null));
    if (!identity) return { state: "unavailable" };
    if (!identity.selectedMembershipId) return identity.memberships.length ? { state: "select-workspace" } : { state: "denied" };

    const membership = identity.memberships.find(({ id }) => id === identity.selectedMembershipId);
    if (!membership) return { state: "select-workspace" };
    if (membership.role !== "PATIENT" || !isRecord(membership.hospital) || !isString(membership.hospital.id)) return { state: "denied" };

    const tenantHeaders: Record<string, string> = {
      Accept: "application/json",
      Cookie: cookie,
      "x-organization-id": membership.organization.id as string,
      "x-hospital-id": membership.hospital.id,
    };
    if (isRecord(membership.branch) && isString(membership.branch.id)) tenantHeaders["x-branch-id"] = membership.branch.id;

    const patientUrl = new URL("patients/me", `${apiBase.toString().replace(/\/$/, "")}/`);
    const patientResponse = await fetcher(patientUrl, {
      headers: tenantHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (patientResponse.status === 401) return { state: "login" };
    if (patientResponse.status === 403) return { state: "select-workspace" };
    if (!patientResponse.ok) return { state: "unavailable" };
    const patients = parsePatientAccessResponse(await patientResponse.json().catch(() => null));
    if (!patients) return { state: "unavailable" };

    return {
      state: "ready",
      data: {
        user: identity.user,
        organizationName: membership.organization.name as string,
        hospitalName: membership.hospital.name as string,
        branchName: isRecord(membership.branch) && isString(membership.branch.name) ? membership.branch.name : null,
        patients,
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}
