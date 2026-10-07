import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { createWriteStream, createReadStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { normalizePublicGitHubRepoUrl } from "@munshe/shared";
import { prisma } from "./db.js";
import { registerAuthRoutes } from "./auth.js";

const env = z
  .object({
    API_PORT: z.coerce.number().int().min(1024).max(65535).default(4000),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    STORAGE_DIR: z.string().default("./.data"),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(300),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  })
  .parse({
    API_PORT: process.env.API_PORT || undefined,
    JWT_SECRET: process.env.JWT_SECRET,
    REDIS_URL: process.env.REDIS_URL || undefined,
    STORAGE_DIR: process.env.STORAGE_DIR || undefined,
    MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB || undefined,
    WEB_ORIGIN: process.env.WEB_ORIGIN || undefined,
  });

const root = path.resolve(env.STORAGE_DIR);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("android-builds", { connection: redis });
const app = Fastify({
  logger: true,
  bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024,
  requestTimeout: 30_000,
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: env.WEB_ORIGIN, credentials: false });
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(multipart, {
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 2 },
});
await mkdir(path.join(root, "uploads"), { recursive: true, mode: 0o700 });
await mkdir(path.join(root, "artifacts"), { recursive: true, mode: 0o710 });
await chmod(path.join(root, "uploads"), 0o700);
await chmod(path.join(root, "artifacts"), 0o710);

app.decorate("authenticate", async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "سجّل دخولك الأول عشان تكمل." });
  }
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

app.get("/health", async () => ({ status: "ok" }));
await registerAuthRoutes(app);

app.post(
  "/api/builds",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const part = await request.file();
    if (
      !part ||
      part.fieldname !== "project" ||
      !part.filename.toLowerCase().endsWith(".zip")
    ) {
      return reply.code(400).send({ error: "ارفع مشروع Expo بصيغة ZIP." });
    }
    const nameField = part.fields.projectName as
      { value?: unknown } | undefined;
    const projectName = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .safeParse(nameField?.value ?? path.basename(part.filename, ".zip"));
    if (!projectName.success)
      return reply
        .code(400)
        .send({ error: "اسم المشروع لازم يكون من 1 لـ80 حرف." });

    const id = randomUUID();
    const sourcePath = path.join(root, "uploads", `${id}.zip`);
    try {
      await pipeline(
        part.file,
        createWriteStream(sourcePath, { flags: "wx", mode: 0o600 }),
      );
      if (part.file.truncated)
        throw new Error("حجم الملف أكبر من الحد المسموح.");
      const fileStat = await stat(sourcePath);
      if (fileStat.size < 22) throw new Error("ملف ZIP فاضي أو تالف.");
      const build = await prisma.build.create({
        data: {
          id,
          projectName: projectName.data,
          sourcePath,
          userId: request.user.sub,
          status: "queued",
        },
      });
      await prisma.buildLog.create({
        data: { buildId: id, message: "استلمنا المشروع، وهنبدأ فحصه." },
      });
      await queue.add(
        "build",
        { buildId: id },
        { jobId: id, attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
      );
      return reply.code(202).send({
        build: {
          id: build.id,
          projectName: build.projectName,
          status: build.status,
        },
      });
    } catch (error) {
      await import("node:fs/promises").then(({ rm }) =>
        rm(sourcePath, { force: true }),
      );
      await prisma.build.updateMany({
        where: { id },
        data: {
          status: "failed",
          errorMessage: "تعذر إضافة المهمة إلى طابور البناء.",
        },
      });
      return reply.code(400).send({
        error:
          error instanceof Error ? error.message : "ماقدرناش نستقبل الملف.",
      });
    }
  },
);

app.post(
  "/api/builds/from-github",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const input = z
      .object({
        sourceUrl: z.string().trim().min(1).max(2048),
        projectName: z.string().trim().min(1).max(80).optional(),
      })
      .safeParse(request.body);
    if (!input.success)
      return reply.code(400).send({ error: "راجع رابط GitHub واسم المشروع." });

    const sourceUrl = normalizePublicGitHubRepoUrl(input.data.sourceUrl);
    if (!sourceUrl)
      return reply.code(400).send({
        error:
          "حط رابط مستودع GitHub عام بالشكل https://github.com/account/project",
      });

    const repoName = new URL(sourceUrl).pathname
      .split("/")
      .filter(Boolean)[1]
      ?.replace(/\.git$/i, "");
    const projectName = input.data.projectName || repoName?.slice(0, 80);
    if (!projectName)
      return reply.code(400).send({ error: "اكتب اسم المشروع." });

    const id = randomUUID();
    try {
      const build = await prisma.build.create({
        data: {
          id,
          projectName,
          sourcePath: null,
          sourceUrl,
          userId: request.user.sub,
          status: "queued",
        },
      });
      await prisma.buildLog.create({
        data: {
          buildId: id,
          message: "استلمنا رابط GitHub العام، وهنبدأ نسحب المشروع.",
        },
      });
      await queue.add(
        "build",
        { buildId: id },
        { jobId: id, attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
      );
      return reply.code(202).send({
        build: {
          id: build.id,
          projectName: build.projectName,
          status: build.status,
        },
      });
    } catch {
      await prisma.build.updateMany({
        where: { id },
        data: {
          status: "failed",
          errorMessage: "تعذر إضافة المشروع إلى طابور البناء.",
        },
      });
      return reply.code(503).send({
        error: "مش قادرين نضيف المشروع لطابور البناء دلوقتي. جرّب كمان شوية.",
      });
    }
  },
);

