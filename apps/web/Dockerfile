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
COPY apps/web apps/web
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @munshe/shared build && pnpm --filter @munshe/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
