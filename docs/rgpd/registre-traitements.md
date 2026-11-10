# Registre des traitements (RGPD)

Le RGPD s'applique à toute donnée relative à une personne identifiable, même dans un projet personnel. Ce registre suit le modèle de l'article 30 : il décrit ce qu'airpost fait des données, pourquoi, combien de temps, et avec qui elles sont partagées.

**Responsable du traitement** : Souleymane Fall, à titre personnel (usage privé : recherche d'alternance).
**Contact** : via les « Security advisories » privées du dépôt GitHub (voir `SECURITY.md`). Aucune adresse personnelle n'est publiée.

> Ce document est une analyse de bonne foi, pas un avis juridique.

## Traitement 1 : recherche et suivi de candidatures

|                         |                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**            | Trouver des offres d'alternance, les classer, préparer et suivre ses candidatures.                                                                                                                                                                                                                 |
| **Base légale**         | Mesures précontractuelles à la demande de la personne concernée pour ses propres données (art. 6.1.b) ; intérêt légitime pour les données des recruteurs (art. 6.1.f) : contacter une entreprise au sujet d'une offre qu'elle a publiée.                                                           |
| **Personnes**           | Le candidat (utilisateur) ; les contacts de recrutement des entreprises.                                                                                                                                                                                                                           |
| **Données du candidat** | Identité, coordonnées (e-mail, téléphone, site : facultatifs), ville et code postal (jamais l'adresse complète), parcours, compétences, réalisations, lettres générées, préférences de recherche (rythme, trajet, mots-clés). Stockés dans la table Profile, tailles bornées par un schéma strict. |
| **Données des tiers**   | Offres publiques (entreprise, lieu, description) ; **adresse e-mail et nom éventuels d'un contact recruteur** quand l'offre les publie ; réponses reçues par e-mail (objet, expéditeur, extrait utile au classement).                                                                              |
| **Données sensibles**   | Aucune recherchée. Une offre ou un e-mail peut en contenir par accident (santé, handicap) : elles ne sont ni extraites ni conservées au-delà du texte brut nécessaire, et supprimées avec la candidature.                                                                                          |
| **Origine**             | Le candidat lui-même ; API officielles (La Bonne Alternance, La Bonne Boîte / France Travail, Adzuna), Google Jobs via SerpApi ; sa propre boîte Gmail.                                                                                                                                            |
| **Hébergement**         | Base PostgreSQL dans un conteneur Docker sur le poste du candidat (aucun hébergeur tiers à ce stade).                                                                                                                                                                                              |

## Destinataires et sous-traitants

| Destinataire                           | Données transmises                                                                    | Remarque                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Gemini** (génération)         | Texte de l'offre + extrait minimal du profil nécessaire à la lettre                   | **Point de vigilance** : en offre gratuite, Google peut utiliser les contenus envoyés pour améliorer ses modèles, avec relecture humaine possible. D'où la minimisation (ci-dessous). Transfert hors UE possible. |
| **Google Gmail**                       | Brouillons créés dans sa propre boîte ; lecture de ses propres messages pour le suivi | Même compte que celui du candidat ; portée limitée à la lecture et aux brouillons (pas d'envoi).                                                                                                                  |
| **Sources d'offres** (LBA, FT, Adzuna) | Mots-clés de recherche, lieu, rayon                                                   | Aucune donnée personnelle du candidat n'est envoyée.                                                                                                                                                              |
| **GitHub**                             | Code source uniquement                                                                | Jamais de données, de clés ni de documents personnels (`.gitignore`, `docs/cours/` local).                                                                                                                        |

## Minimisation envoyée à Gemini

Règle de conception (appliquée et testée en PR n°14) : le prompt ne contient **ni adresse e-mail, ni numéro de téléphone, ni adresse postale, ni nom de contact recruteur**. Il contient seulement le texte de l'offre et les éléments de parcours utiles à la lettre. Les coordonnées sont ajoutées localement après la génération. Un test vérifie qu'aucune coordonnée ne part dans la requête.

## Durées de conservation

| Donnée                          | Durée                                                                                     | Justification                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Offres non retenues             | 90 jours après la collecte                                                                | Une offre périmée n'a plus d'utilité ; limite l'accumulation.                                  |
| Candidatures et lettres         | Jusqu'à la fin de la recherche, puis 6 mois au plus                                       | Éviter de recontacter deux fois une entreprise ; puis suppression.                             |
| Contact recruteur (nom, e-mail) | Même durée que la candidature, supprimé avec elle                                         | Donnée d'un tiers : conservée seulement pour la candidature concernée.                         |
| E-mails de réponse (extraits)   | Même durée que la candidature                                                             | Servent au suivi de statut.                                                                    |
| Jeton Gmail                     | Tant que l'application sert ; révocable à tout moment                                     | Voir `SECURITY.md` pour la révocation.                                                         |
| Sessions de connexion           | 7 jours au plus, supprimées à la déconnexion et à chaque nouvelle connexion (si expirées) | Seule l'empreinte du jeton est conservée ; aucune adresse IP ni agent navigateur n'est stocké. |
| Journaux techniques             | 30 jours, sans contenu de lettre ni coordonnées                                           | Diagnostic uniquement.                                                                         |

La purge des offres est en place (PR n°12) : après chaque collecte, les offres sans candidature vues pour la première fois il y a plus de 90 jours (OFFER_RETENTION_DAYS) sont supprimées ; une offre suivie n'est jamais purgée. La purge des candidatures reste à écrire (PR n°16).

## Droits des personnes

- **Le candidat** (accès, rectification, effacement, portabilité) : exerce ses droits directement dans l'application ; export JSON (GET /account/export) et effacement complet (POST /account/erase, mot de passe exigé), en place depuis la PR n°16.
- **Un recruteur** dont l'adresse est conservée : peut demander l'accès ou l'effacement ; la suppression de la candidature supprime son contact. La demande se fait via le contact indiqué plus haut. Le candidat peut aussi supprimer un contact à la main.
- **Information** : le premier message à un recruteur ne contient pas d'information RGPD complète, mais une demande d'effacement est honorée sans délai (un mois maximum).

## Sécurité des données

Voir `docs/securite/registre-risques.md` : accès local par défaut (`127.0.0.1`), authentification, secrets hors dépôt, minimisation, jetons à portée minimale.

## Analyse d'impact (AIPD)

Non requise : traitement à petite échelle, usage personnel, aucune donnée sensible recherchée, aucune décision automatisée produisant un effet juridique (le candidat valide chaque envoi).

## Points ouverts

1. Confirmer la politique de données de l'offre Gemini utilisée (gratuite ou payante) avant le premier envoi réel ; passer à une offre sans entraînement sur les données si le profil devient plus détaillé.
2. Décider de l'hébergement : tant que tout reste local, aucun sous-traitant d'hébergement.
3. Purge automatique des candidatures anciennes (6 mois après la fin de la recherche) : à écrire ; l'export, l'effacement complet et la suppression d'une candidature sont en place (PR n°16).

## Mise à jour 2026-11-09 : Gmail (brouillons et réponses)

- **Brouillons** : la lettre validée et l'adresse du recruteur sont déposées dans les brouillons de la boîte de l'utilisateur. Supprimer une candidature, la retirer, revenir à « validée » ou effacer le compte supprime le brouillon ; si Gmail est injoignable, l'application le signale et l'utilisateur le retire lui-même.
- **Réponses** : pour chaque candidature envoyée, une recherche bornée dans la boîte (expéditeur ou nom d'entreprise, après la date d'envoi) ; sont conservés **300 caractères d'extrait**, la date et la catégorie, jamais le corps ni l'adresse de l'expéditeur. Ces extraits peuvent contenir des données de tiers (le recruteur) : ils sont effacés avec la candidature, exportés avec les données de l'utilisateur, et ne sont envoyés à aucun service externe (classement par règles locales).
- **Sauvegardes** (`pnpm db:backup`) : fichier local contenant toutes ces données ; à garder sur l'ordinateur de l'utilisateur, chiffré s'il en sort.

## Mise à jour 2026-11-09 : analyse de compatibilité par IA

- **Nouvelle finalité** : classer les offres selon leur adéquation avec le profil et en résumer le contenu. Même sous-traitant (Google Gemini), mêmes données que pour la lettre : extrait minimal du profil (parcours, compétences, critères) et texte de l'offre sans e-mail, téléphone ni lien. Jamais l'identité, la ville ni le code postal : la distance est calculée sur le serveur.
- **Volume** : jusqu'à 40 offres par collecte (au lieu d'une lettre à la demande). Point de vigilance inchangé sur l'offre gratuite de Gemini (réutilisation possible des contenus) : à trancher avant de rendre l'application publique.
- **Conservation** : l'analyse (note, explication, brief) est stockée avec l'offre et supprimée avec elle (purge à 90 jours sans réapparition).

## Mise à jour 2026-11-10 : Google Jobs via SerpApi

- **Nouveau sous-traitant : SerpApi** (États-Unis). Il reçoit la requête de recherche (contrat recherché et deux mots-clés de la pile technique), la ville du profil et un rayon, comme Adzuna reçoit déjà la ville. Il ne reçoit ni le nom, ni le téléphone, ni l'adresse, ni le parcours du candidat. Source facultative : sans clé, rien n'est envoyé.
- **Données reçues en retour** : annonces publiques (intitulé, entreprise, lieu, description, liens). Aucune donnée de tiers à caractère personnel n'est conservée au-delà de ce que publie l'annonce ; elles suivent la durée de conservation des offres (90 jours sans réapparition).
- **Géocodage** : le nom de la ville de chaque annonce est envoyé au service public de géocodage de l'État, jamais le domicile du candidat.

## Mise à jour 2026-11-10 : Glassdoor via SerpApi

- Même sous-traitant et mêmes données que Google Jobs : SerpApi reçoit la requête (contrat recherché, « développeur »), la ville du profil et un rayon, jamais le nom, le téléphone, l'adresse ni le parcours du candidat. Source facultative (une seule clé SerpApi pour les deux). Annonces publiques reçues en retour, conservées comme les autres offres (90 jours sans réapparition).

## Mise à jour 2026-11-10 : lecture des alertes Indeed dans Gmail

- **Nouvelle lecture du contenu d'e-mails** : jusqu'à 50 messages des 14 derniers jours, de l'expéditeur d'alertes Indeed uniquement (recherche Gmail bornée par expéditeur et par date), en lecture seule. Le corps est analysé **en mémoire** et n'est ni stocké, ni journalisé, ni envoyé à un tiers : seules les annonces extraites (publiques) sont enregistrées.
- **Donnée liée au destinataire stockée** : le lien de suivi d'Indeed de chaque annonce (il contient un jeton propre à l'adresse du destinataire). Conservé comme le reste de l'offre (90 jours sans réapparition), affiché dans l'application locale, jamais ouvert par le serveur.
- Aucun envoi : l'étendue Gmail reste `gmail.compose` et `gmail.readonly`.

## Mise à jour 2026-11-10 : lecture des e-mails d'offres LinkedIn dans Gmail

- **Lecture** : jusqu'à 50 messages des 14 derniers jours, de trois expéditeurs LinkedIn d'offres uniquement (recherche Gmail bornée). Le corps est analysé en mémoire et jamais stocké.
- **Stocké** : intitulé, entreprise, ville et numéro public de l'annonce. Aucun lien reçu, aucun jeton, aucune donnée du compte LinkedIn.
- **Base légale et durée** : inchangées (intérêt de l'utilisateur pour sa propre recherche ; durée de conservation des offres).

## Mise à jour 2026-11-10 : relance des candidatures

- **Nouvelles données** : la date de la relance et l'identifiant du brouillon Gmail de relance, sur la candidature. Le texte de la relance n'est pas stocké par airpost : il vit dans le brouillon Gmail de l'utilisateur.
- **Modèle de langage** : la relance est rédigée à partir du profil (sans nom, mail ni téléphone, comme pour la lettre) et de la lettre déjà envoyée, encadrée comme texte non fiable.
- **Effacement** : supprimer la candidature supprime aussi le brouillon de relance dans Gmail (ou signale qu'il faut le faire à la main).

## Mise à jour 2026-11-11 : offres ajoutées à la main

- **Données** : le texte d'une annonce collé par l'utilisateur (il peut contenir le nom ou l'adresse d'un recruteur, comme les annonces collectées), son lien facultatif et une adresse de contact trouvée dans le texte. Même durée de conservation que les autres offres.
- **Modèle de langage** : il reçoit le texte expurgé des e-mails, téléphones et liens ; il ne renvoie que l'intitulé, l'entreprise et la ville.
- **Aucune collecte sur les sites d'emploi** : le lien n'est jamais visité par le serveur.

## Mise à jour 2026-11-11 : tableau de bord Résultats

- **Aucune nouvelle donnée** : l'écran additionne des données déjà stockées (statuts, dates d'envoi, dates et catégories des réponses, sources). Il n'envoie rien à un tiers ni au modèle de langage, et n'affiche ni texte de lettre, ni extrait de mail, ni contact.
