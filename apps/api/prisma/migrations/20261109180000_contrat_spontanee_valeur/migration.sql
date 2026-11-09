-- Nouveau type de contrat : candidature spontanée (La Bonne Boîte n'a pas d'annonces).
-- La valeur ne peut pas être utilisée dans la migration qui l'ajoute : la reprise est dans la suivante.
ALTER TYPE "ContractType" ADD VALUE 'SPONTANEE';
