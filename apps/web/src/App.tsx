import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Code2,
  FileArchive,
  Hammer,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import {
  STATUS_LABELS_AR,
  type BuildLogEntry,
  type BuildSummary,
  type BuildStatus,
} from "@munshe/shared";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
type Session = { token: string; user: { id: string; email: string } };
type Details = { build: BuildSummary; logs: BuildLogEntry[] };

async function request<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "حصلت مشكلة. جرّب تاني.");
  return data as T;
}

const terminal = (s: BuildStatus) =>
  ["completed", "failed", "cancelled"].includes(s);
const date = (s: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(s));

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Code2 size={20} strokeWidth={2.2} />
        <i />
      </div>
      <div>
        <b>مُنشئ</b>
        <small>MUNSHE'</small>
      </div>
    </div>
  );
}

function Auth({ onLogin }: { onLogin: (s: Session) => void }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await request<Session>(
          `/api/auth/${signup ? "register" : "login"}`,
          undefined,
          { method: "POST", body: JSON.stringify({ email, password }) },
        ),
      );
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <nav className="topbar">
        <Brand />
        <span className="top-note">
          <ShieldCheck size={15} /> كودك في أمان
        </span>
      </nav>
      <section className="auth-shell">
        <div className="auth-copy">
          <div className="eyebrow">
            <span /> من الكود للتطبيق
          </div>
          <h1>
            عندك الكود؟
            <br />
            <em>مُنشئ يطلع لك التطبيق.</em>
          </h1>
          <p>
            ارفع مشروع Expo بتاعك، وسيب علينا تجهيز نسخة Android جاهزة للتثبيت.
          </p>
          <div className="auth-flow">
            <span>
              <FileArchive /> ZIP
            </span>
            <i />
            <span>
              <Hammer /> Build
            </span>
            <i />
            <span>
              <ArrowDownToLine /> APK
            </span>
          </div>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <div className="card-icon">
            <Code2 />
          </div>
          <h2>{signup ? "اعمل حساب جديد" : "أهلاً بيك تاني"}</h2>
          <p>
            {signup
              ? "حسابك هو بداية أول Build."
              : "سجّل دخولك عشان تكمّل مشروعاتك."}
          </p>
          {error && (
            <div className="error-box">
              <CircleAlert size={17} />
              {error}
            </div>
          )}
          <label>
            البريد الإلكتروني
            <input
              type="email"
              autoComplete="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            كلمة المرور
            <input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 10 : 1}
              required
              placeholder={signup ? "10 أحرف على الأقل" : "اكتب كلمة المرور"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : null}
            {signup ? "إنشاء الحساب" : "تسجيل الدخول"}
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSignup(!signup);
              setError("");
            }}
          >
            {signup ? "عندك حساب؟ سجّل دخولك" : "أول مرة هنا؟ اعمل حساب"}
          </button>
        </form>
      </section>
      <div className="auth-footer">
        مُنشئ ومُرشَد — من عيلة واحدة، وكل منتج له حكايته.
      </div>
    </main>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("munshe-session") || "null");
    } catch {
      return null;
    }
  });
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const token = session?.token;
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await request<{ builds: BuildSummary[] }>(
        "/api/builds",
        token,
      );
      setBuilds(data.builds);
    } catch (e) {
      if ((e as Error).message.includes("سجّل دخولك")) logout();
    }
  }, [token]);
  function saveSession(value: Session) {
    localStorage.setItem("munshe-session", JSON.stringify(value));
    setSession(value);
  }
  function logout() {
    localStorage.removeItem("munshe-session");
    setSession(null);
    setBuilds([]);
    setDetails(null);
  }
  useEffect(() => {
    if (!token) return;
    load();
    const timer = window.setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [token, load]);
  useEffect(() => {
    if (!token || !selected) {
      setDetails(null);
      return;
    }
    let alive = true;
    const fetchDetails = async () => {
      try {
        const res = await request<Details>(`/api/builds/${selected}`, token);
        if (alive) setDetails(res);
      } catch {
        /* build may have been deleted */
      }
    };
    fetchDetails();
    const timer = window.setInterval(fetchDetails, 3500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, selected]);
  if (!session) return <Auth onLogin={saveSession} />;

  function choose(f?: File) {
    if (!f) return;
    setError("");
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setError("لازم ترفع ملف ZIP للمشروع.");
      return;
    }
    if (f.size > 300 * 1024 * 1024) {
      setError("الملف أكبر من 300 ميجا.");
      return;
    }
    setFile(f);
    if (!projectName) setProjectName(f.name.replace(/\.zip$/i, ""));
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !token) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("projectName", projectName);
      form.append("project", file);
      const result = await request<{ build: { id: string } }>(
        "/api/builds",
        token,
        { method: "POST", body: form },
      );
      setFile(null);
      setProjectName("");
      if (picker.current) picker.current.value = "";
      setSelected(result.build.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retryBuild(id: string) {
    try {
      await request(`/api/builds/${id}/retry`, token, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancelBuild(id: string) {
    try {
      await request(`/api/builds/${id}`, token, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download(id: string) {
    try {
      const res = await fetch(`${API}/api/builds/${id}/apk`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("مش قادرين ننزّل الـAPK دلوقتي.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.apk`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const current = details?.build;
  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="header-right">
          <span className="env-badge">
            <i /> بيئة آمنة
          </span>
          <span className="user-email">{session.user.email}</span>
          <button className="logout" title="تسجيل الخروج" onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <main className="dashboard">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">
              <span /> منصة بناء تطبيقات Android
            </div>
            <h1>
              حوّل كودك لـ <em>تطبيق.</em>
            </h1>
            <p>ارفع مشروع Expo، ومُنشئ يتولى الباقي.</p>
          </div>
          <div className="welcome-code">
            <span>01</span>
            <Code2 size={39} />
            <small>CODE → APP</small>
          </div>
        </div>
        <section className="workspace">
          <form className="upload-panel" onSubmit={upload}>
            <div className="panel-head">
              <div>
                <span className="step">01</span>
                <h2>ارفع مشروعك</h2>
              </div>
              <span className="format-tag">EXPO / REACT NATIVE</span>
            </div>
            <p className="panel-sub">
              ارفع المشروع كله في ملف ZIP. هنراجع الملفات قبل ما يبدأ البناء.
            </p>
            <div
              className={`dropzone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files[0]);
              }}
              onClick={() => picker.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && picker.current?.click()}
            >
              <input
                ref={picker}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => choose(e.target.files?.[0])}
              />
              {file ? (
                <>
                  <div className="file-icon">
                    <FileArchive />
                  </div>
                  <div className="file-info">
                    <strong>{file.name}</strong>
                    <small>
                      {(file.size / 1024 / 1024).toFixed(1)} MB · جاهز للرفع
                    </small>
                  </div>
                  <button
                    type="button"
                    className="remove-file"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                  >
                    <X size={17} />
                  </button>
                </>
              ) : (
                <>
                  <div className="upload-icon">
                    <Upload />
                  </div>
                  <strong>اسحب ملف ZIP هنا</strong>
                  <span>
                    أو <b>اختار ملف من جهازك</b>
                  </span>
                  <small>أقصى حجم 300 ميجا</small>
                </>
              )}
            </div>
            {file && (
              <label className="project-name">
                اسم المشروع
                <input
                  value={projectName}
                  maxLength={80}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="مشروعي الجديد"
                  required
                />
              </label>
            )}
            {error && (
              <div className="error-box">
                <CircleAlert size={17} />
                {error}
              </div>
            )}
            <button className="primary launch" disabled={!file || busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" /> بنرفع المشروع...
                </>
              ) : (
                <>
                  <Hammer size={18} /> يلا نبني التطبيق <ArrowLeft size={17} />
                </>
              )}
            </button>
            <div className="secure-note">
              <ShieldCheck size={15} /> ملفاتك بتتخزن بشكل خاص ومش بتظهر لحد
              غيرك
            </div>
          </form>
          <section className="build-panel">
            <div className="panel-head">
              <div>
                <span className="step">02</span>
                <h2>حالة البناء</h2>
              </div>
              <span className="live-tag">
                <i /> مباشر
              </span>
            </div>
            <p className="panel-sub">
              تابع خطوات البناء وحمّل التطبيق أول ما يجهز.
            </p>
            {current ? (
              <div className="active-build">
                <div className="active-title">
                  <div className={`status-icon ${current.status}`}>
                    <StatusIcon status={current.status} />
                  </div>
                  <div>
                    <small>{current.projectName}</small>
                    <strong>{STATUS_LABELS_AR[current.status]}</strong>
                  </div>
                  <button
                    className="select-list"
                    onClick={() => setSelected(null)}
                    title="إغلاق التفاصيل"
                  >
                    <X size={16} />
                  </button>
                </div>
                <BuildProgress status={current.status} />
                <div className="log-head">
                  <span>سجل البناء</span>
                  <span>{details?.logs.length ?? 0} سطر</span>
                </div>
                <div className="logs" key={current.id}>
                  {details?.logs.map((line) => (
                    <div className={`log-row ${line.level}`} key={line.id}>
                      <span className="log-dot" />
                      <time>
                        {new Date(line.createdAt).toLocaleTimeString("ar-EG", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                      <span>{line.message}</span>
                    </div>
                  )) || <div className="empty-logs">بنجهز السجل...</div>}
                </div>
                {current.status === "completed" && (
                  <button
                    className="primary download"
                    onClick={() => download(current.id)}
                  >
                    <ArrowDownToLine size={18} /> حمّل الـAPK
                  </button>
                )}
                {!terminal(current.status) && (
                  <button
                    className="cancel-button"
                    onClick={() => cancelBuild(current.id)}
                  >
                    إلغاء الـBuild
                  </button>
                )}
                {current.status === "failed" && (
                  <div className="error-detail">
                    <strong>حصلت مشكلة أثناء البناء</strong>
                    <p>
                      {current.errorMessage || "راجع الـLogs وشوف المشكلة."}
                    </p>
                    <span>راجع الـLogs وشوف المشكلة</span>
                    <button
                      className="retry-button"
                      onClick={() => retryBuild(current.id)}
                    >
                      <RefreshCw size={13} /> إعادة المحاولة
                    </button>
                  </div>
                )}
              </div>
            ) : builds.length ? (
              <div className="build-list">
                {builds.map((b) => (
                  <button
                    className="build-item"
                    key={b.id}
                    onClick={() => setSelected(b.id)}
                  >
                    <div className={`mini-status ${b.status}`}>
                      <StatusIcon status={b.status} />
                    </div>
                    <div className="item-info">
                      <strong>{b.projectName}</strong>
                      <small>{date(b.createdAt)}</small>
                    </div>
                    <span className={`item-status ${b.status}`}>
                      {STATUS_LABELS_AR[b.status]}
                    </span>
                    <ChevronDown className="item-arrow" size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration">
                  <Code2 size={27} />
                  <span>APK</span>
                </div>
                <strong>لسه مفيش Builds</strong>
                <p>أول ما ترفع مشروعك، تفاصيل البناء هتظهر هنا.</p>
              </div>
            )}
          </section>
        </section>
        <section className="steps-strip">
          <div>
            <span>01</span>
            <div>
              <b>ارفع الكود</b>
              <small>ملف ZIP لمشروع Expo</small>
            </div>
          </div>
          <i />
          <div>
            <span>02</span>
            <div>
              <b>مُنشئ يبني التطبيق</b>
              <small>فحص وتجهيز وبناء</small>
            </div>
          </div>
          <i />
          <div>
            <span>03</span>
            <div>
              <b>حمّل الـAPK</b>
              <small>جاهز للتثبيت على Android</small>
            </div>
          </div>
        </section>
        <footer className="footer">
          <span>مُنشئ — من الكود إلى التطبيق.</span>
          <span>
            جزء من عيلة مُرشَد <span className="footer-sep">/</span> نسخة
            تجريبية
          </span>
        </footer>
      </main>
    </div>
  );
}

function StatusIcon({ status }: { status: BuildStatus }) {
  if (status === "completed") return <Check size={17} />;
  if (status === "failed") return <CircleAlert size={17} />;
  if (status === "queued") return <Clock3 size={17} />;
  if (status === "cancelled") return <X size={17} />;
  return <LoaderCircle className="spin" size={17} />;
}
function BuildProgress({ status }: { status: BuildStatus }) {
  const stages: BuildStatus[] = [
    "preparing",
    "installing",
    "building",
    "completed",
  ];
  const active = stages.indexOf(status);
  const failed = status === "failed";
  return (
    <div className="progress-track">
      {stages.map((stage, i) => (
        <div
          className={`progress-stage ${i < active || status === "completed" ? "done" : i === active || (failed && i === active) ? "current" : ""} ${failed && i === active ? "failed" : ""}`}
          key={stage}
        >
          <span className="progress-dot">
            {i < active || status === "completed" ? (
              <Check size={12} />
            ) : failed && i === active ? (
              <X size={12} />
            ) : i === active ? (
              <LoaderCircle className="spin" size={12} />
            ) : (
              i + 1
            )}
          </span>
          <small>
            {stage === "preparing"
              ? "الفحص"
              : stage === "installing"
                ? "التجهيز"
                : stage === "building"
                  ? "البناء"
                  : "جاهز"}
          </small>
        </div>
      ))}
    </div>
  );
}

export default App;
