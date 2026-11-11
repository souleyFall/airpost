# Décisions techniques

Chaque décision est numérotée. Une décision remplacée n'est pas supprimée : on l'annote.

## D1. Monorepo pnpm

Un seul dépôt, des sous-projets dans `apps/` (API, interface) et `packages/` (code partagé). Les types et les schémas de validation sont ainsi partagés entre l'API et l'interface.

## D2. NestJS, Prisma, PostgreSQL

NestJS impose une structure par modules et l'injection de dépendances, ce qui garde un projet de cette taille lisible. Prisma fournit un schéma typé et des migrations. PostgreSQL gère bien le JSON (détail des scores, analyses) et l'hébergement futur.

## D3. Tests : Vitest avec le plugin SWC

Un seul outil pour l'API et l'interface. Vitest compile avec esbuild, qui n'émet pas les métadonnées de décorateurs nécessaires à l'injection de dépendances : le plugin SWC s'en charge. Les tests unitaires s'appellent `*.spec.ts`, les tests d'intégration (HTTP complet) `*.e2e-spec.ts`, à côté du code testé.

## D4. Flux de travail

Une branche et une pull request par sujet, nommées `feat/...`, `fix/...`, `chore/...`. Fusion en « squash » : un commit par PR sur `main`. Chaque PR est relue (revue écrite dans la PR), et la CI doit être verte avant fusion.

## D5. Qualité automatique

ESLint avec règles typées, Prettier, vérification des types, tests, compilation. Les mêmes contrôles tournent en local (`pnpm check`) et dans la CI.

## D6. Fins de ligne

LF partout (`.gitattributes`, `.editorconfig`), pour éviter le bruit des différences entre Windows et Linux.

## D7. TypeScript fixé en 5.9

Version fixée pour éviter qu'une montée de version majeure ne casse la configuration. À réévaluer volontairement.

## D8. Scripts d'installation des dépendances

pnpm 10 bloque par défaut les scripts d'installation des paquets. On n'en autorise aucun tant qu'un paquet n'en a pas réellement besoin, et chaque autorisation est notée ici. À ce jour : aucune.

## D9. Le cours personnel reste local

`docs/cours/` est exclu de Git et n'est jamais poussé sur GitHub.

## D10. Actions GitHub figées par empreinte

Les actions de la CI sont référencées par l'empreinte (SHA) de leur commit, avec la version en commentaire, et non par une étiquette mobile. Une étiquette peut être déplacée vers du code malveillant ; une empreinte, non. Dependabot propose les mises à jour. Le jeton de la CI est en lecture seule et n'est pas conservé après le `checkout` (`persist-credentials: false`).

## D11. Audit des dépendances planifié

L'audit de production tourne à chaque PR et chaque lundi (tâche planifiée), pour détecter une faille publiée après la dernière PR. Il ne réinstalle pas les dépendances : il lit seulement le fichier de verrouillage.

## D12. Encodage des fichiers

UTF-8 **sans BOM**. Sous Windows PowerShell 5.1, `Set-Content -Encoding utf8` ajoute un BOM ; on utilise l'outil d'écriture de l'éditeur, ou `[IO.File]::WriteAllText` avec `UTF8Encoding($false)`. Un BOM dans un JSON fait échouer `JSON.parse`.

Autre piège du même genre : dans une chaîne PowerShell entre guillemets doubles, l'accent grave et `$` sont interprétés. Pour écrire du texte brut, on utilise des guillemets simples ou l'outil d'écriture.

## D13. Garde-fou local en attendant la CI

Le compte GitHub est verrouillé pour un problème de facturation : les tâches de `.github/workflows/ci.yml` sont refusées au démarrage. En attendant, un hook `pre-push` (`.githooks/pre-push`) lance `pnpm check` avant tout envoi vers GitHub. `pnpm install` l'active (`scripts/install-hooks.mjs`, via le script `prepare`).

Limites connues : le hook contrôle l'arbre de travail et non le commit poussé ; `git push --no-verify` le contourne ; il n'y a ni audit planifié ni recherche de secrets automatique (GitGuardian reste actif côté GitHub). Le workflow `ci.yml` est conservé : il reprendra du service quand la facturation sera réglée.

## D14. Configuration validée au démarrage

Les variables d'environnement sont validées par un schéma Zod (`apps/api/src/config/env.ts`) avant tout le reste. Une valeur invalide fait échouer le démarrage avec la liste des variables en cause, **sans jamais afficher la valeur reçue** (une variable mal saisie peut être un secret). Les variables absentes du schéma sont ignorées et jamais recopiées. Les valeurs par défaut sont les plus restrictives : écoute sur `127.0.0.1`, CORS désactivé.

En développement, le `.env` est chargé par `process.loadEnvFile` (natif dans Node 24, aucune dépendance) ; jamais en production, où l'environnement fournit les variables. Piège évité : `new URL()` lève une erreur native qui contient la valeur saisie, d'où `URL.canParse` en amont.

## D16. Image Docker de l'API

