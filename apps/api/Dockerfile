FROM node:22.22.2-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/opportunity-lifecycle/package.json packages/opportunity-lifecycle/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter api... 2>/dev/null || pnpm install --filter api...

FROM deps AS build
COPY . .
RUN pnpm --filter @platform/types run build
RUN pnpm --filter @platform/config run build
RUN pnpm --filter @platform/domain run build
RUN pnpm --filter @platform/opportunity-lifecycle run build
RUN pnpm --filter api run prisma:generate
RUN pnpm --filter api run build

FROM node:22.22.2-slim AS runtime
ENV NODE_ENV=production
ENV TZ=UTC
RUN corepack enable
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/packages/types/package.json ./packages/types/package.json
COPY --from=build /workspace/packages/types/dist ./packages/types/dist
COPY --from=build /workspace/packages/config/package.json ./packages/config/package.json
COPY --from=build /workspace/packages/config/dist ./packages/config/dist
COPY --from=build /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build /workspace/packages/opportunity-lifecycle/package.json ./packages/opportunity-lifecycle/package.json
COPY --from=build /workspace/packages/opportunity-lifecycle/dist ./packages/opportunity-lifecycle/dist
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
WORKDIR /workspace/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
