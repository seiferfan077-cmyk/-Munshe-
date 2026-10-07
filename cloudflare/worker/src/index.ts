export interface Env {
  DB: D1Database;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN: string;
}

type UserRow = { id: string; email: string; password_hash: string };
type BuildRow = {
  id: string;
  user_id: string;
  project_name: string;
  source_url: string;
  status: string;
  workflow_run_id: string | null;
  artifact_id: string | null;
  artifact_name: string | null;
  artifact_expires_at: string | null;
  error_message: string | null;
  created_at: string;
};

type GitHubRun = {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
};

type GitHubArtifact = {
  id: number;
  name: string;
  expired: boolean;
  expires_at: string | null;
};

const json = (body: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-credentials": "true",
    },
  });

function b64(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let value = "";
  for (const byte of data) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function unb64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

async function sessionToken(userId: string, secret: string) {
  const payload = b64(
    new TextEncoder().encode(
      JSON.stringify({ sub: userId, exp: Date.now() + 12 * 60 * 60 * 1000 }),
    ),
  );
  return `${payload}.${await hmac(payload, secret)}`;
}

async function userFromRequest(request: Request, env: Env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature] = token.split(".");
  if (
    !payload ||
    !signature ||
    signature !== (await hmac(payload, env.SESSION_SECRET))
  )
    return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64(payload))) as {
      sub: string;
      exp: number;
    };
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    return null;
  }
}

