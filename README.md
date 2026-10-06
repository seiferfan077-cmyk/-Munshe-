# مُنشئ — من الكود إلى التطبيق

مُنشئ منصة بناء تطبيقات Android لمشروعات Expo / React Native: ارفع ملف المشروع ZIP، تُفحص الملفات، تُثبّت الاعتمادات، يُبنى التطبيق، ثم يصبح ملف APK متاحًا لصاحبه فقط. مُنشئ ومُرشَد منتجان من عائلة واحدة؛ مُرشَد رفيقك الرقمي، ومُنشئ يحوّل كودك إلى تطبيق.

> الحالة: MVP قابل للتشغيل محليًا، يشمل حسابات المستخدمين، واجهة مصرية RTL، API، PostgreSQL، Redis/BullMQ، عامل بناء Expo إلى APK، وDocker Compose.

## بنية المشروع

```text
apps/
  web/       واجهة React + Vite، عربية RTL، رفع ومتابعة وتنزيل
  api/       Fastify API، JWT، Argon2، PostgreSQL/Prisma، إدارة الملفات والطابور
  worker/    عامل BullMQ مستقل، فحص ZIP، Expo prebuild وGradle assembleDebug
packages/
  shared/    أنواع وحالات مشتركة بين الواجهة والخادم والعامل
```

## المتطلبات

- Docker Engine وDocker Compose plugin.
- Node.js 22 وpnpm 9.15.4 للتطوير خارج Docker.
- مساحة كافية لصورة Android SDK وملفات البناء المؤقتة.

## التشغيل باستخدام Docker

1. انسخ `.env.example` إلى `.env`.
2. عيّن قيمًا عشوائية قوية وفريدة لـ`JWT_SECRET` و`POSTGRES_PASSWORD` و`REDIS_PASSWORD`، واضبط `WEB_ORIGIN` و`PUBLIC_API_URL` حسب عنوان النشر الفعلي. الإعدادات الاختيارية الفارغة تستخدم defaults محلية مناسبة.
3. ابدأ الخدمات: `docker compose up --build -d`.
4. افتح `http://localhost:8080`. الـAPI متاح على `http://localhost:4000`.
5. تابع السجلات عبر `docker compose logs -f api worker`، وأوقف البيئة بـ`docker compose down`.

بيانات PostgreSQL وRedis وملفات ZIP وAPK محفوظة في Docker volumes. لا تحذف volumes عند تحديث الخدمة. استخدم `.env` أو Secret Manager الخاص بالـdeployment؛ لا ترفع `.env` إلى GitHub. `.env.example` يحوي أسماء المتغيرات فقط.

## التطوير المحلي

```bash
pnpm install
cp .env.example .env
# عيّن JWT_SECRET وDATABASE_URL وREDIS_URL وWEB_ORIGIN في .env، ثم شغّل PostgreSQL وRedis
pnpm db:generate
pnpm db:migrate
pnpm --filter @munshe/api dev
pnpm --filter @munshe/web dev
```

لإنشاء صورة APK فعلية، شغّل عامل البناء في بيئة Linux فيها Java 17 وAndroid SDK المبيّن في `apps/worker/Dockerfile`، أو استخدم Docker Compose. الخدمة تتطلب اتصالًا شبكيًا لتنزيل npm packages أثناء البناء.

## تجربة الاستخدام

أنشئ حسابًا من واجهة التطبيق بكلمة مرور 10 أحرف على الأقل، ثم ارفع مشروع Expo بصيغة ZIP. يقبل MVP ملفًا حتى 300 MB؛ يمكن أن يحتوي ZIP على المشروع مباشرة أو على مجلد مشروع واحد. يجب أن يحتوي `package.json` على الاعتماد `expo`. ملفات القفل المعروفة مدعومة لـpnpm وYarn وnpm، وبغيابها يستخدم npm. ينتج العامل APK من نوع debug عبر `assembleDebug`، وهو مناسب للاختبار والتثبيت وليس إصدارًا موقّعًا للنشر في المتجر.

حالات البناء: `queued`، `preparing`، `installing`، `building`، `completed`، `failed` و`cancelled`. لكل Build سجلات محفوظة، وتنزيل APK وإعادة المحاولة متاحان لصاحب الحساب فقط.

## واجهات API الأساسية

- `POST /api/auth/register` و`POST /api/auth/login`
- `POST /api/builds` (multipart: `projectName`, `project`)
- `GET /api/builds`، `GET /api/builds/:id`
- `POST /api/builds/:id/retry`، `DELETE /api/builds/:id`
- `GET /api/builds/:id/apk`
- `GET /health`

كل مسارات المشروع تتطلب `Authorization: Bearer <token>` عدا التسجيل والدخول وhealth.

## اعتبارات الأمان وحدود النسخة

كلمات المرور محفوظة بـArgon2، كلمات JWT السرية مطلوبة من البيئة، CORS محدود بالأصل المضبوط، صلاحية الجلسة 12 ساعة، والوصول إلى السجلات والملفات مرتبط بملكية الحساب. تُفحص ZIP لمنع المسارات الخارجة عن مجلد المشروع، الروابط الرمزية، وعدد الملفات/الحجم غير الطبيعي. تنزيل APK يتحقق من الملكية والمسار.

**قبل فتح التسجيل للعامة أو معالجة كود غير موثوق على نطاق إنتاجي:** شغّل بناء كل مشروع في Sandbox منفصلة مؤقتة مع عزل الشبكة/الموارد ونظام ملفات محدود، أضف rate limits وحماية إساءة الاستخدام، إدارة دورة حياة الملفات والاحتفاظ/الحذف، فحص malware، تنبيهات ومقاييس، واستخدم تخزين S3 خاصًا عند التوسع. عامل الـMVP يفصل عن API لكنه يحتاج مراجعة عزل تنفيذ كود المشروع قبل نشره العام؛ لا تعتبره إعدادًا إنتاجيًا مُدقّقًا أمنيًا.

## أوامر الجودة

```bash
pnpm typecheck
pnpm test
pnpm build
```

## عدم تضمين بيانات خاصة

لا تُرفع مفاتيح أو كلمات مرور أو شهادات توقيع Android أو ملفات APK/ZIP خاصة بالمستخدمين. المستودع يحتوي على Source Code و`.env.example` فقط. استخدم أسرارًا منفصلة في بيئة النشر.
