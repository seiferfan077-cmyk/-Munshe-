import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

export type LegalPage = "terms" | "privacy";

export function LegalDialog({
  initialPage,
  onClose,
}: {
  initialPage: LegalPage;
  onClose: () => void;
}) {
  const [page, setPage] = useState<LegalPage>(initialPage);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="legal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="legal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
        dir="rtl"
      >
        <header className="legal-header">
          <div className="legal-header-icon">
            <ShieldCheck size={19} />
          </div>
          <div>
            <small>مُنشي · معلومات تهمّك</small>
            <h2 id="legal-title">
              {page === "terms" ? "شروط الاستخدام" : "الخصوصية"}
            </h2>
          </div>
          <button
            className="legal-close"
            type="button"
            onClick={onClose}
            aria-label="اقفل النافذة"
          >
            <X size={19} />
          </button>
        </header>

        <nav className="legal-tabs" aria-label="اختار القسم">
          <button
            className={page === "terms" ? "active" : ""}
            type="button"
            onClick={() => setPage("terms")}
          >
            شروط الاستخدام
          </button>
          <button
            className={page === "privacy" ? "active" : ""}
            type="button"
            onClick={() => setPage("privacy")}
          >
            الخصوصية
          </button>
        </nav>

        <div className="legal-content">
          {page === "terms" ? (
            <>
              <p className="legal-lead">
                مُنشي خدمة سحابية بتسهّل تجهيز مشروعات Expo، مش خدمة لإنشاء أو
                نشر تطبيقات ضارة.
              </p>
              <h3>استخدام مسموح ومسؤول</h3>
              <p>
                ممنوع تستخدم مُنشي لإنشاء أو تعديل أو تشغيل برمجيات خبيثة، أو
                للتجسس والتصيّد وسرقة البيانات، أو الدخول غير المصرّح به، أو
                انتهاك خصوصية الناس أو حقوقهم، أو أي نشاط مخالف للقانون. ومُنشي
                مش مُلزَم بإنشاء أو معالجة تطبيقات من النوع ده، ومن حقه يرفض
                المهمة أو يوقف الحساب عند إساءة الاستخدام.
              </p>
              <h3>مسؤولية المشروع واستخدامه</h3>
              <p>
                إنت مسؤول عن إنك تملك حق استخدام الكود والأسماء والصور
                والاعتماديات اللي في مشروعك، وعن مراجعة التطبيق واختباره وطريقة
                توزيعه بعد البناء. لو استخدمت الخدمة بشكل مخالف أو سببت ضرر، إنت
                تتحمل مسؤولية أفعالك والعواقب اللي تترتب عليها، بالقدر اللي يسمح
                بيه القانون. الكلام ده ما بيلغيش أي حق أو مسؤولية ما ينفعش
                القانون يستبعدها.
              </p>
              <h3>روابط المشاريع وملفات البناء</h3>
              <p>
                حاليًا ينفع تبدأ البناء برابط مستودع GitHub عام لمشروع Expo؛ مش
                بنطلب صلاحية على حسابك أو على مستودعاتك الخاصة. ما تحطّش كلمات
                سر أو مفاتيح توقيع أو أسرار جوه مستودع عام. الـAPK الناتج نسخة
                Debug للاختبار، ومش نسخة Release موقّعة أو مضمونة الجاهزية للنشر
                في المتاجر.
              </p>
              <p className="legal-disclaimer">
                دي صياغة أولية للتوضيح، ومحتاجة مراجعة قانونية قبل إطلاق الخدمة
                على نطاق عام.
              </p>
            </>
          ) : (
            <>
              <p className="legal-lead">
                بنستخدم أقل قدر من البيانات اللي نحتاجه لتسجيل حسابك وتشغيل
                عملية البناء ومساعدتك لو حصلت مشكلة.
              </p>
              <h3>إيه البيانات اللي بنحتفظ بيها؟</h3>
              <p>
                البريد الإلكتروني، ونسخة مشفّرة من كلمة المرور، واسم المشروع،
                ورابط GitHub اللي بعته، وحالة البناء وسجلاته. وقت تجهيز التطبيق
                العامل بينزّل نسخة مؤقتة من المستودع العام عشان يبنيه. بنحتفظ
                كمان ببيانات تقنية أساسية لازمة لتشغيل الخدمة وحمايتها.
              </p>
              <h3>بنستخدمها إزاي؟</h3>
              <p>
                لتسجيل دخولك، وربط المشروع بحسابك، وتجهيز APK، وعرض حالة البناء
                والسجلات، والرد على طلبات الدعم وحماية الخدمة من إساءة
                الاستخدام. رابط GitHub لازم يكون لمستودع عام؛ GitHub ومصادر حزم
                البناء بتتصل بيها الخدمة وقت الحاجة لتنزيل الكود والاعتماديات.
              </p>
              <h3>مين يقدر يشوف مشروعك؟</h3>
              <p>
                بيانات الحساب وملفات البناء بتتخزن في مساحة الخدمة، والتنزيل
                متاح لصاحب الحساب بعد تسجيل الدخول. رابط المستودع العام ومحتواه
                متاحين أصلًا على GitHub حسب إعدادات المستودع. بلاش تحط بيانات
                شخصية أو أسرار في مشروع عام.
              </p>
              <h3>الاحتفاظ وطلبات الحذف</h3>
              <p>
                الخدمة لسه ما فيهاش حذف تلقائي أو مدة احتفاظ محددة للمشروعات
                وملفات APK. لو عايز تطلب حذف بيانات مرتبطة بحسابك، ابعت لنا على
                بريد الدعم. لازم نحدد ونطبّق سياسة احتفاظ واضحة قبل فتح الخدمة
                للجمهور.
              </p>
              <p className="legal-disclaimer">
                لو عندك سؤال عن بياناتك أو عايز تطلب حذفها، تواصل معانا على
                Seiferfan077@gmail.com.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
