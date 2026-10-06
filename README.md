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

## كيف يعمل عامل بناء APK؟

العامل خدمة مستقلة عن واجهة المستخدم والـAPI: الـAPI يستقبل المشروع وينشئ مهمة قصيرة في BullMQ، بينما عامل Android يسحب المهمة وينفّذ خطوات البناء على Linux مجهز بـNode.js 22 وJava 17 وAndroid SDK. Redis للطابور، وPostgreSQL لحالة المهمة وسجلاتها، وDocker volume مشترك لملف ZIP وAPK. العامل يعالج مهمة واحدة في كل مرة (`concurrency: 1`) حتى لا تتداخل مجلدات البناء.

```text
المتصفح ── ZIP + JWT ──> API ──> ملف خاص + Build row ──> Redis/BullMQ
                                                           │
                                                           ▼
المتصفح <── تنزيل APK ── API <── APK خاص + artifactPath <── Worker
                                                           │
                              فحص ZIP → تثبيت الحزم → Expo prebuild → Gradle
```

### 1. استلام المشروع وإنشاء المهمة

يرسل المتصفح `POST /api/builds` بصيغة `multipart/form-data`، وفيه `projectName` وملف `project`، ومعه JWT. يتحقق الـAPI من ملكية الجلسة وامتداد ZIP وحد الرفع (300 MB)، ويحفظ الملف باسم UUID في مجلد `uploads` الخاص، بصلاحيات قراءة للـAPI فقط. بعد ذلك ينشئ سجلًا في جدول `Build` وسجلًا أوليًا في `BuildLog`، ثم يضيف إلى Redis مهمة تحتوي على `buildId` فقط؛ لا يُرسل محتوى المشروع داخل رسالة الطابور. من هذه اللحظة تظهر الحالة `queued`.

### 2. سحب المهمة وتجهيز مساحة مؤقتة

يقرأ العامل سجل البناء وملف ZIP من الـvolume، وينشئ مجلد عمل مؤقتًا مستقلًا لكل Build. قبل استخراج أي ملف، يفحصه `apps/worker/src/safe_extract.py`: يرفض أسماء المسارات التي تحاول الخروج من مجلد المشروع، والروابط الرمزية، والأرشيفات التالفة أو الفارغة، والأرشيفات التي تتجاوز 50,000 مدخل أو 2 GB بعد فك الضغط. يبحث بعد ذلك عن `package.json` في جذر ZIP أو مجلد مشروع مباشر تحته، ويتأكد أن `expo` موجود ضمن dependencies. أثناء هذه الخطوة تكون الحالة `preparing`.

### 3. تثبيت اعتماديات JavaScript

تتحول الحالة إلى `installing`. يختار العامل مدير الحزم من ملف القفل:

| الملف الموجود في المشروع | الأمر المنفّذ                                       |
| ------------------------ | --------------------------------------------------- |
| `pnpm-lock.yaml`         | `pnpm install --frozen-lockfile --ignore-scripts`   |
| `yarn.lock`              | `yarn install --frozen-lockfile --ignore-scripts`   |
| `package-lock.json`      | `npm ci --ignore-scripts --no-audit --no-fund`      |
| لا يوجد ملف قفل          | `npm install --ignore-scripts --no-audit --no-fund` |

تعطيل lifecycle scripts يقلل تشغيل أوامر تلقائية أثناء تنزيل الحزم. لكن بعض الحزم الأصلية تعتمد على install scripts؛ لو احتاجها المشروع قد تفشل الخطوة ويظهر ملخص الخطأ في Logs بدل تجاهل المشكلة أو ادعاء نجاح البناء.

### 4. إنشاء مشروع Android بواسطة Expo

بعد اكتمال الاعتماديات تصبح الحالة `building`. ينفّذ العامل:

```bash
npx --no-install expo prebuild --platform android --non-interactive --no-install
```

يقرأ Expo إعدادات التطبيق (`app.json` أو `app.config.*`) وإضافات Expo config plugins، ثم يولد مشروع Android الأصلي داخل `android/` بما يشمل إعدادات Gradle وملفات التطبيق. خيارا `--no-install` يمنعان تثبيت الحزم مرة ثانية بعد الخطوة السابقة. إعدادات المشروع والإضافات البرمجية المرفوعة تُنفّذ داخل صلاحيات البناء المقيدة، لذلك قد تفشل أو تحتاج تغييرات إذا كان المشروع يستخدم إعداد Expo غير مدعوم أو اعتمادًا خاصًا.

