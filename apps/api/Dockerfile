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
COPY apps/api apps/api
RUN pnpm --filter @munshe/shared build && pnpm --filter @munshe/api db:generate && pnpm --filter @munshe/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@9.15.4 && mkdir -p /data/uploads /data/artifacts && chown -R node:node /data
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/worker/package.json apps/worker/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
RUN pnpm install --prod --frozen-lockfile && pnpm --filter @munshe/api db:generate
USER node
EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter @munshe/api db:migrate && node apps/api/dist/server.js"]
