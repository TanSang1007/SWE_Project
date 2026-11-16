FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

COPY backend ./backend
ARG DIRECT_URL="postgresql://build:build@localhost:5432/brewlite_dev"
ARG DATABASE_URL="postgresql://build:build@localhost:5432/brewlite_dev"
ENV DIRECT_URL=$DIRECT_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npm run build --workspace backend

FROM node:24-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV HOST=0.0.0.0

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/main.js"]
