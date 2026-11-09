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
| **Origine**             | Le candidat lui-même ; API officielles (La Bonne Alternance, La Bonne Boîte / France Travail, Adzuna) ; sa propre boîte Gmail.                                                                                                                                                                     |
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

- **Le candidat** (accès, rectification, effacement, portabilité) : exerce ses droits directement dans l'application ; prévoir un export JSON de ses données et un bouton de suppression complète (PR n°16).
- **Un recruteur** dont l'adresse est conservée : peut demander l'accès ou l'effacement ; la suppression de la candidature supprime son contact. La demande se fait via le contact indiqué plus haut. Le candidat peut aussi supprimer un contact à la main.
- **Information** : le premier message à un recruteur ne contient pas d'information RGPD complète, mais une demande d'effacement est honorée sans délai (un mois maximum).

## Sécurité des données

Voir `docs/securite/registre-risques.md` : accès local par défaut (`127.0.0.1`), authentification, secrets hors dépôt, minimisation, jetons à portée minimale.

## Analyse d'impact (AIPD)

Non requise : traitement à petite échelle, usage personnel, aucune donnée sensible recherchée, aucune décision automatisée produisant un effet juridique (le candidat valide chaque envoi).

## Points ouverts

1. Confirmer la politique de données de l'offre Gemini utilisée (gratuite ou payante) avant le premier envoi réel ; passer à une offre sans entraînement sur les données si le profil devient plus détaillé.
2. Décider de l'hébergement : tant que tout reste local, aucun sous-traitant d'hébergement.
3. Écrire l'export et la suppression complète (PR n°16) et les purges planifiées (PR n°12 et n°16).