app.get(
  "/api/builds",
  { preHandler: app.authenticate },
  async (request: any) => {
    const builds = await prisma.build.findMany({
      where: { userId: request.user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      builds: builds.map((b: (typeof builds)[number]) => ({
        id: b.id,
        projectName: b.projectName,
        status: b.status,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        errorMessage: b.errorMessage,
        artifactAvailable: Boolean(b.artifactPath),
      })),
    };
  },
);

app.get(
  "/api/builds/:id",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const build = await prisma.build.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });
    if (!build)
      return reply.code(404).send({ error: "مش لاقيين الـBuild ده." });
    return {
      build: {
        id: build.id,
        projectName: build.projectName,
        status: build.status,
        createdAt: build.createdAt,
        updatedAt: build.updatedAt,
        errorMessage: build.errorMessage,
        artifactAvailable: Boolean(build.artifactPath),
      },
      logs: build.logs,
    };
  },
);

app.get(
  "/api/builds/:id/apk",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const build = await prisma.build.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
    });
    if (!build?.artifactPath)
      return reply.code(404).send({ error: "ملف الـAPK لسه مش جاهز." });
    const artifact = path.resolve(build.artifactPath);
    if (!artifact.startsWith(path.join(root, "artifacts") + path.sep))
      return reply.code(403).send({ error: "مسار الملف غير مسموح." });
    try {
      await stat(artifact);
    } catch {
      return reply.code(404).send({ error: "ملف الـAPK مش موجود." });
    }
    return reply
      .header("Content-Type", "application/vnd.android.package-archive")
      .header("Content-Disposition", `attachment; filename="${build.id}.apk"`)
      .send(createReadStream(artifact));
  },
);

app.post(
  "/api/builds/:id/retry",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const build = await prisma.build.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
    });
    if (!build)
      return reply.code(404).send({ error: "مش لاقيين الـBuild ده." });
    if (!["failed", "cancelled"].includes(build.status))
      return reply
        .code(409)
        .send({ error: "تقدر تعيد المحاولة بعد ما البناء يفشل أو يتلغي." });
    if (build.sourceUrl) {
      if (!normalizePublicGitHubRepoUrl(build.sourceUrl))
        return reply
          .code(403)
          .send({ error: "رابط مستودع المشروع غير مسموح." });
    } else if (build.sourcePath) {
      const existingSource = path.resolve(build.sourcePath);
      if (!existingSource.startsWith(path.join(root, "uploads") + path.sep))
        return reply.code(403).send({ error: "مسار المشروع غير مسموح." });
      try {
        await stat(existingSource);
      } catch {
        return reply.code(404).send({
          error: "ملف المشروع الأصلي مش موجود. ارفع المشروع من جديد.",
        });
      }
    } else {
      return reply
        .code(404)
        .send({ error: "مصدر المشروع مش موجود. ابعت الرابط من جديد." });
    }
    const oldJob = await queue.getJob(build.id);
    if (oldJob) {
      const state = await oldJob.getState();
      if (state === "active")
        return reply
          .code(409)
          .send({ error: "لسه بنوقف الـBuild القديم. جرّب تاني بعد ثواني." });
      await oldJob.remove();
    }
    await prisma.build.update({
      where: { id: build.id },
      data: { status: "queued", errorMessage: null },
    });
    await prisma.buildLog.create({
      data: { buildId: build.id, message: "بدأنا محاولة بناء جديدة." },
    });
    await queue.add(
      "build",
      { buildId: build.id },
      {
        jobId: build.id,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    return reply.code(202).send({ ok: true, status: "queued" });
  },
);

app.delete(
  "/api/builds/:id",
  { preHandler: app.authenticate },
  async (request: any, reply) => {
    const build = await prisma.build.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
    });
    if (!build)
      return reply.code(404).send({ error: "مش لاقيين الـBuild ده." });
    if (["completed", "failed", "cancelled"].includes(build.status))
      return reply.code(409).send({ error: "البناء ده خلص بالفعل." });
    const job = await queue.getJob(build.id);
    if (job) {
      const state = await job.getState();
      if (state !== "active") await job.remove();
    }
    await prisma.build.update({
      where: { id: build.id },
      data: { status: "cancelled" },
    });
    await prisma.buildLog.create({
      data: {
        buildId: build.id,
        level: "warn",
        message: "المستخدم ألغى الـBuild.",
      },
    });
    return reply.send({ ok: true });
  },
);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (
    error instanceof Error &&
    "statusCode" in error &&
    error.statusCode === 413
  )
    return reply.code(413).send({ error: "الملف أكبر من الحد المسموح." });
  return reply
    .code(500)
    .send({ error: "حصلت مشكلة غير متوقعة. جرّب تاني بعد شوية." });
});

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  await queue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
