# ── Build stage: compile the React/Vite client under the /splendor base path ──
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG BASE_PATH=/splendor
RUN BASE_PATH="$BASE_PATH" npm run build

# ── Runtime stage: serve the authoritative TS server with tsx ─────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    BASE_PATH=/splendor
# node_modules (incl. tsx) and the built client come from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json tsconfig.json ./
COPY server ./server
COPY shared ./shared
EXPOSE 3001
CMD ["npm", "start"]
