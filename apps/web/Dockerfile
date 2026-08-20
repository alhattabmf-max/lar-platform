FROM node:22.22.2-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web... 2>/dev/null || pnpm install --filter web...

FROM deps AS build
COPY . .
RUN pnpm --filter @platform/types run build
RUN pnpm --filter web run build

FROM node:22.22.2-slim AS runtime
ENV NODE_ENV=production
ENV TZ=UTC
RUN corepack enable
WORKDIR /workspace
COPY --from=build /workspace ./
WORKDIR /workspace/apps/web
EXPOSE 3001
CMD ["node_modules/.bin/next", "start", "-p", "3001"]
