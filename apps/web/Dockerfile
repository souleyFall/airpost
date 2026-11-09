# syntax=docker/dockerfile:1
# Image de l'interface : on construit avec Node, on ne livre que des fichiers statiques servis par nginx.
# Contexte de build : la racine du dépôt (voir docker-compose.yml).

# --- Étape 1 : construction ---
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
# --ignore-scripts : aucun script d'installation de dépendance ne s'exécute pendant le build.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @airpost/web...

COPY apps/web apps/web
RUN pnpm --filter @airpost/web build

# --- Étape 2 : serveur web ---
# Variante « unprivileged » : nginx tourne sans être root et écoute sur 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
