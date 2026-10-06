FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@9.15.4
COPY package.json pnpm-workspace.yaml .npmrc tsconfig.base.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma
COPY apps/worker apps/worker
RUN pnpm --filter @munshe/shared build && pnpm --filter @munshe/api db:generate && pnpm --filter @munshe/worker build

FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk python3 unzip zip git curl ca-certificates util-linux && rm -rf /var/lib/apt/lists/*
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/android.zip && unzip -q /tmp/android.zip -d ${ANDROID_HOME}/cmdline-tools && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && rm /tmp/android.zip && yes | sdkmanager --licenses >/dev/null && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
RUN groupadd --gid 10002 builder && useradd --uid 10002 --gid 10002 --create-home --shell /usr/sbin/nologin builder && mkdir -p /data/uploads /data/artifacts && chown -R 1000:1000 /data
WORKDIR /app
RUN npm install -g pnpm@9.15.4 yarn@1.22.22
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/worker/package.json apps/worker/package.json
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/worker/src/safe_extract.py /app/safe_extract.py
RUN pnpm install --prod --frozen-lockfile && pnpm --filter @munshe/api db:generate
CMD ["node", "apps/worker/dist/worker.js"]
