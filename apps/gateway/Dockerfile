FROM node:22-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy package manifests for all workspace packages (for layer caching)
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/gateway/package.json ./apps/gateway/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/types/ ./packages/types/
COPY packages/config/ ./packages/config/
COPY packages/db/ ./packages/db/
COPY apps/gateway/ ./apps/gateway/

# Build
RUN pnpm --filter @affiliate/types build
RUN pnpm --filter @affiliate/config build
RUN pnpm --filter @affiliate/db build
RUN pnpm --filter @affiliate/gateway build

EXPOSE 8080
CMD ["node", "apps/gateway/dist/index.js"]
