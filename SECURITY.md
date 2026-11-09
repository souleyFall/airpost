# Politique de sécurité

airpost est un projet personnel (outil de recherche d'alternance). Il n'est pas destiné à être exposé sur Internet tel quel, mais la sécurité y est traitée sérieusement.

## Signaler une vulnérabilité

**N'ouvrez pas de ticket public** pour une faille.

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Indiquez ce que vous avez observé, comment le reproduire et l'impact que vous imaginez. N'incluez aucune donnée personnelle réelle.

Je m'engage à accuser réception sous 7 jours et à corriger ou à répondre sur la suite donnée sous 30 jours.

## Périmètre

Dans le périmètre : le code de ce dépôt, sa configuration Docker, ses workflows GitHub Actions.
Hors périmètre : les services tiers (Google, France Travail, La Bonne Alternance, Adzuna), les attaques supposant déjà l'accès au poste de l'utilisateur, le déni de service par volume.

## Ce qu'il ne faut jamais publier

Clés d'API, `credentials.json`, `token.json`, fichiers `.env`, ou toute donnée personnelle réelle. Si vous en trouvez dans l'historique du dépôt, signalez-le de la même façon.

## En cas de fuite d'un secret (pour le mainteneur)

1. **Révoquer d'abord**, nettoyer ensuite : une clé poussée est considérée comme compromise, même si le dépôt est privé ou si l'historique est réécrit.
   - Gmail : retirer l'accès sur https://myaccount.google.com/permissions, puis supprimer `token.json`.
   - Clés d'API : les régénérer sur les portails de chaque fournisseur.
2. Mettre à jour le `.env` local avec les nouvelles valeurs.
3. Si une donnée personnelle ou un secret a été publié : créer un nouveau dépôt plutôt que réécrire l'historique (GitHub conserve les anciens commits joignables par leur hash).
4. Consigner l'incident dans `docs/securite/registre-risques.md`.

## Pour en savoir plus

- Registre des risques et incident passé : [`docs/securite/registre-risques.md`](docs/securite/registre-risques.md)
- Registre RGPD : [`docs/rgpd/registre-traitements.md`](docs/rgpd/registre-traitements.md)
- Décisions techniques : [`docs/decisions.md`](docs/decisions.md)