- **Trois étapes** : construction (tous les outils), `pnpm deploy --prod` (code compilé + dépendances de production seulement), exécution (`node:24-slim`). Aucun compilateur ni dépendance de développement dans l'image finale.
- **Utilisateur `node` (non-root)**, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`.
- **`--ignore-scripts`** à l'installation et au déploiement : aucun script de dépendance ne s'exécute pendant le build (et le script `prepare` de la racine, qui installe les hooks Git, n'a pas de sens dans l'image).
- **`.dockerignore`** : `.env`, `credentials.json`, `token.json`, `.git`, `docs/cours` n'entrent jamais dans le contexte de build.
- **Écoute** : `API_HOST=0.0.0.0` dans le conteneur (sinon inaccessible), mais le port n'est publié que sur `127.0.0.1` de la machine.
- Le service `api` ne reçoit que les variables qu'il utilise, pas tout le `.env`.
- Vérifié : image de ~246 Mo, uid 1000, healthcheck vert, aucun fichier secret, valeur invalide jamais affichée.
- Reste à faire : épingler l'image de base par empreinte (digest) avec Dependabot (PR n°24), et le proxy de confiance avec le déploiement (R8).

## D26. Candidatures, export et effacement

- **Cycle de vie défini une fois** ( ransitions.ts, testé en entier) : à valider ⇄ validée → brouillon Gmail → postulée → accusé → entretien, avec refus et retrait définitifs. Pas de « postulée » sans validation, pas d'entretien avant d'avoir postulé, pas de retour en arrière après l'envoi. **« Brouillon créé » est réservé au module Gmail** : l'utilisateur ne peut pas prétendre qu'un brouillon existe (409).
- **Aucune écriture sans condition** : les changements de statut et les modifications passent par updateMany conditionné au statut lu. Deux requêtes concurrentes ne peuvent pas toutes les deux réussir (la seconde reçoit 409, testé) ; une candidature validée n'est jamais modifiée.
- **Valider exige un objet et un texte** (422 sinon) : ce qui part doit avoir été relu. L'objet est remis sur une seule ligne à chaque modification (en-tête de message).
- **Lecture** : GET /applications (résumé de l'offre, sans description ni texte), filtre par statut, GET /applications/:id (lettre, offre complète, réponses). Écritures : PATCH (objet, texte), POST /:id/status, DELETE, toutes avec CSRF, champs inconnus refusés, tailles bornées.
- **Suppression d'une candidature (RGPD)** : candidature et réponses supprimées, **contact du recruteur retiré de l'offre** (il n'était conservé que pour elle) ; l'offre publique reste jusqu'à sa purge.
- **Export** (GET /account/export, accès et portabilité) : profil, candidatures avec lettres, offres liées et réponses, en pièce jointe JSON non mise en cache ; **jamais** l'empreinte du mot de passe, les jetons de session ni le jeton CSRF (testé sur le contenu).
- **Effacement** (POST /account/erase) : compte, profil, sessions, offres, candidatures et réponses, en une transaction. **Mot de passe exigé** (une session volée ne suffit pas à tout détruire), 3 essais par minute, cookie effacé ; la session ne sert plus ensuite. Pour retrouver un compte, relancer user:create.

## D25. Génération des lettres et garde-fous

- **POST /offers/:id/letter** (session et CSRF, 5 par minute) : profil + offre → lettre (objet, corps, citations utilisées) → garde-fous → brouillon enregistré dans Application (statut « à valider »). Une candidature **déjà validée n'est jamais régénérée** (409, le modèle n'est pas appelé). La réponse contient le corps généré, des avertissements et un aperçu de la lettre complète.
- **Rien d'identifiant ne part au modèle** : le prompt reçoit le profil sans identité (profileForPrompt) et l'offre nettoyée et encadrée. **Signature, formule de politesse, e-mail et téléphone sont ajoutés localement** (ssembleLetter) ; le modèle a l'interdiction d'en écrire, et un garde-fou rejette toute coordonnée dans sa sortie.
- **Garde-fous** (fonctions pures, testées une à une), appliqués avant que l'utilisateur ne voie quoi que ce soit : longueur 120 à 350 mots ; aucun texte à compléter ([...], {{, <...>) ; aucune coordonnée ni lien ; aucune mention « en tant qu'IA » ; **aucun nombre absent du profil et de l'offre** (un « 5 ans d'expérience » ou un « 40 % » inventé est le défaut le plus grave) ; **ancrage** : le modèle doit citer, mot pour mot, 2 à 6 éléments du profil sur lesquels repose la lettre, et chaque citation est retrouvée dans le profil (une compétence ou un élément de disponibilité est une citation valable même courte, sinon 8 caractères au moins).
- **Une seule nouvelle tentative** : le rappel dit ce qui est refusé (« n'écris aucun chiffre hors profil ») **sans recopier le texte fautif**. Deux refus : 422 avec les motifs, rien d'enregistré, rien du texte généré dans la réponse.
- **Avertissements, pas refus** : une technologie connue citée dans la lettre mais absente du profil (« je souhaite découvrir Kubernetes » est honnête) est signalée pour la relecture.
- **Erreurs du modèle traduites** : clé absente ou modèle indisponible 503, quota 429, autre 502 ; jamais de détail ni de secret.
- **Essai réel** (profil fictif, offre piégée avec « IGNORE TES INSTRUCTIONS », e-mail et téléphone) : la première lettre a été refusée par l'ancrage (citations non conformes), la seconde acceptée : 132 mots, aucun chiffre inventé, avertissement « Kubernetes », signature ajoutée localement. Cet essai a conduit à accepter les compétences courtes et la disponibilité comme citations.
- **Relecture humaine obligatoire** : aucune lettre n'est envoyée ni transformée en brouillon Gmail sans validation (PR n°16 et n°20).

## D24. Service de modèle de langage (Gemini)

- **Fournisseur interchangeable** : le reste de l'application ne connaît que LlmService.generateObject et le contrat LlmProvider ; Gemini (GeminiProvider, API REST) est une implémentation. Modèle par défaut gemini-3.5-flash-lite (GEMINI_MODEL, validé par une liste blanche de caractères car il entre dans le chemin de l'URL). **Le .env de l'auteur contient encore GEMINI_MODEL=gemini-2.5-flash, retiré par Google (404) : à corriger.**
- **Clé en en-tête** (x-goog-api-key), jamais dans l'URL ; aucun message d'erreur ne contient la clé, le prompt ni le texte généré (testé, réseau coupé compris). Sans clé, le service refuse de s'appeler.
- **Particularités vérifiées sur la vraie API** : une clé invalide renvoie **400** avec la raison structurée API_KEY_INVALID (et non 401) ; un modèle retiré renvoie 404 ; une sortie coupée est signalée par inishReason: MAX_TOKENS (traitée comme une erreur plutôt que de parser un JSON tronqué) ; une demande bloquée par les filtres arrive par promptFeedback.blockReason.
- **Sortie validée** : JSON demandé (
  esponseMimeType), validé par un schéma Zod ; en cas d'échec, **une seule** nouvelle demande avec un rappel du format, puis erreur sans recopier le contenu. Les erreurs du fournisseur (quota, clé) ne sont pas redemandées.
- **Mémoire des réponses** : 6 heures, 100 entrées au plus, clé = empreinte SHA-256 du modèle, des consignes, du contenu et de la température ; deux demandes identiques simultanées = un seul appel (quotas gratuits serrés). Les échecs ne sont jamais gardés. Journaux : nombre de jetons seulement.
- **Minimisation (RGPD)** (
  edact.ts) : e-mails, téléphones (formats français et internationaux) et liens sont remplacés ([e-mail], [téléphone], [lien]) dans tout ce qui part ; profileForPrompt n'emporte **jamais** l'identité (nom, e-mail, téléphone, ville, code postal, site), qui est ajoutée localement au texte généré.
- **Limite connue de la minimisation** : seuls e-mails, téléphones et liens sont détectés. Un nom propre ou une adresse postale écrits dans le texte d'une offre ne le sont pas (aucun filtre fiable sans modèle de reconnaissance d'entités) ; le contenu des offres est public, mais la relecture reste utile. Le profil, lui, est exclu par construction (profileForPrompt ne contient pas l'identité).
- **Résultats mis en mémoire renvoyés en copie** (structuredClone) : un appelant qui ajoute les coordonnées du candidat au texte généré ne les glisse pas dans la mémoire. Les parties de « réflexion » ( hought) du modèle sont ignorées. HTTP_FETCH vit dans un module global (HttpModule), partagé par les sources, le géocodage et le modèle.
- **Texte d'un tiers = donnée, pas consigne** : l'offre est encadrée (untrusted), l'encadré ne peut pas être refermé par le texte lui-même, la consigne système (UNTRUSTED_NOTICE) le rappelle. Ce n'est pas une garantie ; les vraies protections sont la sortie validée par schéma, l'absence d'action déclenchée par le modèle et la relecture humaine avant tout envoi. Essai réel : une offre contenant « IGNORE TOUTES TES INSTRUCTIONS » a été analysée normalement.
- **Faille trouvée par un test** : l'expression régulière des e-mails, non bornée, devenait quadratique (7 s pour 50 000 caractères sans arobase) : une offre d'emploi malveillante pouvait bloquer l'API. Longueurs bornées partout, texte coupé avant le nettoyage (et au dernier espace, pour ne pas laisser un morceau d'adresse).

## D23. Scoring des offres

- **Grille sur 100** (fraîcheur 25, pile technique 25, rythme 15, trajet 15, concurrence 10, canal 10), en **fonctions pures** (scoring.ts) : mêmes entrées, même score ; chaque critère se teste seul et chaque score garde son détail (scoreDetail, JSON) pour que l'interface explique « pourquoi 74 ? ». Les seuils sont des **réglages initiaux** à ajuster à l'usage.
- **Fraîcheur** : ≤ 3 j 25, ≤ 7 j 20, ≤ 14 j 15, ≤ 30 j 8, au-delà 3 (date de publication, sinon première apparition).
- **Pile** : part des 4 premiers termes du profil (mots-clés + langages + frameworks + outils) retrouvés **en mots entiers** dans l'intitulé et la description (« go » ne matche pas « mongo »). 4 termes = 25 points.
- **Rythme** : repéré dans le texte (« 2 jours / 3 jours », « 1 semaine / 1 semaine »...). Conforme au profil 15, incompatible 2, **inconnu 8 (neutre)** : beaucoup d'offres n'en parlent pas, on ne les pénalise pas.
- **Trajet** : distance à vol d'oiseau (haversine) × 2 min/km (30 km/h, comme le rayon de recherche) ; plein tarif sous la moitié du temps accepté, dégressif de 15 à 5 jusqu'au maximum, 0 au-delà, **7 si l'offre n'est pas localisée**.
- **Concurrence** : le nombre de candidats n'est publié nulle part ; estimée par la source (candidature spontanée 8 > portail officiel 5 > agrégateur 3). Approximation assumée.
- **Canal** : e-mail direct avec adresse 10, lien de candidature 6, sinon 2.
- **Recalcul complet à chaque collecte** (la fraîcheur dépend du temps, le profil peut changer), par lots de 200 ; un échec du scoring ne fait pas perdre la collecte.
- **Lecture** : GET /offers (score décroissant, non notées à la fin, sans la description, filtre minScore, pagination bornée) et GET /offers/:id (identifiant UUID validé). Lecture seule, session obligatoire.

## D22. Pipeline de collecte

- **Une collecte** (CollectionService.run) : profil → code postal géocodé (service public de l'État, data.geopf.fr, **seul le code postal** quitte le serveur) → rayon déduit du trajet accepté (30 km/h : 60 min = 30 km, borné de 5 à 100 km) → trois sources l'une après l'autre (LBA, Adzuna, puis La Bonne Boîte) → exclusions du profil → dédoublonnage → enregistrement → purge. Chaque source a son bilan (ok, disabled si la clé manque, error avec une raison sans détail technique) ; **une source en panne ne bloque pas les autres**.
- **Doublons entre sources** : France Travail alimente La Bonne Alternance et Adzuna, la même annonce circule. L'empreinte entreprise + intitulé + ville la repère ; la première source dans l'ordre (annonces avant candidatures spontanées) ou déjà en base l'emporte. Une offre d'entreprise inconnue n'est **jamais** jugée doublon (comparaison impossible, risque de fusionner deux offres différentes). Deux offres de la même source ne sont pas fusionnées.
- **Une seule collecte à la fois** (409 sinon) : les API ont des quotas serrés (Adzuna ≈ 250 appels/jour, La Bonne Boîte répond 429 si l'on enchaîne). POST /collection/run est limité à 3 par minute et exige session et CSRF ; GET /collection/last donne le dernier bilan.
- **Planification** : un minuteur (COLLECT_EVERY_HOURS, **0 = désactivé par défaut** : aucun appel externe sans demande explicite), première collecte une minute après le démarrage, minuteurs non bloquants pour l'arrêt, toute erreur absorbée (seul le nom de l'erreur est journalisé). Pas de bibliothèque de planification pour une seule tâche.
- **Conservation (RGPD)** : après chaque collecte, les offres vues pour la première fois il y a plus de OFFER_RETENTION_DAYS (90 par défaut, 7 à 365) **et sans candidature** sont supprimées. Une offre qui a une candidature n'est jamais purgée : elle fait partie du suivi et partira avec sa candidature.
- **Journaux** : des comptes seulement (créées, mises à jour, purgées), jamais de titre, d'entreprise ni de message d'erreur d'origine.

## D21. Connecteurs La Bonne Boîte et Adzuna

- **La Bonne Boîte v2 (France Travail)** : ce ne sont pas des annonces mais des **entreprises qui recrutent souvent** (potentiel d'embauche). Chaque résultat devient une « candidature spontanée » (source = LBB, identifiant = SIRET, titre « Candidature spontanée : <activité> »), avec un lien vers la fiche labonneboite.francetravail.fr/entreprise/<siret> (200 vérifié ; SIRET validé à 14 chiffres avant d'entrer dans l'URL). L'API n'indique que « un e-mail existe » (yes), jamais l'adresse : canal « site », aucun contact enregistré. OAuth2 « client credentials » (scope pi_labonneboitev2 search), jeton gardé en mémoire jusqu'à 60 s avant son expiration, un seul appel de jeton même si deux recherches se croisent, jeton oublié après un 401. Pagination : 100 maximum par page (200 donne 422). Un appel par code ROME, l'un après l'autre : l'API répond 429 dès qu'on enchaîne trop vite.
- **Adzuna** : vraies annonces (what = alternance, what_or = mots-clés du profil, lieu et rayon, tri par date, 50 par page). La clé voyage **dans l'URL** (méthode de l'API) : aucune erreur ni journal ne reprend l'URL (testé). Offres sans code postal. Formule gratuite limitée (≈ 25 appels/min, 250/jour). Les conditions d'Adzuna demandent d'afficher « Jobs by Adzuna » près des annonces : à faire dans l'interface (PR n°15 à n°17). what_or ramène large (268 résultats pour Paris) : c'est le scoring qui triera.
- **Communs aux trois sources** (
  ormalize.ts) : textes bornés, URL http(s) seulement,
  edirect: 'error' (aucun secret ne suit une redirection), délai de 10 s, entrées illisibles comptées, requêtes absurdes refusées avant l'appel, erreurs sans secret ni corps de réponse. Clés facultatives dans la configuration : une source sans clé reste désactivée.
- **Doublons entre sources** : les mêmes annonces circulent (France Travail est partenaire de La Bonne Alternance et d'Adzuna) ; dedupKey les rapprochera dans le pipeline (PR n°12).

## D20. Connecteur La Bonne Alternance et enregistrement des offres

- **Format commun** (NormalizedOffer) pour toutes les sources, puis OffersService.saveMany : upsert par (source, externalId), le score et la candidature ne sont jamais écrasés, irstSeenAt est conservé, lastSeenAt rafraîchi, empreinte de dédoublonnage (dedupKey, partagée avec le seed) recalculée.
- **Forme de la réponse vérifiée sur la vraie API** (13 offres pour M1805 près de Paris, 450 sans filtre) : jobs[].identifier.id, workplace (nom, marque, raison sociale souvent absents : repli sur « Entreprise non indiquée »), workplace.location.address + geopoint GeoJSON [longitude, latitude], offer (titre, description, statut, dates), pply.url. Plusieurs codes ROME : séparés par une virgule ; un paramètre répété donne 400. Clé absente ou fausse : 401.
- **Tolérance** : le schéma Zod ne lit que ce qui sert ; une entrée illisible est comptée (skipped), jamais fatale ; les offres expirées ou non actives sont écartées.
- **Canal** : La Bonne Alternance ne publie ni e-mail ni téléphone de recruteur, donc toutes ses offres sont en canal « site » (l'utilisateur postule lui-même). Les « recruteurs » sans offre (candidatures spontanées) sont ignorés pour l'instant.
- **Sécurité** : clé lue dans LBA_API_KEY (facultative ; sans elle le connecteur refuse de s'appeler, sans réseau), envoyée en en-tête Authorization, jamais dans l'URL, jamais dans une erreur (testé pour 401, 429, 500 et réseau coupé). Délai maximal de 10 s. Seules les URL http(s) sont conservées (javascript: écarté). etch est injecté : tests sans réseau.
- **Limite de débit** (60 appels/min) : respectée par le pipeline de collecte (PR n°12), qui fera peu d'appels ; pas de file d'attente dans le connecteur.

## D19. Profil du candidat

- **Schéma Zod strict** (profile.schema.ts) : identité, titre, résumé, formations, expériences avec réalisations (méthode XYZ), compétences, critères de recherche (rythmes, démarrage « asap » ou date, trajet maximal, mots-clés, codes ROME, entreprises exclues). Un champ inconnu est refusé, toutes les tailles sont bornées : le profil part vers un modèle de langage, on ne laisse pas grossir sans limite ce qui y est envoyé.
- **Minimisation** : ni adresse complète ni date de naissance. Ville et code postal suffisent ; le géocodage pour le trajet se fera à partir du code postal (PR du scoring). E-mail, téléphone et site sont facultatifs et n'apparaissent dans une lettre que s'ils sont renseignés. Le site doit être en https.
- **Une ligne Profile par utilisateur**, colonne JSON ; GET /profile (404 tant que vide) et PUT /profile (remplace tout : idempotent, pas de fusion partielle ; CSRF exigé). L'identifiant vient de la session, jamais du corps (un userId envoyé est refusé comme champ inconnu). Le profil est relu à travers le schéma à la lecture.
- **Le schéma reste dans pps/api** pour l'instant. Il sera extrait dans packages/shared quand l'interface web (PR n°15) devra le réutiliser pour valider ses formulaires.
- **Règle pour la génération des lettres (PR n°13)** : elle ne cite que ce qui figure dans ce profil (réalisations comprises), rien d'inventé.

## D18. Authentification mono-utilisateur

- **Privée par défaut** : un garde global (`AuthGuard`) exige une session sur toute route ; seules celles marquées `@Public()` (santé, connexion) y échappent. Oublier le décorateur ferme une porte, ne l'ouvre pas.
- **Sessions côté serveur**, pas de JWT : un jeton aléatoire de 256 bits dans un cookie, dont seule l'empreinte SHA-256 est en base (une fuite de la base ne permet pas de se connecter). On peut révoquer une session (déconnexion, changement de mot de passe) ; un JWT ne le permet pas sans liste noire. Durée de vie absolue de 7 jours ; nouveau jeton à chaque connexion (pas de fixation) ; sessions expirées purgées à chaque connexion.
- **Cookie** : `HttpOnly` (illisible par JavaScript, donc non volable par XSS), `SameSite=Strict`, `Path=/`, `Secure` en production avec le préfixe `__Host-` (non écrasable par un sous-domaine). `SESSION_COOKIE_SECURE=false` permet l'usage local en http (le compose le fixe par défaut : l'API n'est publiée que sur `127.0.0.1`) ; à passer à `true` dès qu'il y a HTTPS.
- **CSRF** : en plus de `SameSite=Strict`, chaque session a un jeton, renvoyé à la connexion et par `GET /auth/me`, exigé dans l'en-tête `X-CSRF-Token` sur toute requête qui modifie (comparaison en temps constant). L'interface le garde en mémoire, pas dans un stockage persistant. 401 avant 403 : un anonyme n'apprend rien sur le jeton.
- **Mot de passe** : argon2id (`@node-rs/argon2`, binaires précompilés, aucun script d'installation), paramètres OWASP (19 Mio, 2 passes). 12 caractères minimum à la création (longueur plutôt que complexité). Le compte se crée depuis la machine : `pnpm --filter @airpost/api user:create <identifiant>` (mot de passe saisi sans écho, jamais en argument ni en variable d'environnement). Pas d'inscription en ligne.
- **Connexion** : message identique pour un identifiant inconnu et un mot de passe faux, et temps équivalent (empreinte factice vérifiée quand l'utilisateur n'existe pas) ; 5 essais par minute et par IP (429) ; corps validé par Zod avec bornes hautes (pas d'argon2 sur 10 Mo) ; les erreurs de validation ne recopient jamais la valeur reçue.
- **Cookies lus à la main** (`readCookie`, testé) plutôt que par la bibliothèque `cookie`, publiée depuis quatre jours en ESM seul : une dépendance de moins pour douze lignes.
- **`ConfigModule` global** (jeton `ENV`) : la configuration est validée une fois et injectée partout (réponse au constat de la revue de la PR n°4).

## D17. Base de données : Prisma 7, schéma et tests

- **Prisma 7.10.1** (version stable ; le tag `latest` de npm pointe sur une 8.0 RC, écartée). Générateur `prisma-client` en sortie CommonJS dans `src/generated/prisma` (ignoré par Git, régénéré par `postinstall` et `build`). Connexion par l'adaptateur `@prisma/adapter-pg` : le pool `pg` ouvre la connexion à la première requête, l'API démarre même si la base tarde.
- **Identifiants UUID v7** (triés dans le temps, non devinables) ; pas d'identifiant auto-incrémenté qui révélerait le volume.
- **Schéma** : `User` (login + empreinte du mot de passe, sans e-mail), `Profile` (JSON validé par Zod), `Offer` (unicité `source` + `externalId`, clé de dédoublonnage, score), `Application` (une par offre, statut), `Reply` (extrait court de la réponse Gmail). Les suppressions se font **en cascade depuis l'offre** : effacer une offre efface la candidature, les réponses et le contact recruteur (droit à l'effacement).
- **`DATABASE_URL` obligatoire**, validée au démarrage ; elle contient le mot de passe et n'est jamais recopiée dans une erreur (un seul `refine` : plusieurs s'exécutent tous et le second appellerait `new URL()` sur une valeur invalide).
- **Tests d'intégration séparés** (`pnpm test:db`) : une base jetable `<base>_test` est recréée, les migrations y sont rejouées, puis elle est supprimée ; la base de développement n'est jamais touchée. Hors de `pnpm check` (qui reste exécutable sans Docker, donc dans le hook) ; à lancer avant de pousser un changement de schéma.
- **Migrations** : `pnpm --filter @airpost/api db:migrate` en développement ; `docker compose run --rm migrate` pour appliquer les migrations versionnées (service du profil `tools`, utilise l'étape de construction de l'image).
- **Seed** : trois offres fictives, rejouable, refusé en production.

## D15. Durcissement HTTP

- **Helmet** : en-têtes de sécurité (nosniff, anti-framing, HSTS, CSP) et suppression de `X-Powered-By`.
- **CORS** désactivé par défaut ; une seule origine autorisée (`WEB_ORIGIN`), jamais `*`, car l'API portera des cookies de session.
- **Limitation de débit** globale par adresse IP (`@nestjs/throttler`), 100 requêtes par minute par défaut. Derrière un reverse proxy, il faudra déclarer le proxy de confiance, sinon toutes les requêtes auront l'IP du proxy.
- La route publique `/health` n'expose plus la version.
- Les réglages communs sont dans `configureApp`, utilisée par `main.ts` **et** par les tests : on teste exactement ce qui tourne.

## D27. Interface web : socle

- **Même origine** : l'interface appelle l'API sous `/api` (proxy Vite en développement, reverse proxy en production). Le cookie de session `SameSite=Strict` fonctionne alors sans CORS.
- **Jeton CSRF en mémoire** uniquement (jamais `localStorage`) ; retrouvé au rechargement via `GET /auth/me`.
- **Polices servies par l'application** (`@fontsource`), pas Google Fonts : charger une police depuis Google enverrait l'adresse IP de l'utilisateur à un tiers.
- **Accent `#1E3FA8`** (celui de la maquette). Tous les jetons de couleur sont dans `apps/web/src/styles.css`, source unique.
- Pas de case « Rester connecté » ni de « Mot de passe oublié » : l'API ne les supporte pas et le compte se gère en ligne de commande ; un contrôle factice serait trompeur.

