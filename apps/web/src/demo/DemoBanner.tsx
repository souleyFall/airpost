/**
 * Encart de la démo, dans la barre latérale : dit ce qui est vrai et ce qui est simulé. Chargé seulement dans la
 * version démo (jamais dans la version réelle).
 */
export default function DemoBanner() {
  return (
    <div
      role="note"
      className="flex flex-col gap-1.5 rounded-md border border-warn-line bg-warn-bg px-3 py-2.5 text-[12px] leading-snug text-warn-ink"
    >
      <p className="m-0">
        <strong>Démo :</strong> données fictives, aucun serveur derrière. Les textes générés
        (lettre, relance, lecture d’annonce) sont préparés et rien n’est envoyé. Tout repart de zéro
        au rechargement.
      </p>
      <a href="../" className="font-semibold underline">
        Retour à la présentation
      </a>
    </div>
  );
}
