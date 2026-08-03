# Multi-Stage: dev (Vite-Dev-Server, Compose-Default) | prod (Caddy: TLS + SPA + /api-Proxy)

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Dev-Server (compose service "frontend", target: dev) ---
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- Produktions-Build ---
FROM deps AS build
COPY . .
# Im Prod-Setup serviert Caddy Frontend und API same-origin unter /api.
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# --- Prod: Caddy serviert die SPA und proxied /api -> backend (ADR-0009) ---
FROM caddy:2-alpine AS prod
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
