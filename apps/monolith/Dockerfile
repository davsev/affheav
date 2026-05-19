FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/monolith/package.json ./apps/monolith/

RUN pnpm install --frozen-lockfile

# Copy all source (packages + legacy monolith files at root)
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