### 5. بناء APK عبر Gradle

تحتوي صورة العامل على OpenJDK 17 وAndroid command-line tools، وAndroid platform 35 وBuild Tools 35.0.0 وPlatform Tools. بعد Expo prebuild يشغّل العامل Gradle wrapper الذي أنشأه Expo:

```bash
cd android
./gradlew --no-daemon --no-configuration-cache assembleDebug
```

يجلب Gradle مكونات البناء اللازمة، يترجم مصادر Android والـnative modules، ثم ينتج ملفًا في `android/app/build/outputs/apk/debug/app-debug.apk`. يتحقق العامل من وجود الملف وأن حجمه معقول؛ لا يوقّع هذه النسخة بمفتاح نشر خاص. الناتج **Debug APK** صالح للاختبار والتثبيت على Android، لكنه ليس إصدار Release جاهزًا للنشر في Google Play. يتطلب البناء وصولًا للشبكة لتنزيل اعتماديات npm وGradle وAndroid عند الحاجة.

### 6. حفظ النتيجة وإتاحتها لصاحب الحساب

ينسخ العامل APK إلى مجلد `artifacts` على الـvolume، ويضبط صلاحياته لتسمح لخدمة الـAPI بقراءته دون كشفه لمجلدات بناء المستخدمين الآخرين. يكتب مساره في `Build.artifactPath`، يغيّر الحالة إلى `completed`، ويضيف سجل نجاح. يطلب المتصفح `GET /api/builds/:id/apk`؛ يتحقق الـAPI من JWT وملكية هذا الـBuild قبل إرسال الملف. أسماء الملفات العامة لا تحتوي إلا على معرّف المهمة، ولا توجد روابط تنزيل عامة.

### 7. الفشل والإلغاء وإعادة المحاولة

في كل خطوة يسجل العامل الحالة ورسائل المراحل في قاعدة البيانات. يحتفظ بمقطع محدود من خرج الأمر عند الفشل، ويحفظه في `errorMessage` وLogs لتسهيل معرفة هل المشكلة من تثبيت الحزم أو Expo أو Gradle. الحد الافتراضي للمهمة كلها 45 دقيقة (`BUILD_TIMEOUT_MINUTES`)، والمجلد المؤقت يُحذف في نهاية المهمة سواء نجحت أو فشلت.

عند إلغاء مهمة منتظرة يحذف الـAPI عنصرها من الطابور ويعلّم السجل `cancelled`. وإذا كانت بدأت بالفعل، يغيّر الحالة ويستطلع العامل الحالة كل بضع ثوانٍ؛ يرسل `SIGTERM` للعملية ثم `SIGKILL` إذا لم تتوقف. تحديثات الحالات مشروطة بألا تكون المهمة قد أُلغيت، حتى لا يكتب العامل `completed` فوق الإلغاء. زر «إعادة المحاولة» متاح للحالات `failed` و`cancelled` إذا بقي ZIP الأصلي، ويعيد استخدامه مع الاحتفاظ بسجل المحاولات.

### حدود العزل الحالية

عمليات المشروع (`pnpm`/`npm`/`yarn` وExpo وGradle) تعمل بواسطة `setpriv` تحت UID/GID `10002`، مع حذف مجموعات المستخدم، وإزالة Linux capabilities ومنع اكتساب صلاحيات أعلى. كما تمرر لها بيئة تشغيل محدودة لا تتضمن `DATABASE_URL` أو `REDIS_URL` أو `JWT_SECRET`، وتُحصر `HOME` وملفات Gradle المؤقتة في مجلد المهمة. هذا يقلل أثر كود البناء على الخادم، لكنه **ليس بديلًا عن sandbox/VM مستقلة**: اتصال الشبكة الخارجي متاح أثناء تنزيل الاعتماديات، والـMVP لا يطبق حتى الآن عزل egress أو حدود موارد لكل build. لا تفتح معالجة مشاريع مجهولة للعامة قبل إضافة عزل شبكة وموارد أقوى ومراجعة إعدادات النشر.

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
