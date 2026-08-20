FROM node:22.22.2-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/opportunity-lifecycle/package.json packages/opportunity-lifecycle/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter worker... 2>/dev/null || pnpm install --filter worker...

FROM deps AS build
COPY . .
RUN pnpm --filter @platform/config run build
RUN pnpm --filter @platform/domain run build
RUN pnpm --filter @platform/opportunity-lifecycle run build
RUN npx --prefix apps/worker prisma generate --schema apps/api/prisma/schema.prisma
RUN pnpm --filter worker run build

FROM node:22.22.2-slim AS runtime
ENV NODE_ENV=production
ENV TZ=UTC
RUN corepack enable
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/packages/config/package.json ./packages/config/package.json
COPY --from=build /workspace/packages/config/dist ./packages/config/dist
COPY --from=build /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build /workspace/packages/opportunity-lifecycle/package.json ./packages/opportunity-lifecycle/package.json
COPY --from=build /workspace/packages/opportunity-lifecycle/dist ./packages/opportunity-lifecycle/dist
COPY --from=build /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /workspace/apps/worker/dist ./apps/worker/dist
WORKDIR /workspace/apps/worker
CMD ["node", "dist/main.js"]
