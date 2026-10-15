import "reflect-metadata";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()) ?? ["http://localhost:3000"],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const openApi = new DocumentBuilder()
    .setTitle("JR Xpert HMS API")
    .setDescription("Versioned API foundation. Clinical and financial endpoints are not enabled in this increment.")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));
  await app.listen(process.env.API_PORT ? Number(process.env.API_PORT) : 4000);
}

void bootstrap();
