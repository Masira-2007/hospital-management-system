CREATE ROLE jr_xpert_app
  LOGIN PASSWORD 'jr_xpert_app_test'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- A historical grants migration names Neon’s default database. This local-only
-- inert database keeps that immutable migration unchanged during isolated tests.
CREATE DATABASE neondb;
GRANT CONNECT ON DATABASE neondb TO jr_xpert_app;
GRANT CONNECT ON DATABASE jr_xpert_hms_test TO jr_xpert_app;
