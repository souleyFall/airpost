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
