# syntax=docker/dockerfile:1
# Image de l'API en trois étapes : on construit avec tous les outils, on ne livre que le nécessaire.
# Contexte de build : la racine du dépôt (voir docker-compose.yml).

# --- Étape 1 : construction (dépendances de développement, compilation TypeScript) ---
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# La version de pnpm est celle du champ « packageManager » de package.json.
RUN corepack enable
WORKDIR /repo

# Les manifestes d'abord : tant qu'ils ne changent pas, l'installation reste en cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
# --ignore-scripts : aucun script d'installation de dépendance ne s'exécute pendant le build.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/api apps/api
# Dossier autonome /out : le code compilé + les seules dépendances de production.
RUN pnpm --filter @airpost/api build \
    && pnpm --filter @airpost/api deploy --legacy --prod --ignore-scripts /out \
    && cp -r apps/api/dist /out/dist

# --- Étape 2 : image d'exécution ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Dans un conteneur, « 127.0.0.1 » est invisible depuis l'extérieur : on écoute sur toutes les
# interfaces du conteneur. C'est docker-compose.yml qui limite l'accès à la machine locale.
ENV API_HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Utilisateur « node » (non-root) fourni par l'image : une faille dans l'API n'est pas root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
