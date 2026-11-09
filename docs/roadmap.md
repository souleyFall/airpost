# Feuille de route

Une ligne par pull request prévue. L'ordre peut évoluer ; l'état est mis à jour à chaque fusion.

| #   | PR                                                                                               | État      |
| --- | ------------------------------------------------------------------------------------------------ | --------- |
| 1   | `feat(api)` : champ version et route `/health/ping`                                              | fusionnée |
| 2   | `chore` : outillage qualité (lint, formatage, tests, CI, Dependabot)                             | fusionnée |
| 3   | `chore` : hook Git `pre-push` (remplace la CI tant que le compte GitHub est verrouillé)          | fusionnée |
| 4   | `feat(security)` : en-têtes de sécurité, limitation de débit, CORS strict, configuration validée | fusionnée |
| 5   | `docs(security)` : registre des risques, registre RGPD, `SECURITY.md`                            | fusionnée |
| 6   | `chore(docker)` : image de l'API (multi-étapes, utilisateur non-root), `docker compose` complet  | fusionnée |
| 7   | `feat(db)` : Prisma, schéma, migrations, données de démonstration                                | fusionnée |
| 8   | `feat(auth)` : connexion mono-utilisateur (mot de passe haché, session sécurisée)                | fusionnée |
| 9   | `feat(profile)` : profil du candidat validé par un schéma                                        | fusionnée |
| 10  | `feat(sources)` : connecteur La Bonne Alternance                                                 | fusionnée |
| 11  | `feat(sources)` : connecteurs La Bonne Boîte et Adzuna                                           | ouverte   |
| 12  | `feat(pipeline)` : collecte, dédoublonnage, tâche planifiée                                      | à faire   |
| 13  | `feat(scoring)` : grille de score sur 100                                                        | à faire   |
| 14  | `feat(llm)` : service Gemini (réponses validées, cache, minimisation des données envoyées)       | à faire   |
| 15  | `feat(generation)` : lettres, objets et garde-fous                                               | à faire   |
| 16  | `feat(applications)` : cycle de vie des candidatures et validation                               | à faire   |
| 17  | `feat(web)` : socle React, tokens du design, page de connexion                                   | à faire   |
| 18  | `feat(web)` : écran « À valider »                                                                | à faire   |
| 19  | `feat(web)` : écrans « Suivi » et « Sources »                                                    | à faire   |
| 20  | `feat(gmail)` : autorisation OAuth et brouillons                                                 | à faire   |
| 21  | `feat(gmail)` : suivi et classement des réponses                                                 | à faire   |
| 22  | `feat(pwa)` : installation, icônes du logo, version mobile                                       | à faire   |
| 23  | `chore(docker)` : image de l'interface et déploiement complet                                    | à faire   |
| 24  | `chore(security)` : audit final et durcissement                                                  | à faire   |
