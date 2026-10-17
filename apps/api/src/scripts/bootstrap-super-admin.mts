import "reflect-metadata";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { PrismaService } from "../database/prisma.service.mjs";
import { EmailDeliveryService } from "../auth/email-delivery.service.mjs";
import { createSessionToken, hashPassword, hashSessionToken } from "../security/security.crypto.mjs";

dotenv.config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

async function main() {
  if (process.env.BOOTSTRAP_CONFIRM !== "CREATE_FIRST_SUPER_ADMIN") {
    throw new Error("Set BOOTSTRAP_CONFIRM=CREATE_FIRST_SUPER_ADMIN to confirm the first platform administrator bootstrap.");
  }
  const databaseUrl = required("BOOTSTRAP_DATABASE_URL");
  const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const displayName = required("BOOTSTRAP_ADMIN_NAME");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("BOOTSTRAP_ADMIN_EMAIL is invalid.");
  if (displayName.length < 2 || displayName.length > 120) throw new Error("BOOTSTRAP_ADMIN_NAME must be between 2 and 120 characters.");
  const emailDelivery = new EmailDeliveryService();
  if (!emailDelivery.isConfigured()) throw new Error("Configure APP_URL, RESEND_API_KEY, and AUTH_EMAIL_FROM before bootstrapping so setup can be delivered securely by email.");

  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaService();
  const rawToken = createSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  try {
    const activePlatformAdmin = await prisma.membership.findFirst({
      where: { role: { in: ["SUPER_ADMIN", "PLATFORM_ADMIN"] }, status: "ACTIVE", hospitalId: null, branchId: null },
      select: { id: true },
    });
    if (activePlatformAdmin) throw new Error("An active platform administrator already exists; first-admin bootstrap is disabled.");

    const existingUser = await prisma.user.findUnique({ where: { email }, include: { memberships: { select: { role: true, hospitalId: true } } } });
    if (existingUser && (existingUser.status !== "INVITED" || existingUser.memberships.some((membership) => membership.role !== "SUPER_ADMIN" || membership.hospitalId !== null))) {
      throw new Error("The requested email belongs to an existing non-bootstrap account. Choose a new platform administrator email.");
    }

    const dummyPasswordHash = await hashPassword(createSessionToken());
    const bootstrap = await prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.upsert({
        where: { slug: "jr-xpert-platform" },
        create: { name: "JR Xpert Platform", slug: "jr-xpert-platform", status: "ACTIVE" },
        update: { status: "ACTIVE" },
        select: { id: true },
      });
      const user = existingUser
        ? await transaction.user.update({
            where: { id: existingUser.id },
            data: { displayName, passwordHash: dummyPasswordHash, status: "INVITED", emailVerifiedAt: null, mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedCounter: null },
            select: { id: true },
          })
        : await transaction.user.create({
            data: { email, displayName, passwordHash: dummyPasswordHash, status: "INVITED" },
            select: { id: true },
          });
      await transaction.platformBootstrapToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      const membership = await transaction.membership.findFirst({ where: { userId: user.id, organizationId: organization.id, role: "SUPER_ADMIN", hospitalId: null, branchId: null } });
      if (membership) await transaction.membership.update({ where: { id: membership.id }, data: { status: "INVITED", expiresAt: null } });
      else await transaction.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "SUPER_ADMIN", status: "INVITED" } });
      const setup = await transaction.platformBootstrapToken.create({ data: { userId: user.id, tokenHash: hashSessionToken(rawToken), expiresAt } });
      await transaction.auditEvent.create({ data: { organizationId: organization.id, action: "platform.bootstrap_invitation_created", resourceType: "user", resourceId: user.id, metadata: { tokenExpiresAt: expiresAt.toISOString() } } });
      return { userId: user.id, organizationId: organization.id, tokenId: setup.id };
    });

    try {
      await emailDelivery.sendPlatformBootstrap(email, rawToken);
      await prisma.auditEvent.create({ data: { organizationId: bootstrap.organizationId, action: "platform.bootstrap_invitation_sent", resourceType: "user", resourceId: bootstrap.userId } });
      process.stdout.write("Bootstrap invitation sent. The recipient must finish password and authenticator setup using the one-time email link within 30 minutes.\n");
    } catch {
      const failedAt = new Date();
      await prisma.$transaction(async (transaction) => {
        await transaction.platformBootstrapToken.updateMany({ where: { id: bootstrap.tokenId, usedAt: null }, data: { usedAt: failedAt } });
        await transaction.user.update({ where: { id: bootstrap.userId }, data: { status: "INVITED" } });
        await transaction.membership.updateMany({ where: { userId: bootstrap.userId, organizationId: bootstrap.organizationId, role: "SUPER_ADMIN", status: "INVITED" }, data: { status: "DISABLED" } });
        await transaction.auditEvent.create({ data: { organizationId: bootstrap.organizationId, action: "platform.bootstrap_invitation_failed", resourceType: "user", resourceId: bootstrap.userId } });
      });
      throw new Error("The bootstrap invitation email could not be delivered. No setup link was printed or returned; inspect the email provider and run the bootstrap again with the same email.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Bootstrap failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
