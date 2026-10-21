-- Login failure handling and other security events must be able to append
-- audit records. Keep the runtime role append-only and do not broaden access.
GRANT INSERT ON TABLE "AuditEvent" TO jr_xpert_app;
