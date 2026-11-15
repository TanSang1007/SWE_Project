FROM node:24-bookworm-slim AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL
ARG API_INTERNAL_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_INTERNAL_BASE_URL=$API_INTERNAL_BASE_URL

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci && npm install --no-save lightningcss-linux-x64-gnu@1.32.0 @tailwindcss/oxide-linux-x64-gnu@4.3.3

COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/frontend ./frontend

WORKDIR /app/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
