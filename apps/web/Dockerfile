# syntax=docker/dockerfile:1
# Image de l'interface : on construit avec Node, on ne livre que des fichiers statiques servis par nginx.
# Contexte de build : la racine du dépôt (voir docker-compose.yml).

# --- Étape 1 : construction ---
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
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
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
