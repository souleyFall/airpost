/** Écran pas encore construit : remplacé par les PR suivantes (À valider, Suivi, Sources). */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="px-8 py-6">
      <h1 className="m-0 text-[22px] leading-tight font-semibold">{title}</h1>
      <p className="mt-1.5 text-muted">Cet écran arrive dans une prochaine étape.</p>
    </div>
  );
}
