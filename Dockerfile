FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @crm/web build

FROM node:22-alpine AS migrator
WORKDIR /migrator
RUN npm init -y >/dev/null && npm i --omit=dev drizzle-orm@0.44.7 postgres@3 >/dev/null

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
COPY --from=migrator /migrator/node_modules /migrator/node_modules
COPY --from=build /repo/apps/web/scripts/migrate.mjs /migrator/migrate.mjs
COPY --from=build /repo/packages/db/drizzle /migrator/drizzle
USER app
EXPOSE 3000
CMD ["sh", "-c", "cd /migrator && MIGRATIONS_DIR=/migrator/drizzle node migrate.mjs && cd /app && node apps/web/server.js"]
