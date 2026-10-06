import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const storage = path.resolve(process.env.STORAGE_DIR || "./.data");
const timeoutMs = Number(process.env.BUILD_TIMEOUT_MINUTES || 45) * 60_000;
const builderUid = "10002";

async function log(
  buildId: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
) {
  const safe = message
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 1000);
  await prisma.buildLog.create({ data: { buildId, message: safe, level } });
  console.log(`[${buildId}] ${safe}`);
}

async function setStatus(buildId: string, status: string) {
  const changed = await prisma.build.updateMany({
    where: { id: buildId, status: { not: "cancelled" } },
    data: { status },
  });
  if (!changed.count) throw new Error("تم إلغاء الـBuild.");
}

function run(
  command: string,
  args: string[],
  cwd: string,
  buildId: string,
  envRoot: string,
  deadline: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const home = path.join(envRoot, "home");
    const tmp = path.join(envRoot, "tmp");
    const sdk = process.env.ANDROID_HOME ?? "/opt/android-sdk";
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: `/usr/local/bin:${sdk}/cmdline-tools/latest/bin:${sdk}/platform-tools:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: tmp,
      CI: "1",
      EXPO_NO_TELEMETRY: "1",
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      JAVA_HOME: "/usr/lib/jvm/java-17-openjdk-amd64",
      JAVA_TOOL_OPTIONS: "-Xmx4g -XX:MaxMetaspaceSize=1g",
      GRADLE_USER_HOME: path.join(home, ".gradle"),
      npm_config_update_notifier: "false",
    };
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      reject(new Error("انتهى وقت البناء المسموح."));
      return;
    }
    const child = spawn(
      "setpriv",
      [
        "--no-new-privs",
        "--bounding-set=-all",
        `--reuid=${builderUid}`,
        `--regid=${builderUid}`,
        "--clear-groups",
        "--",
        command,
        ...args,
      ],
      { cwd, env: safeEnv, stdio: ["ignore", "pipe", "pipe"] },
    );
    let tail = "";
    let settled = false;
    let cancelled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("انتهى وقت البناء المسموح."));
    }, remainingMs);
    const cancelPoll = setInterval(async () => {
      try {
        const latest = await prisma.build.findUnique({
          where: { id: buildId },
          select: { status: true },
        });
        if (latest?.status === "cancelled" && !cancelled) {
          cancelled = true;
          child.kill("SIGTERM");
          const killTimer = setTimeout(() => child.kill("SIGKILL"), 8000);
          killTimer.unref();
        }
      } catch (error) {
        console.error("Could not check cancellation", error);
      }
    }, 3000);
    cancelPoll.unref();
    const collect = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-6000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancelPoll);
      if (error) reject(new Error(`${error.message}\n${tail.slice(-3500)}`));
      else resolve();
    }
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (cancelled) finish(new Error("تم إلغاء الـBuild."));
      else if (code === 0) finish();
      else
        finish(
          new Error(`أمر البناء انتهى بكود ${code}.\n${tail.slice(-3500)}`),
        );
    });
  });
}

async function locateProject(root: string): Promise<string> {
  for (const candidate of [
    root,
    ...(await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => path.join(root, d.name)),
  ]) {
    try {
      const pkg = JSON.parse(
        await readFile(path.join(candidate, "package.json"), "utf8"),
      );
      if (pkg.dependencies?.expo || pkg.devDependencies?.expo) return candidate;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    "ما لقيناش مشروع Expo في الملف المضغوط. اتأكد إن package.json فيه expo.",
  );
}

async function processBuild(job: Job<{ buildId: string }>) {
  const { buildId } = job.data;
  const build = await prisma.build.findUnique({ where: { id: buildId } });
  if (!build || build.status === "cancelled") return;
  const workdir = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "munshe-")),
  );
  const extracted = path.join(workdir, "source");
  const sourceCopy = path.join(workdir, "project.zip");
  const deadline = Date.now() + timeoutMs;
  try {
    await chmod(workdir, 0o755);
    for (const folder of ["home", "tmp"]) {
      const p = path.join(workdir, folder);
      await mkdir(p, { mode: 0o777 });
      await chmod(p, 0o777);
    }
    await copyFile(build.sourcePath, sourceCopy);
    await chmod(sourceCopy, 0o644);
    await setStatus(buildId, "preparing");
    await log(buildId, "بنراجع ملفات المشروع وبنتأكد إنها آمنة.");
    await run(
      "python3",
      ["/app/safe_extract.py", sourceCopy, extracted],
      workdir,
      buildId,
      workdir,
      deadline,
    );
    const projectDir = await locateProject(extracted);
    const pkg = JSON.parse(
      await readFile(path.join(projectDir, "package.json"), "utf8"),
    );
    if (!pkg.dependencies?.expo && !pkg.devDependencies?.expo)
      throw new Error("المشروع مش مبني بـ Expo.");
    if (pkg.scripts?.postinstall)
      await log(
        buildId,
        "ملاحظة: بنعطّل postinstall scripts لتقليل مخاطر تشغيل كود غير موثوق.",
        "warn",
      );

    await setStatus(buildId, "installing");
    await log(buildId, "بنثبت حزم المشروع من ملف القفل الموجود.");
    const hasPnpm = await fileExists(path.join(projectDir, "pnpm-lock.yaml"));
    const hasYarn = await fileExists(path.join(projectDir, "yarn.lock"));
    const hasNpm = await fileExists(path.join(projectDir, "package-lock.json"));
    if (hasPnpm)
      await run(
        "pnpm",
        ["install", "--frozen-lockfile", "--ignore-scripts"],
        projectDir,
        buildId,
        workdir,
        deadline,
      );
    else if (hasYarn)
      await run(
        "yarn",
        ["install", "--frozen-lockfile", "--ignore-scripts"],
        projectDir,
        buildId,
        workdir,
        deadline,
      );
    else if (hasNpm)
      await run(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        projectDir,
        buildId,
        workdir,
        deadline,
      );
    else
      await run(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
        projectDir,
        buildId,
        workdir,
        deadline,
      );

    await setStatus(buildId, "building");
    await log(buildId, "بنبدأ تجهيز Android وبناء نسخة APK.");
    await run(
      "npx",
      [
        "--no-install",
        "expo",
        "prebuild",
        "--platform",
        "android",
        "--non-interactive",
        "--no-install",
      ],
      projectDir,
      buildId,
      workdir,
      deadline,
    );
    const gradle = path.join(projectDir, "android", "gradlew");
    await run("chmod", ["+x", gradle], projectDir, buildId, workdir, deadline);
    await run(
      gradle,
      ["--no-daemon", "--no-configuration-cache", "assembleDebug"],
      path.dirname(gradle),
      buildId,
      workdir,
      deadline,
    );
    const apk = path.join(
      projectDir,
      "android",
      "app",
      "build",
      "outputs",
      "apk",
      "debug",
      "app-debug.apk",
    );
    const info = await stat(apk);
    if (!info.isFile() || info.size < 1024)
      throw new Error("البناء انتهى لكن ملف APK الناتج غير صالح.");
    const artifactPath = path.join(storage, "artifacts", `${buildId}.apk`);
    await copyFile(apk, artifactPath);
    await chown(artifactPath, 1000, 1000);
    await chmod(artifactPath, 0o640);
    const changed = await prisma.build.updateMany({
      where: { id: buildId, status: { not: "cancelled" } },
      data: { status: "completed", artifactPath },
    });
    if (!changed.count) {
      await rm(artifactPath, { force: true });
      throw new Error("تم إلغاء الـBuild.");
    }
    await log(buildId, "التطبيق خلص، ملف APK جاهز للتحميل.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "حصلت مشكلة أثناء البناء.";
    const latest = await prisma.build.findUnique({
      where: { id: buildId },
      select: { status: true },
    });
    if (latest?.status === "cancelled")
      await log(buildId, "تم إلغاء الـBuild.", "warn");
    else {
      await prisma.build.update({
        where: { id: buildId },
        data: { status: "failed", errorMessage: message.slice(0, 4000) },
      });
      await log(buildId, "فشل البناء: " + message.slice(-3000), "error");
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function fileExists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const worker = new Worker("android-builds", processBuild, {
  connection: redis,
  concurrency: 1,
  lockDuration: timeoutMs + 120_000,
  stalledInterval: 30_000,
});
worker.on("failed", (job, error) =>
  console.error("Queue job failed", job?.id, error),
);
console.log("Munshe Android Build Worker is listening");

async function shutdown() {
  await worker.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
