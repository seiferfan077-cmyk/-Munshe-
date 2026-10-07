import { useState } from "react";
import { LegalDialog, type LegalPage } from "./LegalDialog.js";

export function SiteFooter({
  variant = "dashboard",
}: {
  variant?: "auth" | "dashboard";
}) {
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null);
  return (
    <>
      <footer className={`site-footer site-footer--${variant}`} dir="rtl">
        <span className="footer-rights">
          © 2026 مُنشي. الحقوق محفوظة لـ مُرشد _S7.
        </span>
        <nav className="footer-links" aria-label="روابط المساعدة والسياسات">
          <a href="mailto:Seiferfan077@gmail.com">الدعم</a>
          <button type="button" onClick={() => setLegalPage("terms")}>
            شروط الاستخدام
          </button>
          <button type="button" onClick={() => setLegalPage("privacy")}>
            الخصوصية
          </button>
        </nav>
      </footer>
      {legalPage && (
        <LegalDialog
          initialPage={legalPage}
          onClose={() => setLegalPage(null)}
        />
      )}
    </>
  );
}
