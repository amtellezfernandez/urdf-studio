# syntax=docker/dockerfile:1
# DEPS
FROM node:22-slim AS deps
WORKDIR /app

# Install dependencies separately for better caching
COPY package*.json ./
RUN npm ci

# BUILD
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . ./

RUN npm run build

# RUNNER
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run sets PORT; default to 8080 for local
ENV PORT=8080

# Install only production deps in the final image
RUN npm ci --omit=dev

EXPOSE 8080
CMD ["npm", "run", "start"]
