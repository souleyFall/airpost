# airpost

Outil personnel de recherche d'alternance : il collecte des offres par les API officielles (La Bonne Alternance, La Bonne Boîte, Adzuna) par Google Jobs et Glassdoor via SerpApi (Google Jobs reprend des annonces de plusieurs sites) et par les alertes e-mail d'Indeed lues dans ta boîte Gmail, les note, prépare une lettre sur mesure avec Gemini (garde-fous contre les inventions), te la fait relire et valider, crée un **brouillon Gmail** (jamais d'envoi automatique) et suit les réponses.

Aucun scraping de LinkedIn, Indeed ou Welcome to the Jungle.

## Lancer

Prérequis : Docker Desktop, Node 24, pnpm.

```bash
cp .env.example .env      # puis remplir les clés (jamais commitées)
docker compose up -d --build
docker compose run --rm migrate
pnpm --filter @airpost/api user:create <identifiant>
```

L'application est sur http://localhost:8080. Le premier lancement demande aussi de renseigner ton profil (`PUT /profile`).

Les fichiers `credentials.json` et `token.json` (autorisation Gmail) restent à la racine, hors de Git ; sans eux, tout fonctionne sauf les brouillons et le suivi des réponses.

## Développer

```bash
pnpm install
pnpm check        # lint, format, types, tests, build
pnpm test:db      # tests d'intégration sur une base jetable
pnpm db:backup    # sauvegarde de la base dans backups/ (ignoré par Git)
```

## Pour aller plus loin

- Décisions : [docs/decisions.md](docs/decisions.md)
- Sécurité : [SECURITY.md](SECURITY.md) et [registre des risques](docs/securite/registre-risques.md)
- RGPD : [registre des traitements](docs/rgpd/registre-traitements.md)
- Feuille de route : [docs/roadmap.md](docs/roadmap.md)

## Démo publique

Une version de l'interface sans serveur (données fictives, textes préparés) peut être publiée pour la présentation :

```bash
pnpm --filter @airpost/web build:demo
```

Le dossier `apps/web/dist-demo` contient des fichiers statiques à héberger à part de l'application réelle (le fichier `_headers` interdit toute requête réseau). Voir `docs/decisions.md`, D42.

## Page d'accueil et site public

La page d'accueil (`apps/landing`, HTML et CSS seulement) et la démo s'assemblent en un seul dossier à héberger :

```bash
pnpm build:site -- --video chemin/airpost.mp4 --poster chemin/poster.jpg
pnpm check:site
```

Le dossier `site/` contient la page, la démo (`/demo/`), la vidéo et les en-têtes de sécurité (`_headers`). Voir `docs/decisions.md`, D43.
