# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --no-audit --no-fund
COPY . .

FROM base AS backend
RUN DIRECT_URL=postgresql://build:build@localhost/brewlite_dev npm run build --workspace backend
ENV NODE_ENV=development
USER node
EXPOSE 3001 3102
CMD ["node", "docker/backend.cjs"]

FROM base AS frontend
RUN node docker/install-native.cjs
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_INTERNAL_BASE_URL=http://backend:3001
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace frontend -- --webpack
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "frontend", "--hostname", "0.0.0.0", "--port", "3000"]
