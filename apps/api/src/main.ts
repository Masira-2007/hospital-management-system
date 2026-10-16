import "reflect-metadata";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { SameSiteCsrfGuard } from "./auth/same-site-csrf.guard.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

function getAllowedOrigins(): string[] {
  const configured = process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (process.env.NODE_ENV === "production" && (!configured?.length || !process.env.DATABASE_URL)) {
    throw new Error("Production startup requires DATABASE_URL and an explicit WEB_ORIGIN allowlist.");
  }
  if (process.env.NODE_ENV === "production" && (!process.env.AUTH_RATE_LIMIT_SECRET || process.env.AUTH_RATE_LIMIT_SECRET.length < 32)) {
    throw new Error("Production startup requires AUTH_RATE_LIMIT_SECRET with at least 32 characters.");
  }
  if (process.env.NODE_ENV === "production" && !/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY ?? "")) {
    throw new Error("Production startup requires a 32-byte hexadecimal MFA_ENCRYPTION_KEY.");
  }
  const origins = configured?.length ? configured : ["http://localhost:3000"];
  for (const value of origins) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`WEB_ORIGIN contains an invalid origin: ${value}`);
    }
    if (parsed.origin !== value || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
      throw new Error("WEB_ORIGIN entries must be exact origins; production origins must use HTTPS.");
    }
  }
  if (process.env.NODE_ENV === "production") {
    const appUrl = process.env.APP_URL;
    let parsedAppUrl: URL;
    try {
      parsedAppUrl = new URL(appUrl ?? "");
    } catch {
      throw new Error("Production startup requires APP_URL set to the exact public web-app origin.");
    }
    if (parsedAppUrl.origin !== appUrl || parsedAppUrl.protocol !== "https:" || !origins.includes(parsedAppUrl.origin)) {
      throw new Error("Production APP_URL must be an HTTPS origin included in WEB_ORIGIN.");
    }
  }
  return origins;
}

async function bootstrap() {
  const allowedOrigins = getAllowedOrigins();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production"
      ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
      : false,
    crossOriginResourcePolicy: { policy: "same-site" },
    ...(process.env.NODE_ENV === "production" ? { hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true } } : {}),
  }));
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    maxAge: 600,
  });
  app.useGlobalGuards(new SameSiteCsrfGuard(allowedOrigins));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    disableErrorMessages: process.env.NODE_ENV === "production",
  }));
  const openApi = new DocumentBuilder()
    .setTitle("JR Xpert HMS API")
    .setDescription("Authentication, session, hospital-membership and scoped patient-directory APIs. Other clinical and financial workflows remain disabled.")
    .setVersion("0.1.0")
    .addCookieAuth("jrxpert_session", { type: "apiKey", in: "cookie" }, "jr-xpert-session")
    .build();
  if (process.env.NODE_ENV !== "production") {
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));
  }
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : process.env.API_PORT ? Number(process.env.API_PORT) : 4000);
}

void bootstrap();
