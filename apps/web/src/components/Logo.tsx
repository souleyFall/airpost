/** Logo de la maquette : timbre bleu avec une enveloppe. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1E3FA8" />
      <rect
        x="5.5"
        y="7.5"
        width="13"
        height="9.5"
        rx="1.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.75"
      />
      <path
        d="m6 9 6 4.5L18 9"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
