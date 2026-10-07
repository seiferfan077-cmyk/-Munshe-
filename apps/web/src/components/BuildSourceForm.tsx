import { useMemo } from "react";
import {
  ArrowLeft,
  CircleAlert,
  Github,
  Hammer,
  Link2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { normalizePublicGitHubRepoUrl } from "@munshe/shared";

export function suggestedProjectName(value: string) {
  try {
    const segments = new URL(value.trim()).pathname.split("/").filter(Boolean);
    return (segments[1] || "").replace(/\.git$/i, "").slice(0, 80);
  } catch {
    return "";
  }
}

export function BuildSourceForm({
  repoUrl,
  setRepoUrl,
  projectName,
  setProjectName,
  busy,
  error,
  onSubmit,
}: {
  repoUrl: string;
  setRepoUrl: (value: string) => void;
  projectName: string;
  setProjectName: (value: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const validRepo = useMemo(
    () => Boolean(normalizePublicGitHubRepoUrl(repoUrl)),
    [repoUrl],
  );
  const suggestedName = suggestedProjectName(repoUrl);

  return (
    <form className="upload-panel source-panel" onSubmit={onSubmit}>
      <div className="panel-head">
        <div>
          <span className="step">01</span>
          <h2>حط رابط مشروعك</h2>
        </div>
        <span className="format-tag">EXPO · ANDROID</span>
      </div>
      <p className="panel-sub">
        حط رابط مستودع GitHub عام لمشروع Expo، وإحنا نجهّزهولك APK.
      </p>

      <div className="source-badge">
        <span className="source-badge-icon">
          <Github size={18} />
        </span>
        <div>
          <strong>رابط GitHub عام</strong>
          <small>مستودع المشروع كامل، مش رابط ملف أو فرع</small>
        </div>
        <Link2 className="source-badge-link" size={17} />
      </div>

      <label className="source-label" htmlFor="github-repository-url">
        رابط المستودع
        <input
          id="github-repository-url"
          dir="ltr"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://github.com/username/my-expo-app"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          required
        />
      </label>
      <p className="source-hint">
        استخدم رابط الصفحة الرئيسية للمستودع؛ المستودعات الخاصة وروابط الملفات
        مش مدعومة دلوقتي.
      </p>

      <label className="source-label" htmlFor="project-display-name">
        اسم التطبيق <span>اختياري</span>
        <input
          id="project-display-name"
          dir="auto"
          maxLength={80}
          placeholder={suggestedName || "مثال: تطبيقي الجديد"}
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
        />
      </label>

      {repoUrl.trim() && !validRepo && (
        <div className="source-validation" role="status">
          <CircleAlert size={15} /> حط رابط بالشكل ده:
          github.com/اسم-الحساب/اسم-المشروع
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          <CircleAlert size={17} />
          {error}
        </div>
      )}

      <button className="primary launch" disabled={!validRepo || busy}>
        {busy ? (
          <>
            <LoaderCircle className="spin" /> بنجهّز طلبك...
          </>
        ) : (
          <>
            <Hammer size={18} /> يلا جهّزلي الـAPK <ArrowLeft size={17} />
          </>
        )}
      </button>
      <div className="secure-note">
        <ShieldCheck size={15} /> مش بنطلب تسجيل دخول GitHub؛ الرابط لازم يكون
        عام
      </div>
    </form>
  );
}