async function hashPassword(password: string, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 120000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `${salt}.${b64(bits)}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(".");
  if (!salt || !expected) return false;
  const actual = (await hashPassword(password, salt)).split(".")[1];
  return actual === expected;
}

function githubHeaders(env: Env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "munshe-serverless-api",
  };
}

async function github<T>(env: Env, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(`GitHub ${response.status}: ${data?.message || text}`);
  return data as T;
}

function normalizeRepo(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .split("/");
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9_.-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]+$/.test(parts[1])
    )
      return null;
    return `https://github.com/${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

async function refreshBuild(build: BuildRow, env: Env) {
  if (build.status === "completed" || build.status === "failed") return build;
  if (!build.workflow_run_id) {
    const runs = await github<{ workflow_runs: GitHubRun[] }>(
      env,
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/runs?event=workflow_dispatch&per_page=50`,
    );
    const created = new Date(build.created_at).getTime();
    const run = runs.workflow_runs.find(
      (item) =>
        Math.abs(new Date(item.created_at).getTime() - created) <
        15 * 60 * 1000,
    );
    if (run) {
      await env.DB.prepare(
        "UPDATE builds SET workflow_run_id=?, status='building', updated_at=datetime('now') WHERE id=?",
      )
        .bind(String(run.id), build.id)
        .run();
      build.workflow_run_id = String(run.id);
      build.status = "building";
    }
  }
  if (!build.workflow_run_id) return build;
  const run = await github<GitHubRun>(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${build.workflow_run_id}`,
  );
  if (run.status !== "completed") return build;
  if (run.conclusion !== "success") {
    await env.DB.prepare(
      "UPDATE builds SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?",
    )
      .bind(`GitHub Actions: ${run.conclusion || "unknown"}`, build.id)
      .run();
    build.status = "failed";
    build.error_message = `GitHub Actions: ${run.conclusion || "unknown"}`;
    return build;
  }
  const artifacts = await github<{ artifacts: GitHubArtifact[] }>(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${build.workflow_run_id}/artifacts`,
  );
  const artifact = artifacts.artifacts.find(
    (item) => item.name === `munshe-apk-${build.id}` && !item.expired,
  );
  if (!artifact) return build;
  await env.DB.prepare(
    "UPDATE builds SET status='completed', artifact_id=?, artifact_name=?, artifact_expires_at=?, updated_at=datetime('now') WHERE id=?",
  )
    .bind(String(artifact.id), artifact.name, artifact.expires_at, build.id)
    .run();
  build.status = "completed";
  build.artifact_id = String(artifact.id);
  build.artifact_name = artifact.name;
  build.artifact_expires_at = artifact.expires_at;
  return build;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = env.ALLOWED_ORIGIN || "*";
  if (request.method === "OPTIONS") return json({}, 204, origin);

  if (request.method === "GET" && url.pathname === "/health")
    return json({ status: "ok" }, 200, origin);

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await request.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() || "";
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      !body.password ||
      body.password.length < 10
    )
      return json(
        { error: "استخدم بريدًا صحيحًا وكلمة مرور من 10 أحرف على الأقل." },
        400,
        origin,
      );
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?")
      .bind(email)
      .first();
    if (exists) return json({ error: "الحساب موجود بالفعل." }, 409, origin);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id,email,password_hash) VALUES (?,?,?)",
    )
      .bind(id, email, await hashPassword(body.password))
      .run();
    return json(
      {
        token: await sessionToken(id, env.SESSION_SECRET),
        user: { id, email },
      },
      201,
      origin,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await request.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() || "";
    const user = await env.DB.prepare(
      "SELECT id,email,password_hash FROM users WHERE email=?",
    )
      .bind(email)
      .first<UserRow>();
    if (
      !user ||
      !body.password ||
      !(await verifyPassword(body.password, user.password_hash))
    )
      return json({ error: "البريد أو كلمة المرور مش صحيحين." }, 401, origin);
    return json(
      {
        token: await sessionToken(user.id, env.SESSION_SECRET),
        user: { id: user.id, email: user.email },
      },
      200,
      origin,
    );
  }

  const userId = await userFromRequest(request, env);
  if (!userId)
    return json({ error: "سجّل دخولك الأول عشان تكمل." }, 401, origin);

  if (request.method === "POST" && url.pathname === "/api/builds/from-github") {
    const body = await request.json<{
      sourceUrl?: string;
      projectName?: string;
      ref?: string;
    }>();
    const sourceUrl = body.sourceUrl ? normalizeRepo(body.sourceUrl) : null;
    const ref = body.ref?.trim() || "main";
    if (!sourceUrl || !/^[A-Za-z0-9._/-]+$/.test(ref))
      return json(
        { error: "حط رابط GitHub عام صحيح واسم فرع صالح." },
        400,
        origin,
      );
    const repoName = sourceUrl.split("/").pop() || "expo-project";
    const id = crypto.randomUUID();
    const projectName = (body.projectName?.trim() || repoName).slice(0, 80);
    await env.DB.prepare(
      "INSERT INTO builds (id,user_id,project_name,source_url,status) VALUES (?,?,?,?,?)",
    )
      .bind(id, userId, projectName, sourceUrl, "queued")
      .run();
    try {
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/dispatches`,
        {
          method: "POST",
          headers: {
            ...githubHeaders(env),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { repository_url: sourceUrl, ref, build_id: id },
          }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      return json(
        { build: { id, projectName, status: "queued" } },
        202,
        origin,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "GitHub Actions error";
      await env.DB.prepare(
        "UPDATE builds SET status='failed', error_message=? WHERE id=?",
      )
        .bind(message, id)
        .run();
      return json({ error: "مش قادرين نبدأ البناء دلوقتي." }, 502, origin);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/builds") {
    const result = await env.DB.prepare(
      "SELECT * FROM builds WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(userId)
      .all<BuildRow>();
    const builds = [];
    for (const build of result.results || []) {
      builds.push(await refreshBuild(build, env));
    }
    return json({ builds }, 200, origin);
  }

  const match = url.pathname.match(/^\/api\/builds\/([^/]+)(?:\/(apk))?$/);
  if (match) {
    const build = await env.DB.prepare(
      "SELECT * FROM builds WHERE id=? AND user_id=?",
    )
      .bind(match[1], userId)
      .first<BuildRow>();
    if (!build) return json({ error: "مش لاقيين الـBuild ده." }, 404, origin);
    const current = await refreshBuild(build, env);
    if (match[2] === "apk") {
      if (current.status !== "completed" || !current.artifact_id)
        return json({ error: "ملف الـAPK لسه مش جاهز." }, 404, origin);
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/artifacts/${current.artifact_id}/zip`,
        { headers: githubHeaders(env), redirect: "manual" },
      );
      const location = response.headers.get("location");
      if (!location)
        return json(
          { error: "مش قادرين نجيب ملف الـAPK دلوقتي." },
          502,
          origin,
        );
      return Response.redirect(location, 302);
    }
    const logs = [
      {
        id: `${current.id}-status`,
        level: current.status === "failed" ? "error" : "info",
        message: current.error_message || current.status,
        createdAt: current.created_at,
      },
    ];
    return json({ build: current, logs }, 200, origin);
  }

  return json({ error: "المسار غير موجود." }, 404, origin);
}

export default {
  fetch: (request: Request, env: Env) =>
    route(request, env).catch((error) =>
      json(
        { error: "حصلت مشكلة داخل السيرفر." },
        500,
        env.ALLOWED_ORIGIN || "*",
      ),
    ),
};
