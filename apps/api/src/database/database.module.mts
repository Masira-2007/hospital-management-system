import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.mjs";

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class DatabaseModule {}
