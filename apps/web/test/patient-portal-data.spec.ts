import assert from "node:assert/strict";
import test from "node:test";
import { loadPatientPortalData } from "../lib/patient-portal-data.js";

const apiBase = new URL("https://api.example.test/api/v1");
const token = "a".repeat(64);

function membership(role: string) {
  return {
    id: "membership-a",
    role,
    organization: { id: "organization-a", name: "JR Xpert Group", slug: "jr-xpert" },
    hospital: { id: "hospital-a", name: "North Hospital" },
    branch: { id: "branch-a", name: "Main Branch" },
  };
}

function identity(role = "PATIENT", selectedMembershipId: string | null = "membership-a") {
  return {
    user: { id: "user-a", email: "person@example.test", displayName: "Asha Shah" },
    selectedMembershipId,
    memberships: [membership(role)],
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("patient portal reads identity and records using only the selected patient membership", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/me")) return response(identity());
    return response({
      total: 1,
      patients: [{ relationship: "SELF", patient: {
        id: "patient-a", mrn: "JRX-TEST-1", firstName: "Asha", lastName: "Shah", dateOfBirth: "1990-01-01T00:00:00.000Z",
      } }],
    });
  };

  const result = await loadPatientPortalData(token, { apiBase, cookieName: "__Host-jrxpert_session", fetcher });

  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.data, {
    user: { displayName: "Asha Shah", email: "person@example.test" },
    organizationName: "JR Xpert Group",
    hospitalName: "North Hospital",
    branchName: "Main Branch",
    patients: [{ id: "patient-a", mrn: "JRX-TEST-1", firstName: "Asha", lastName: "Shah", dateOfBirth: "1990-01-01T00:00:00.000Z", relationship: "SELF" }],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.example.test/api/v1/auth/me");
  assert.equal(calls[1].url, "https://api.example.test/api/v1/patients/me");
  const headers = new Headers(calls[1].init?.headers);
  assert.equal(headers.get("cookie"), `__Host-jrxpert_session=${token}`);
  assert.equal(headers.get("x-organization-id"), "organization-a");
  assert.equal(headers.get("x-hospital-id"), "hospital-a");
  assert.equal(headers.get("x-branch-id"), "branch-a");
  assert.equal(calls[1].init?.cache, "no-store");
});

test("patient portal requires workspace selection before querying patient records", async () => {
  let requests = 0;
  const result = await loadPatientPortalData(token, {
    apiBase,
    fetcher: async () => {
      requests += 1;
      return response(identity("PATIENT", null));
    },
  });
  assert.deepEqual(result, { state: "select-workspace" });
  assert.equal(requests, 1);
});

test("staff and platform memberships cannot use the patient portal endpoint", async () => {
  let requests = 0;
  const result = await loadPatientPortalData(token, {
    apiBase,
    fetcher: async () => {
      requests += 1;
      return response(identity("DOCTOR"));
    },
  });
  assert.deepEqual(result, { state: "denied" });
  assert.equal(requests, 1);
});

test("expired sessions return the user to login without querying patient data", async () => {
  let requests = 0;
  const result = await loadPatientPortalData(token, {
    apiBase,
    fetcher: async () => {
      requests += 1;
      return response({ statusCode: 401 }, 401);
    },
  });
  assert.deepEqual(result, { state: "login" });
  assert.equal(requests, 1);
});

test("invalid tokens and malformed patient data fail safely", async () => {
  let requests = 0;
  const invalidToken = await loadPatientPortalData("not-a-session-token", {
    apiBase,
    fetcher: async () => { requests += 1; return response(identity()); },
  });
  assert.deepEqual(invalidToken, { state: "login" });
  assert.equal(requests, 0);

  let stage = 0;
  const invalidResponse = await loadPatientPortalData(token, {
    apiBase,
    fetcher: async () => {
      stage += 1;
      return stage === 1 ? response(identity()) : response({ patients: [{ patient: { firstName: "private" } }] });
    },
  });
  assert.deepEqual(invalidResponse, { state: "unavailable" });
});
