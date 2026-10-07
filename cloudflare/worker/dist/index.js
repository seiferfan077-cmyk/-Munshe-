const json = (body, status = 200, origin = "*") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-credentials": "true"
  }
});
function b64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let value = "";
  for (const byte of data) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function unb64(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  );
}
async function sessionToken(userId, secret) {
  const payload = b64(
    new TextEncoder().encode(
      JSON.stringify({ sub: userId, exp: Date.now() + 12 * 60 * 60 * 1e3 })
    )
  );
  return `${payload}.${await hmac(payload, secret)}`;
}
async function userFromRequest(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(payload, env.SESSION_SECRET))
    return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64(payload)));
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    return null;
  }
}
async function hashPassword(password, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 12e4,
      hash: "SHA-256"
    },
    key,
    256
  );
  return `${salt}.${b64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(".");
  if (!salt || !expected) return false;
  const actual = (await hashPassword(password, salt)).split(".")[1];
  return actual === expected;
}
function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "munshe-serverless-api"
  };
}
async function github(env, path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json",
      ...init.headers
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(`GitHub ${response.status}: ${(data == null ? void 0 : data.message) || text}`);
  return data;
}
function normalizeRepo(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash || url.username || url.password)
      return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1]))
      return null;
    return `https://github.com/${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}
