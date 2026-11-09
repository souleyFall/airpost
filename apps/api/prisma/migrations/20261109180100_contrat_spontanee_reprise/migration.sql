-- Reprise de l'existant : les entreprises de La Bonne Boîte étaient classées en alternance.
UPDATE "Offer" SET "contractType" = 'SPONTANEE' WHERE "source" = 'LBB';
