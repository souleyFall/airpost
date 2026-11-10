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
