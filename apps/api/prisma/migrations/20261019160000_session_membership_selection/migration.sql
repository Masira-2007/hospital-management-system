-- Persist the administrator/staff user's explicitly selected authorized role scope per session.
ALTER TABLE "Session" ADD COLUMN "activeMembershipId" TEXT;
CREATE INDEX "Session_activeMembershipId_idx" ON "Session"("activeMembershipId");
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_activeMembershipId_fkey"
  FOREIGN KEY ("activeMembershipId") REFERENCES "Membership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Runtime may select only a membership verified by the application for this session.
GRANT UPDATE ("activeMembershipId") ON TABLE "Session" TO jr_xpert_app;