async function refreshBuild(build, env) {
  if (build.status === "completed" || build.status === "failed") return build;
  if (!build.workflow_run_id) {
    const runs = await github(
      env,
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/runs?event=workflow_dispatch&per_page=50`
    );
    const created = new Date(build.created_at).getTime();
    const run2 = runs.workflow_runs.find(
      (item) => Math.abs(new Date(item.created_at).getTime() - created) < 15 * 60 * 1e3
    );
    if (run2) {
      await env.DB.prepare(
        "UPDATE builds SET workflow_run_id=?, status='building', updated_at=datetime('now') WHERE id=?"
      ).bind(String(run2.id), build.id).run();
      build.workflow_run_id = String(run2.id);
      build.status = "building";
    }
  }
  if (!build.workflow_run_id) return build;
  const run = await github(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${build.workflow_run_id}`
  );
  if (run.status !== "completed") return build;
  if (run.conclusion !== "success") {
    await env.DB.prepare(
      "UPDATE builds SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?"
    ).bind(`GitHub Actions: ${run.conclusion || "unknown"}`, build.id).run();
    build.status = "failed";
    build.error_message = `GitHub Actions: ${run.conclusion || "unknown"}`;
    return build;
  }
  const artifacts = await github(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${build.workflow_run_id}/artifacts`
  );
  const artifact = artifacts.artifacts.find(
    (item) => item.name === `munshe-apk-${build.id}` && !item.expired
  );
  if (!artifact) return build;
  await env.DB.prepare(
    "UPDATE builds SET status='completed', artifact_id=?, artifact_name=?, artifact_expires_at=?, updated_at=datetime('now') WHERE id=?"
  ).bind(String(artifact.id), artifact.name, artifact.expires_at, build.id).run();
  build.status = "completed";
  build.artifact_id = String(artifact.id);
  build.artifact_name = artifact.name;
  build.artifact_expires_at = artifact.expires_at;
  return build;
}
async function route(request, env) {
  var _a, _b, _c, _d;
  const url = new URL(request.url);
  const origin = env.ALLOWED_ORIGIN || "*";
  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method === "GET" && url.pathname === "/health")
    return json({ status: "ok" }, 200, origin);
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await request.json();
    const email = ((_a = body.email) == null ? void 0 : _a.trim().toLowerCase()) || "";
    if (!/^\S+@\S+\.\S+$/.test(email) || !body.password || body.password.length < 10)
      return json(
        { error: "\u0627\u0633\u062A\u062E\u062F\u0645 \u0628\u0631\u064A\u062F\u064B\u0627 \u0635\u062D\u064A\u062D\u064B\u0627 \u0648\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0645\u0646 10 \u0623\u062D\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644." },
        400,
        origin
      );
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) return json({ error: "\u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0641\u0639\u0644." }, 409, origin);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id,email,password_hash) VALUES (?,?,?)"
    ).bind(id, email, await hashPassword(body.password)).run();
    return json(
      {
        token: await sessionToken(id, env.SESSION_SECRET),
        user: { id, email }
      },
      201,
      origin
    );
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await request.json();
    const email = ((_b = body.email) == null ? void 0 : _b.trim().toLowerCase()) || "";
    const user = await env.DB.prepare(
      "SELECT id,email,password_hash FROM users WHERE email=?"
    ).bind(email).first();
    if (!user || !body.password || !await verifyPassword(body.password, user.password_hash))
      return json({ error: "\u0627\u0644\u0628\u0631\u064A\u062F \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0645\u0634 \u0635\u062D\u064A\u062D\u064A\u0646." }, 401, origin);
    return json(
      {
        token: await sessionToken(user.id, env.SESSION_SECRET),
        user: { id: user.id, email: user.email }
      },
      200,
      origin
    );
  }
  const userId = await userFromRequest(request, env);
  if (!userId)
    return json({ error: "\u0633\u062C\u0651\u0644 \u062F\u062E\u0648\u0644\u0643 \u0627\u0644\u0623\u0648\u0644 \u0639\u0634\u0627\u0646 \u062A\u0643\u0645\u0644." }, 401, origin);
  if (request.method === "POST" && url.pathname === "/api/builds/from-github") {
    const body = await request.json();
    const sourceUrl = body.sourceUrl ? normalizeRepo(body.sourceUrl) : null;
    const ref = ((_c = body.ref) == null ? void 0 : _c.trim()) || "main";
    if (!sourceUrl || !/^[A-Za-z0-9._/-]+$/.test(ref))
      return json(
        { error: "\u062D\u0637 \u0631\u0627\u0628\u0637 GitHub \u0639\u0627\u0645 \u0635\u062D\u064A\u062D \u0648\u0627\u0633\u0645 \u0641\u0631\u0639 \u0635\u0627\u0644\u062D." },
        400,
        origin
      );
    const repoName = sourceUrl.split("/").pop() || "expo-project";
    const id = crypto.randomUUID();
    const projectName = (((_d = body.projectName) == null ? void 0 : _d.trim()) || repoName).slice(0, 80);
    await env.DB.prepare(
      "INSERT INTO builds (id,user_id,project_name,source_url,status) VALUES (?,?,?,?,?)"
    ).bind(id, userId, projectName, sourceUrl, "queued").run();
    try {
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/dispatches`,
        {
          method: "POST",
          headers: {
            ...githubHeaders(env),
            "content-type": "application/json"
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { repository_url: sourceUrl, ref, build_id: id }
          })
        }
      );
      if (!response.ok) throw new Error(await response.text());
      return json(
        { build: { id, projectName, status: "queued" } },
        202,
        origin
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "GitHub Actions error";
      await env.DB.prepare(
        "UPDATE builds SET status='failed', error_message=? WHERE id=?"
      ).bind(message, id).run();
      return json({ error: "\u0645\u0634 \u0642\u0627\u062F\u0631\u064A\u0646 \u0646\u0628\u062F\u0623 \u0627\u0644\u0628\u0646\u0627\u0621 \u062F\u0644\u0648\u0642\u062A\u064A." }, 502, origin);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/builds") {
    const result = await env.DB.prepare(
      "SELECT * FROM builds WHERE user_id=? ORDER BY created_at DESC LIMIT 50"
    ).bind(userId).all();
    const builds = [];
    for (const build of result.results || []) {
      builds.push(await refreshBuild(build, env));
    }
    return json({ builds }, 200, origin);
  }
  const match = url.pathname.match(/^\/api\/builds\/([^/]+)(?:\/(apk))?$/);
  if (match) {
    const build = await env.DB.prepare(
      "SELECT * FROM builds WHERE id=? AND user_id=?"
    ).bind(match[1], userId).first();
    if (!build) return json({ error: "\u0645\u0634 \u0644\u0627\u0642\u064A\u064A\u0646 \u0627\u0644\u0640Build \u062F\u0647." }, 404, origin);
    const current = await refreshBuild(build, env);
    if (match[2] === "apk") {
      if (current.status !== "completed" || !current.artifact_id)
        return json({ error: "\u0645\u0644\u0641 \u0627\u0644\u0640APK \u0644\u0633\u0647 \u0645\u0634 \u062C\u0627\u0647\u0632." }, 404, origin);
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/artifacts/${current.artifact_id}/zip`,
        { headers: githubHeaders(env), redirect: "manual" }
      );
      const location = response.headers.get("location");
      if (!location)
        return json(
          { error: "\u0645\u0634 \u0642\u0627\u062F\u0631\u064A\u0646 \u0646\u062C\u064A\u0628 \u0645\u0644\u0641 \u0627\u0644\u0640APK \u062F\u0644\u0648\u0642\u062A\u064A." },
          502,
          origin
        );
      return Response.redirect(location, 302);
    }
    const logs = [
      {
        id: `${current.id}-status`,
        level: current.status === "failed" ? "error" : "info",
        message: current.error_message || current.status,
        createdAt: current.created_at
      }
    ];
    return json({ build: current, logs }, 200, origin);
  }
  return json({ error: "\u0627\u0644\u0645\u0633\u0627\u0631 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." }, 404, origin);
}
var index_default = {
  fetch: (request, env) => route(request, env).catch(
    (error) => json(
      { error: "\u062D\u0635\u0644\u062A \u0645\u0634\u0643\u0644\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u0633\u064A\u0631\u0641\u0631." },
      500,
      env.ALLOWED_ORIGIN || "*"
    )
  )
};
export {
  index_default as default
};
