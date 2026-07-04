# ---- Build stage: install all deps (incl. dev) and compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps only + compiled output ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# SQLite file lives here — mount a volume on this path to persist data
# across container restarts/recreations (see docker-compose.yml).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
ENV PORT=3000
ENV DB_PATH=/app/data/economy.db

# --experimental-sqlite is required because the service uses Node's
# built-in node:sqlite module (see src/db.ts).
CMD ["node", "--experimental-sqlite", "dist/index.js"]