# Données stockées dans la base et pourquoi

État au 2026-11-09 : 177 offres, 2 candidatures, 1 profil, 8,8 Mo au total. PostgreSQL local, dans un volume Docker, aucun service tiers.

| Table         | Contenu                                                                                                                                                                                           | Pourquoi                                                                                                           | Conservation                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `User`        | Identifiant et empreinte argon2 du mot de passe                                                                                                                                                   | Se connecter. Le mot de passe n'est jamais stocké.                                                                 | Jusqu'à suppression du compte                              |
| `Session`     | Empreinte du jeton de session, jeton CSRF, expiration                                                                                                                                             | Rester connecté. Une fuite de la base ne permet pas de se connecter (seule l'empreinte est gardée).                | Purgée à l'expiration                                      |
| `Profile`     | Nom, prénom, téléphone, ville, code postal, site, présentation, formations, expériences, compétences, critères de recherche (contrats, rythmes, trajet, mots-clés)                                | Noter les offres, écrire les lettres, signer. Pas de date de naissance, pas d'adresse complète, e-mail facultatif. | Jusqu'à modification ou suppression                        |
| `Offer`       | Source, identifiant chez la source, intitulé, entreprise, ville, coordonnées GPS, description, lien, type de contrat, distance, note et analyse de l'IA, dates de première et dernière apparition | Voir ci-dessous                                                                                                    | 90 jours sans réapparition, sauf si une candidature existe |
| `Application` | Statut, objet et texte de la lettre, identifiant du brouillon Gmail, dates                                                                                                                        | Suivi des candidatures et lettres relues                                                                           | Jusqu'à suppression par l'utilisateur                      |
| `Reply`       | Identifiant du message Gmail, catégorie, date, extrait de 300 caractères au plus                                                                                                                  | Suivre les réponses des recruteurs                                                                                 | Supprimée avec la candidature                              |

## Pourquoi stocker les offres alors que les API les fournissent

Les API sont des moteurs de recherche, pas un entrepôt : elles ne gardent ni notre historique, ni nos notes, et ne servent pas toutes les mêmes données.

1. **La note de l'IA coûte un appel au modèle, dont le quota gratuit est limité.** Sans stockage, chaque affichage de la liste referait les analyses. Les 91 analyses déjà faites seraient perdues et à repayer.
2. **Une offre disparaît de l'API** quand elle est pourvue ou expirée. Une candidature envoyée doit rester consultable (intitulé, entreprise, lien, texte) même si l'annonce n'existe plus.
3. **Filtrer, trier, rechercher et paginer sur trois sources à la fois** n'est possible qu'avec un index local : chaque API a ses propres paramètres, ses limites et son format. La déduplication entre sources (même annonce chez deux partenaires) se fait aussi en local.
4. **Les quotas des API** (Adzuna : 250 appels par jour en gratuit, 3 par collecte) interdisent de les interroger à chaque clic.
5. **La fraîcheur réelle** (première fois vue) et la distance au domicile sont des données calculées chez nous ; les API n'en savent rien.
6. **Rapidité et disponibilité** : l'écran s'affiche même si une API est en panne.

Ce qui pourrait se réduire : pour une offre sans candidature, seuls l'identifiant, la note et l'analyse sont irremplaçables ; le texte pourrait être redemandé. Ce n'est pas fait parce que la base est minuscule (656 ko pour les offres) et que l'API ne permet pas de retrouver une annonce par identifiant de façon fiable. La durée de conservation de 90 jours et la purge limitent l'accumulation.

## Ce qui n'est jamais dans la base

Mots de passe en clair, clés d'API (fichier `.env`), jeton Gmail (fichiers montés en lecture seule), corps et expéditeurs des e-mails reçus, date de naissance, adresse postale complète.

## Ce qui sort vers l'extérieur

- **Gemini** : texte de l'offre sans e-mail, téléphone ni lien, et un extrait du profil sans identité, ville ni code postal.
- **Géocodage** : le code postal seul.
- **Gmail** : le brouillon de lettre, jamais envoyé automatiquement.