## D28. Déploiement de l'interface

- **nginx sans privilèges** sert les fichiers statiques et relaie `/api` vers l'API : une seule origine pour le navigateur (pas de CORS, cookie `SameSite=Strict` valable).
- **CSP stricte** posée par nginx (aucun script ni style en ligne, aucune ressource tierce) ; `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, pas de cache sur `/api`.
- **`TRUST_PROXY`** (API) : nombre de proxys de confiance. nginx _remplace_ `X-Forwarded-For` par l'adresse réelle ; sans cela la limite de débit de la connexion s'appliquerait à tout le monde à la fois. Avec une valeur > 0, le port de l'API ne doit pas être joignable depuis le réseau (en-tête falsifiable) : il n'est publié que sur 127.0.0.1.
- Application disponible sur `http://localhost:8080` après `docker compose up -d --build`.

## D29. Compatibilité calculée par l'IA, brief, filtres et pagination

- **Le score n'est plus une grille de règles.** `src/scoring` est supprimé : le taux de compatibilité (0-100) est calculé par Gemini à partir de toutes les données exploitables (profil, critères de recherche, texte de l'offre, contrat détecté, distance, ancienneté, source). Le prompt (`src/matching/match.prompt.ts`) décrit la méthode (pertinence du métier 40, contrat et calendrier 20, niveau 15, trajet 15, chances réelles 10), des plafonds absolus (hors métier 10, contrat incompatible 35, trajet dépassé 40, texte pauvre 50, candidature spontanée 60) et un calibrage sévère.
- **Un seul appel produit tout** : note, phrase d'explication, points forts, manques et brief de l'offre (entreprise, stack demandée, profil recherché, rythme). Le brief vient de l'annonce seule : « non précisé » plutôt qu'une invention.
- **Le code garde le dernier mot** sur ce qui doit rester cohérent : le verdict (« Excellente piste »...) est calculé à partir du score, une offre écartée est plafonnée à 35 quoi qu'écrive le modèle, une entrée mal numérotée est ignorée.
- **Quotas** : 4 offres par appel, 40 analyses au plus par collecte, arrêt au premier quota atteint. Une offre ouverte sans analyse est analysée à l'ouverture. L'analyse est refaite quand l'empreinte du profil et du prompt change (`profileHash`) ; le bouton « Réanalyser » force un nouvel avis (sans mémoire de réponse).
- **Données envoyées** : inchangées dans leur principe (`profileForPrompt`, texte d'offre sans coordonnées, aucune identité). La distance est calculée localement : la ville et le code postal ne partent jamais.
- **Filtre de pertinence dès la collecte** (`sources/relevance.ts`) : une offre sans rapport avec le développement (comptable, boulanger...) n'est pas enregistrée ni envoyée au modèle. Tri volontairement indulgent ; La Bonne Boîte n'est pas filtrée (déjà par code ROME à la source). Adzuna est interrogée trois fois (alternance, stage, développeur) pour que les filtres de contrat aient de quoi filtrer.
- **Liste** : filtres (source, contrat, canal, compatibilité minimale, distance maximale), recherche libre, tri (compatibilité, fraîcheur, distance) et pagination, tous côté serveur. Les jokers `%` et `_` de la recherche sont échappés.
- **Interface** : la liste et le détail défilent séparément (chacun son conteneur), le détail repart du haut à chaque changement d'offre et la barre d'actions reste collée en bas.
- Les anciens scores (grille) sont effacés par la migration : ils ne signifiaient plus rien.

### D29 (suite) : corrections après premier usage

- **Filtres de contrat à zéro** : la migration avait donné « non précisé » à toutes les offres existantes. Le type de contrat est maintenant déduit aussi de la source (La Bonne Alternance et La Bonne Boîte = alternance) et **corrigé à chaque collecte** pour les offres déjà en base (`OffersService.cleanup`). `pnpm --filter @airpost/api offers:clean` fait la même remise à niveau sans attendre.
- **Offres hors métier** : le filtre n'agissait que sur les nouvelles offres. La remise à niveau supprime aussi les offres déjà enregistrées qui ne passent plus le filtre (jamais celles qui ont une candidature, jamais celles des sources déjà filtrées par code ROME). Liste de mots hors sujet élargie (RH, communication, vente, audit, finance, crédit...).
- **Analyse dès l'affichage** : l'interface envoie les identifiants des offres affichées sans note à `POST /offers/analyze` (une page à la fois, 4 offres par appel au modèle), sans attendre l'ouverture du détail. Un quota atteint laisse les offres sans note, sans boucle de nouvelles demandes.
- **Déploiement** : après une PR avec migration, `docker compose up -d --build` ne reconstruit pas le service `migrate` ; faire `docker compose build migrate` puis `docker compose run --rm migrate`.

### D29 (suite 2) : offres écartées par l'IA

- Une offre que l'IA juge hors cible (hors métier, contrat incompatible) est **masquée du fil « À valider »**, pas supprimée : supprimée, elle serait réimportée puis réanalysée à chaque collecte (quota du modèle). Colonne `excluded`, recalculée à chaque analyse (un profil modifié peut la remettre dans le fil).
- Exception : une offre écartée sur laquelle une candidature existe déjà reste visible (le travail commencé ne disparaît pas).
- Les offres moins bien notées mais pas écartées (verdict « peu adaptée ») restent dans le fil ; le filtre de compatibilité minimale les masque au besoin.

### D29 (suite 3) : contrats recherchés dans le profil

- Le profil porte search.contracts (alternance, stage ou les deux ; un profil plus ancien reste en alternance). L'IA s'en sert pour juger la compatibilité du contrat : un stage n'est plus écarté quand le candidat cherche aussi des stages. Version du prompt passée à 2 : les analyses sont refaites avec le nouveau critère.

### D29 (suite 4) : candidature spontanée = type de contrat à part

- La Bonne Boîte n'a pas d'annonces : ses entreprises ont le type SPONTANEE (« Spontanée »), pas « alternance ». Je les avais classées en alternance pour faire marcher les filtres, ce qui confondait le contrat et la façon de postuler. Elles ont leur propre filtre de contrat. Le prompt de l'IA précise qu'une candidature spontanée n'est jamais un contrat incompatible.
- Deux migrations : Postgres n'autorise pas l'usage d'une nouvelle valeur d'énumération dans la migration qui l'ajoute.

## D30. Google Jobs via SerpApi : atteindre LinkedIn, Indeed et Welcome to the Jungle sans toucher à ces sites

- **Pourquoi un intermédiaire** : LinkedIn, Indeed et Welcome to the Jungle n'ont pas d'API publique de recherche d'offres, et les lire par scraping, par leurs API internes ou avec le compte de l'utilisateur est contraire à leurs conditions d'utilisation (risque de restriction du compte). Google Jobs reprend une partie de leurs annonces ; SerpApi expose Google Jobs en JSON. Seul SerpApi est appelé : aucun appel vers Google, LinkedIn, Indeed ni Welcome to the Jungle.
- **Source `GOOGLE_JOBS`** (connecteur `sources/google-jobs`). Facultative : sans `SERPAPI_KEY`, elle est « désactivée » comme les autres. Une recherche par contrat recherché du profil (« alternance développeur TypeScript React », « stage développeur … »), lieu = ville du profil, rayon, France, français.
- **Quota** : 250 recherches par mois en gratuit. `SERPAPI_MAX_SEARCHES` (6 par défaut) borne chaque collecte, pages comprises, avec un tour de rôle entre requêtes (la page 1 de chacune d'abord). À la première erreur de quota, la boucle s'arrête et garde ce qui a été lu ; si c'est dès la première recherche, la source est « en erreur ».
- **Plateforme d'origine** : colonne `Offer.via` (« LinkedIn », « Indeed »...), affichée dans le détail (« Google Jobs, via LinkedIn ») et transmise à l'IA comme fait. Colonne dédiée plutôt que du texte dans la description : elle reste interrogeable et ne pollue pas le texte envoyé au modèle.
- **Pas de coordonnées chez SerpApi** : la ville de l'annonce est géocodée par le service public de l'État (`GeocoderService.geocodeCity`, avec mémoire, y compris des villes sans résultat, et la commune proche du domicile favorisée pour départager les homonymes). Régions et « France » ne sont pas géocodées. 40 villes au plus par collecte. Le géocodeur passe de `collection/` à `sources/` : il sert maintenant à un connecteur.
- **Source non fiable** : le filtre de pertinence et la détection du type de contrat s'appliquent comme pour Adzuna. Placée en dernier dans la collecte : en cas de doublon avec une autre source, l'annonce des sources précédentes gagne.
- **Date** : Google n'indique qu'un âge arrondi (« il y a 3 jours ») ; la date est une estimation, suffisante pour le tri par fraîcheur.
- **Limites assumées** : pas de type de contrat fiable (déduit du texte), rayon `lrad` non strict, service qui scrape Google et fait l'objet d'une procédure (R42).

## D31. Glassdoor via SerpApi, et ce qui a été écarté

- **Essais réels avant de coder** (quelques recherches sur le quota) : l'API **Indeed** de SerpApi interroge indeed.com (États-Unis) sans paramètre de pays : « alternance » ne renvoie rien, un lieu français renvoie des annonces américaines, et `domain` / `country` sont ignorés. **Inutilisable en France.** L'API **Google Jobs Listing** ne renvoie que les notes d'une entreprise pour une annonce déjà connue : inutile. L'API **Glassdoor** fonctionne en France : 30 annonces par recherche, dont de vraies alternances.
- **Source `GLASSDOOR`** (connecteur `sources/glassdoor`) : une recherche par contrat recherché (« alternance développeur », « stage développeur »), `location` = ville du profil, rayon ramené à la valeur admise la plus proche (5 à 100 km), annonces des 14 derniers jours, pages par jeton. Volontairement **sans** les mots-clés de la pile : Glassdoor les rend obligatoires et ne renverrait presque rien ; le tri fin est fait par le filtre de pertinence et l'IA.
- **Limites assumées** : un extrait du texte seulement (les compétences listées par Glassdoor y sont ajoutées, et le prompt de l'IA précise de ne pas pénaliser l'absence de détails), pas de coordonnées (ville géocodée), lien vers la fiche Glassdoor.
- **Budget SerpApi** : un seul quota de 250 recherches par mois pour les deux sources. Plafonds séparés par collecte : `GOOGLE_JOBS_MAX_SEARCHES` (2) et `GLASSDOOR_MAX_SEARCHES` (4), soit environ 40 collectes par mois. Glassdoor reçoit la plus grosse part : 30 annonces par recherche contre 10 pour Google Jobs, souvent peu pertinentes. **`SERPAPI_MAX_SEARCHES` est remplacé** par ces deux variables.
- **Code commun** (`sources/serpapi/serpapi.ts`) : requête, traduction des erreurs (jamais de clé ni d'URL), pagination à budget, géocodage. Google Jobs a été remis sur ce socle (mêmes tests).
- **Annonces d'écoles** : une école qui se présente comme employeur d'alternance est écartée à la collecte et au nettoyage (sources non fiables seulement) quand le nom de l'entreprise contient CFA, école, campus, institut, formation, université, academy ou school, ou que le texte cite un titre RNCP. Limite : une marque d'école sans ces mots passe à travers.

## D32. Alertes e-mail Indeed lues dans Gmail

- **Pourquoi** : l'API Indeed de SerpApi ne couvre pas la France (D31) et Indeed n'a pas d'API publique de recherche. Les alertes e-mail qu'Indeed envoie à l'utilisateur contiennent les annonces ; les lire dans sa boîte Gmail n'appelle ni Indeed, ni un compte, ni un lien : c'est conforme à leurs conditions et sans risque pour le compte.
- **Écrit sur un vrai message** (jamais sur un format supposé) : relevé le 2026-11-10, le message de confirmation d'alerte contenait déjà 9 annonces. Structure : « N nouveaux emplois ... », puis par annonce : intitulé, « Entreprise - Ville (département) », salaire facultatif, « Candidature simplifiée » facultatif, extrait, âge (« Publié à l'instant », « il y a 3 jours »), lien de suivi. Analyse du corps **texte** seulement (pas de dépendance d'analyse HTML) ; un message sans partie texte est compté « ignoré ».
- **Source `INDEED`** (`sources/alerts`). Recherche Gmail bornée : expéditeur exact `donotreply@jobalert.indeed.com`, 14 jours, 50 messages au plus, les plus récents d'abord ; une annonce vue dans plusieurs alertes garde sa version la plus récente.
- **Identifiant stable** : Indeed ne donne que des liens de suivi (`engage.indeed.com/...`, propres au destinataire et jamais ouverts par le serveur). L'identifiant est une empreinte de « intitulé + entreprise + ville » normalisés : la même annonce reste la même d'une alerte à l'autre (réimport idempotent). Le lien de suivi sert de lien « Voir l'offre » : il s'ouvre depuis l'interface, quand l'utilisateur clique ; sa durée de validité n'est pas garantie.
- **Authenticité** : un message n'est lu que si l'adresse d'expéditeur est exacte **et** que Gmail a validé sa signature DKIM pour `indeed.com` (en-tête `Authentication-Results` posé par Gmail à la réception, hors de portée de l'expéditeur). Les liens d'annonce doivent avoir l'hôte exact `engage.indeed.com` en https, sinon le bloc est écarté.
- **Données** : le corps du message est analysé en mémoire ; seules les annonces extraites sont enregistrées. Étendue Gmail inchangée (`gmail.readonly`).
- **Filtre des écoles** complété par des formules d'annonce d'école relevées sur de vraies annonces (ISCOD : « préparer une formation en développement informatique », « spécialiste de la formation », « entreprise partenaire »).
- **Limites** : un seul expéditeur Indeed connu (d'autres formats ou expéditeurs d'alerte ne seraient pas lus), texte limité à un extrait, salaire dans la description. LinkedIn et Welcome to the Jungle attendent un vrai message d'alerte avec des offres.

### D32 (suite) : deux défauts trouvés par le premier essai réel

- **Google Jobs : identifiant d'annonce instable.** Hors du cache d'une heure de SerpApi, la même annonce revient avec un autre `job_id` : chaque collecte recréait les mêmes annonces (18 lignes pour 9 annonces constatées). Pour les sources à identifiant instable (`UNSTABLE_ID_SOURCES`, Google Jobs), l'identité d'une offre est l'empreinte (entreprise, intitulé, ville) : une annonce déjà connue sous un autre identifiant est mise à jour, pas recréée, et le nettoyage supprime les doublons déjà en base (garde la ligne analysée, sinon la plus ancienne ; jamais une ligne qui a une candidature). Les sources à identifiant stable ne sont pas concernées : deux annonces de même titre y restent deux offres.
- **Écoles sans mot d'école.** ISCOD (citée par l'utilisateur) et SCHOLIA n'avaient ni mot-clé dans leur nom, ni formule typique dans le texte : liste courte de marques ajoutée, extensible par l'utilisateur via « Entreprises à exclure » de son profil.

### D33 : collecte quotidienne à heure fixe (08:30, heure de Paris)

- **Réglage** : `COLLECT_DAILY_AT=HH:MM` (heure de Paris, été comme hiver, vide = désactivé). Prioritaire sur `COLLECT_EVERY_HOURS`. Le minuteur est recalculé après chaque passage, donc le changement d'heure ne décale rien.
- **Pourquoi 08:30** : les alertes e-mail (Indeed, bientôt LinkedIn et Welcome to the Jungle) sont envoyées de nuit ou tôt le matin ; à 08:30 elles sont arrivées et les offres ont moins de 24 h, avant que la plupart des candidats postulent (la fraîcheur compte beaucoup dans le score). Les recruteurs publient surtout en début de semaine et en matinée.
- **Pourquoi une seule fois par jour** : une collecte consomme 6 recherches SerpApi (2 Google Jobs + 4 Glassdoor) sur 250 gratuites par mois : 30 collectes = 180, il reste une marge d'environ 70 pour les collectes à la demande. Deux par jour dépasseraient le quota.
- **Limite** : l'application tourne sur le PC de l'utilisateur ; si le PC est éteint ou en veille à 08:30, la collecte n'a pas lieu ce jour-là (la suivante se fait le lendemain).

### D34 : LinkedIn par les e-mails d'offres lus dans Gmail

- **Ce qui est lu** : les messages que LinkedIn envoie déjà à l'utilisateur (offres recommandées de `jobs-listings@linkedin.com`, offres enregistrées et « offres similaires » de `jobs-noreply@linkedin.com`, alertes de `jobalerts-noreply@linkedin.com`). Aucun appel à LinkedIn, aucun compte utilisé, aucun lien suivi : c'est la seule voie sans risque pour le compte.
- **Format** : relevé sur de vrais messages (trois modèles). Chaque annonce se termine par « Voir l'offre d'emploi : lien » ; les trois lignes au-dessus sont l'intitulé, l'entreprise et le lieu. Le troisième expéditeur n'a pas encore été observé : il est lu avec les mêmes règles strictes, un format différent donnerait des blocs « ignorés ».
- **Identifiant** : le numéro d'annonce LinkedIn, stable d'un message à l'autre (pas de doublon).
- **Jetons** : les liens reçus contiennent des jetons personnels, dont un jeton de connexion à usage unique. Ils ne sont jamais stockés : l'adresse publique est reconstruite à partir du seul numéro (`https://www.linkedin.com/jobs/view/<numéro>/`).
- **Déjà postulé** : l'annonce d'un message « votre candidature a été envoyée » n'est pas reprise (elle est déjà dans le suivi) ; les offres similaires du même message le sont.
- **Limites** : pas de texte d'annonce ni de date de publication (l'IA note sur l'intitulé) ; un lieu donné comme un département n'est pas géolocalisé ; Welcome to the Jungle attend toujours un premier e-mail d'alerte réel.

### D35 : l'IA n'analyse que les offres au contrat recherché

- **Règle** : une offre n'est envoyée au modèle (collecte, affichage de la liste) que si son type de contrat est un de ceux du profil (`search.contracts` : alternance, stage). Le type est déduit du texte de l'annonce par `detectContractType` (alternance, apprentissage, contrat de professionnalisation, stage, internship, intern...), donc le tri ne coûte aucune requête.
- **Les autres** (contrat non précisé, CDI, CDD, candidature spontanée) restent dans la liste, sans note, en fin de liste, de la plus récente à la plus ancienne (date de publication, à défaut date de première apparition). Elles ne comptent pas comme « en attente d'analyse ». Si l'utilisateur en ouvre une, elle est analysée comme avant.
- **Pourquoi pas des mots-clés libres** : le seul filtre utile ici est le contrat, déjà détecté. Des mots-clés de métier risquaient d'écarter de bonnes offres décrites autrement ou en anglais, surtout quand la source ne donne que l'intitulé (LinkedIn).
- **Limites** : une annonce qui ne dit jamais « alternance » ni « stage » (ni dans le titre ni dans le texte) n'est pas notée avant d'être ouverte ; une source à texte court (extrait) peut manquer le mot ; les candidatures spontanées de La Bonne Boîte ne sont plus notées automatiquement.

### D36 : basculement de modèle Gemini (quota atteint, surcharge)

- **Constat** : sur les graphiques de la console Gemini, les erreurs du dernier jour étaient pour moitié des 503 (modèle surchargé) et pour moitié des 429 (quota). Le quota est compté PAR MODÈLE (et pour tout le projet, pas par clé) : un autre modèle a encore le sien.
- **Règle** : `GEMINI_FALLBACK_MODELS` (3 au plus, séparés par des virgules) liste les modèles de secours. Sur 429, 503 ou 404, le modèle suivant prend le relais. Une clé refusée, une demande bloquée ou une réponse inexploitable ne basculent pas : elles valent pour tous les modèles.
- **Pause** : un modèle en échec n'est plus appelé pendant un moment (chaque requête refusée compte dans le quota) : 30 s pour une surcharge, 2 min pour un premier quota atteint, doublé à chaque échec consécutif jusqu'à 1 h (une limite par jour ne passe pas en 2 minutes), 1 h pour un modèle introuvable. Tous les modèles en pause : erreur immédiate sans requête.
- **Erreur finale** : « quota atteint » l'emporte sur « surcharge », puis sur « introuvable » ; les boucles d'analyse s'arrêtent proprement et les offres restent en attente.
- **Défaut** : `gemini-3.6-flash,gemini-3.8-flash`, déduits des libellés de la console (non vérifiés sur l'API) ; un nom faux donne un 404, puis une pause d'une heure, sans effet sur le reste.
- **Limites** : un modèle de secours a en général un quota gratuit plus petit : c'est de la marge, pas un doublement. Le modèle qui a répondu apparaît dans le journal (« Appel modèle gemini-3.6-flash ») mais n'est pas enregistré avec la note de l'offre.

### D37 : voyant de santé par connexion (sources d'offres et Gemini)

- **Principe** : chaque collecte, et chaque appel à Gemini, inscrit en base le résultat de la connexion (table `ApiHealth`, une ligne par connexion : état, date de la dernière vérification, date du dernier succès). Aucun appel de test en plus, donc aucune requête de quota dépensée pour le voyant.
- **États** : OK ; QUOTA (limite atteinte) ; AUTH (clé refusée) ; DOWN (panne ou surcharge, passagère en général) ; OFF (non configurée).
- **Affichage** : un bandeau rouge en haut de l'application dès qu'une connexion est en QUOTA ou AUTH (ce qui ne repart pas tout seul), avec un lien vers la page Sources ; sur la page Sources, la ligne passe en rouge (« Quota atteint », « Clé refusée ») avec la date du constat et du dernier succès, en orange pour une panne. L'état survit au redémarrage de l'API, contrairement au dernier bilan de collecte.
- **Gemini** : l'état est écrit seulement quand il change (il est appelé souvent). Une réponse inexploitable ou bloquée ne dit rien de la connexion et n'est pas inscrite.
- **Sécurité** : jamais de message d'erreur d'origine en base ni à l'écran (il pourrait contenir une URL ou une clé) : seulement l'état.
- **Limites** : le voyant ne reflète que le dernier appel (une panne survenue entre deux collectes n'apparaît qu'à la suivante) ; il ne distingue pas une limite par minute d'une limite par jour (les deux sont « quota atteint ») ; une source en QUOTA est quand même rappelée à la collecte suivante, il n'y a pas de saut automatique.

### D38 : relance des candidatures sans réponse

- **Règle (côté serveur, une seule définition)** : une candidature envoyée (ou accusée, ou classée « sans réponse ») est « à relancer » quand le dernier contact (l'envoi, ou le dernier mail reçu s'il est plus récent) date de 8 à 30 jours, et qu'elle n'a jamais été relancée. Avant 8 jours, c'est trop tôt ; après 30 jours, la relance n'a plus de sens. Une seule relance par candidature.
- **Après la relance** : « on attend » ; 10 jours plus tard, sans réponse, l'application propose de la classer « sans suite » (bouton explicite, jamais automatique). Une candidature déjà « sans réponse » reste « on attend ».
- **Le message** : rédigé par Gemini à partir du profil et de la lettre déjà envoyée (pour ne pas se répéter), 60 à 130 mots, un élément nouveau et une proposition concrète. Mêmes garde-fous que la lettre (aucun chiffre ni fait inventé, aucune coordonnée, aucun repère à compléter, aucune mention d'IA), avec une longueur propre à la relance (50 à 150 mots). L'objet, la signature et les coordonnées sont ajoutés localement, jamais par le modèle.
- **Rien n'est envoyé** : l'utilisateur relit et modifie, puis crée un brouillon Gmail (ou copie le texte) et l'envoie lui-même. La relance n'est inscrite (date, brouillon) qu'à la création du brouillon, ou quand l'utilisateur déclare avoir relancé autrement (téléphone, LinkedIn).
- **Données** : deux colonnes sur la candidature (`followedUpAt`, `followUpDraftId`). Supprimer la candidature supprime aussi le brouillon de relance (il contient un texte personnel).
- **Limites** : le modèle n'écrit pas dans le fil du mail d'origine (un nouveau brouillon, objet « Relance : … ») ; les 8 jours sont un chiffre fixe, pas un réglage ; une candidature par LinkedIn ou formulaire peut être relancée par copie du texte seulement.

### D39 : ajouter une offre par copier-coller (le lien n'est jamais visité)

- **Constat** : lire une annonce LinkedIn ou Welcome to the Jungle depuis son seul lien est techniquement possible (pages souvent visibles sans compte), mais leurs conditions l'interdisent : Welcome to the Jungle (CGU du 27 avril 2026, art. 10) interdit tout logiciel, script, robot, et même « les extensions et modules de navigateur », pour copier ou télécharger le site ; LinkedIn interdit aussi la collecte automatisée. Puppeteer n'y change rien. Seule la lecture personnelle est permise (WTTJ art. 19.2).
- **Choix** : l'utilisateur copie lui-même le texte de l'annonce et le colle ; le lien est facultatif et seulement GARDÉ (https, sans identifiants) pour rouvrir l'annonce. Le serveur ne télécharge rien.
- **Lecture du texte** : une requête Gemini propose intitulé, entreprise et ville (texte encadré comme non fiable, coordonnées retirées avant le modèle) ; l'adresse de contact est cherchée par le code (adresses « noreply » ignorées). L'utilisateur vérifie et corrige ; sans quota, il remplit les champs lui-même.
- **Enregistrement** : source `MANUAL`, description = le texte collé tel quel (le modèle ne réécrit rien), contrat déduit comme ailleurs, ville géolocalisée (distance), doublon détecté sur toutes les sources (l'offre existante est rouverte). Analyse immédiate ; un quota atteint garde l'offre sans note.
- **Jamais supprimée par le tri de pertinence** (source de confiance comme La Bonne Boîte) : c'est un choix de l'utilisateur. Purge RGPD inchangée : sans candidature, elle part après la durée de conservation.

### D40 : tableau de bord « Résultats »

- **But** : savoir ce que donnent les candidatures (réponses, entretiens), quelles sources marchent, et où en est le travail, pour décider où investir du temps et du quota. Page `/resultats`, données de `GET /stats` (lecture seule, calcul pur et testé dans `apps/api/src/stats/stats.ts`).
- **Définitions** : « envoyée » = date d'envoi connue. « Réponse » = au moins un mail classé (accusé, entretien, refus, autre) OU un statut posé à la main (accusé, entretien, refus). « Entretien » = statut entretien ou mail d'entretien. Délai médian = entre l'envoi et le PREMIER mail reçu. Taux de réponse par source = réponses / envoyées de cette source.
- **Honnêteté statistique** : en dessous de 5 candidatures envoyées, un bandeau dit « trop tôt pour conclure » ; par source, un envoi sur moins de 3 est marqué « (sur N) ». Aucun pourcentage quand il n'y a rien à diviser (tiret, pas 0 %).
- **Relances** : nombre de relances faites, et combien ont été suivies d'une réponse reçue APRÈS la relance (une réponse arrivée avant n'est pas un effet de la relance).
- **Semaines** : huit semaines glissantes, lundi de chaque semaine en UTC (un envoi tardi le dimanche soir en heure de Paris peut compter dans la semaine suivante : écart assumé, affichage seulement).
- **Données** : seulement des compteurs. Aucun texte de lettre, de mail ni nom de recruteur ne quitte la base pour cet écran (testé). Pas de nouvelle donnée stockée, pas de migration.
- **Limites** : corrélation, pas causalité (une source qui répond plus n'est pas forcément meilleure : le nombre d'envois est petit) ; les candidatures déclarées « envoyées » à la main avant l'existence de la date d'envoi ne comptent pas.

### D41 : fiabilité de Gemini, trois défauts trouvés à l'usage (ajout manuel d'une offre)

- **Incident** : une annonce collée a donné « lecture impossible » ; les journaux montraient les trois modèles en échec en une minute (deux erreurs rapides, un délai de 60 s), alors que, une minute plus tard, `gemini-3.5-flash-lite` répondait en 0,8 s à la même annonce. Cause : une indisponibilité passagère de Gemini.
- **Défaut 1, pas de nouvel essai** : une erreur 5xx met le modèle en pause 30 s et bascule d'emblée. Désormais UN nouvel essai du même modèle après une pause (`GEMINI_RETRY_DELAY_MS`, 1 s par défaut, 0 pour supprimer) avant de basculer. Un délai dépassé n'est pas réessayé (il durerait aussi long), ni une erreur 4xx.
- **Défaut 2, échec instantané pendant la pause** : quand tous les modèles étaient en pause pour simple indisponibilité, la demande suivante échouait sans aucune requête, donc « Réessayer » ne pouvait pas marcher avant 30 s. Désormais le modèle principal est tenté une fois. Un quota atteint, lui, ne déclenche toujours aucune requête (on ne gaspille pas le quota).
- **Défaut 3, limite de sortie trop basse** : les modèles de secours « réfléchissent » avant de répondre et cette réflexion compte dans `maxOutputTokens` ; mesuré : à 300 jetons, `gemini-3.6-flash` coupait la réponse en plein JSON (`MAX_TOKENS`), donc le secours n'aurait pas pu servir. Extraction 300 → 2000, relance 800 → 2000, lettre 1500 → 3000 (c'est un plafond, pas une consommation).
- **Écran** : « Gemini est momentanément indisponible » au lieu d'un message vague, et un bouton « Réessayer la lecture automatique » qui évite de tout recoller.
- **Constat à surveiller** : `gemini-3.8-flash` a dépassé 30 s sans répondre au test ; sa place de dernier secours le rend peu gênant, mais il vaut mieux vérifier son nom exact dans AI Studio.

### D42 : démo publique sans serveur (vitrine pour recruteurs)

- **Contrainte** : des visiteurs ne doivent jamais pouvoir appeler les API de l'auteur (quotas Gemini et SerpApi, Gmail, données réelles). Ouvrir l'application réelle, même avec un faux modèle, aurait exposé un serveur, des comptes et des quotas.
- **Choix** : la démo est LA MÊME interface, construite en mode `demo` (`pnpm --filter @airpost/web build:demo`, dossier `apps/web/dist-demo`). Le client d'API est remplacé par un faux serveur en mémoire (`src/demo/demoApi.ts`) alimenté par des données fictives (`src/demo/fixtures.ts` : candidate, entreprises et annonces inventées). Aucune requête réseau ne part : tout est local au navigateur, perdu au rechargement.
- **Ce qui marche pour de vrai** : tri, filtres, recherche, ouverture des offres, copie, PDF de la lettre (fabriqué dans le navigateur), calculs du tableau de bord (mêmes définitions que le vrai serveur), règle des relances (8 à 30 jours). **Ce qui est simulé** : analyse IA, lettre, relance, lecture d'une annonce collée et collecte (textes préparés, petite pause pour laisser sentir le traitement), Gmail. Un encart dans la barre latérale le dit.
- **Défense en profondeur** : (1) pas de serveur ; (2) en-têtes de la démo (`_headers`, format Netlify / Cloudflare Pages) avec `connect-src 'none'` : le navigateur refuse toute requête réseau même si du code en tentait une ; (3) un contrôle de build (`scripts/check-demo-build.mjs`, lancé par `build:demo`) échoue si la démo contient une forme de clé d'API ou n'a pas les en-têtes, ou si la VERSION RÉELLE contient du code ou des données de la démo ; (4) tests : aucune requête `fetch` pendant tout un parcours complet.
- **Hébergement** : fichiers statiques, à part de l'application réelle (autre dossier, idéalement autre domaine). L'application réelle reste chez l'utilisateur, derrière son mot de passe. Routage par `#/` : la démo marche sous n'importe quel chemin (`/demo/`).
- **Données** : toutes fictives, aucune donnée de l'auteur, de recruteurs ou d'entreprises réelles. Les noms d'entreprises sont inventés (toute ressemblance serait fortuite : à revérifier avant d'ajouter une entreprise).
- **Limites** : les textes simulés sont les mêmes à chaque fois ; le faux serveur n'est pas la vraie logique (il peut diverger si le vrai serveur change : les tests de parcours le rattrapent en partie) ; le service worker est désactivé dans la démo.

### D43 : page d'accueil et site public (vitrine pour recruteurs)

- **Cible et ton** : une vitrine pour des recruteurs (projet personnel, non commercial), en français. Elle montre la vidéo, mène vers la démo et explique la confiance (jamais d'envoi automatique, aucune connexion aux sites d'emploi, données minimisées).
- **Aucun script** : la page est du HTML et du CSS seulement. Pas de JavaScript, pas de pistage, pas de cookie, pas de statistiques, pas de police ni de ressource tierce (les polices IBM Plex Sans et Source Serif 4, sous licence OFL, sont hébergées avec la page : charger Google Fonts aurait envoyé l'adresse IP du visiteur à Google). Le thème clair ou sombre suit celui du visiteur.
- **Assemblage** : `pnpm build:site` construit la démo puis assemble `site/` (page + `demo/` + vidéo + affiche) avec ses en-têtes (`_headers`). `pnpm check:site` contrôle le résultat : aucun `<script>`, aucune ressource externe, aucun lien local cassé, accessibilité de base (langue, un seul `<h1>`, commandes de la vidéo), aucun secret, et en-têtes distincts : la page n'autorise AUCUN script (`default-src 'none'`), la démo interdit tout réseau (`connect-src 'none'`).
- **Hébergement** : fichiers statiques (Netlify, Cloudflare Pages, GitHub Pages avec la limite des en-têtes personnalisés, etc.), à part de l'application réelle, qui reste chez l'utilisateur derrière son mot de passe. Sur un hébergeur qui n'applique pas `_headers`, la démo reste sûre (elle ne contient aucun secret et aucun serveur), mais perd la seconde protection (interdiction du réseau par le navigateur).
- **Chiffres affichés** (« 7 sources », « 800+ tests », « 42 décisions ») : vérifiés sur le dépôt à la date de rédaction (sources : La Bonne Alternance, La Bonne Boîte, Adzuna, Google Jobs, Glassdoor, alertes Indeed et LinkedIn ; 700 tests de l'API et 134 de l'interface sans compter ceux sur base réelle ; décisions D1 à D42). À remettre à jour si le dépôt évolue.
- **Vidéo** : 82 secondes, texte et musique originale générée (sans échantillon externe, donc libre de droits), avec des données fictives uniquement. Les sources du montage vivent dans un dépôt séparé (`airpost-video`).

### D44 : guide de démarrage public (« Get started »)

- **Pourquoi** : le bouton « Voir le code » menait à GitHub sans mode d'emploi. Il est remplacé par « Get started », qui ouvre `/guide/` : un guide pas à pas (outils, clonage, configuration, clés gratuites, lancement, compte, profil, première collecte, Gmail, quotidien, mise à jour, dépannage, règles à garder) pour qui veut utiliser airpost pour sa propre recherche. Le lien GitHub reste dans le guide et en bas de la page.
- **Forme** : une page HTML sans script, même feuille de style que l'accueil, mêmes en-têtes de sécurité (`/guide/*`). Sommaire sticky, tableau des clés, blocs de commandes à copier.
- **Pièges rencontrés en relisant l'installation à froid** : (1) `docker compose up` monte `credentials.json` et `token.json` ; s'ils n'existent pas, Docker crée des DOSSIERS de ce nom : le guide fait créer deux fichiers vides (le client Gmail tolère un fichier vide) ; (2) rien dans le dépôt ne produisait `token.json` : ajout de `scripts/gmail-authorize.mjs` (flux « application de bureau » avec PKCE, redirection locale 127.0.0.1) ; (3) un écran de consentement Google en mode « Test » invalide le jeton après 7 jours : le guide indique de publier l'application (usage perso) puis de relancer avec `--force`.
- **Contrôles** : `check:site` vérifie aussi le guide (aucun script, liens et ancres valides, un seul h1, en-têtes) et que l'accueil y renvoie. Le contrôle de secrets accepte le NOM d'une variable (documenté dans le guide) mais refuse une valeur affectée.
- **Limites** : les parcours d'obtention des clés (interfaces de Google, France Travail, Adzuna, SerpApi, La Bonne Alternance) sont décrits de mémoire et peuvent changer ; la création de la clé La Bonne Alternance n'a pas été revérifiée. Licence MIT ajoutée ensuite (fichier LICENSE) : la réutilisation du code est permise ; COLLECT_DAILY_AT figure désormais dans .env.example.
