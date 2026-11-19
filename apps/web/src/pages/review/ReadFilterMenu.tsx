import { useEffect, useId, useRef, useState } from 'react';

/** Filtre de lecture : toutes, jamais ouvertes, déjà ouvertes, ou apparues à la dernière collecte. */
export type ReadFilter = 'all' | 'unread' | 'read' | 'new';

const CHOICES: { id: ReadFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'unread', label: 'Non lues' },
  { id: 'read', label: 'Lues' },
  { id: 'new', label: 'Nouvelles' },
];

/**
 * Petit menu qui s'ouvre au clic, EN SURIMPRESSION : il est positionné de façon absolue sous le bouton, donc il ne
 * déplace ni ne pousse la liste des offres. Il se ferme au choix, au clic ailleurs ou avec Échap.
 */
export function ReadFilterMenu({
  value,
  unread,
  onChange,
}: {
  value: ReadFilter;
  /** Nombre d'offres à traiter jamais ouvertes (pastille, comme dans une messagerie). */
  unread: number;
  onChange: (value: ReadFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    // À l'ouverture, le focus va sur le choix actuel : le clavier prend le relais.
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onMenuKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Les flèches déplacent le choix dans le menu, pas la sélection de l'offre derrière.
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  }

  const current = CHOICES.find((choice) => choice.id === value) ?? CHOICES[0];
  const filtering = value !== 'all';

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className={`btn btn-quiet !h-8 gap-1.5 !text-[13px] ${filtering ? '!border-ink' : ''}`}
      >
        {filtering ? (current?.label ?? 'Lecture') : 'Lecture'}
        {unread > 0 ? (
          <span
            title={`${unread} non lue${unread > 1 ? 's' : ''}`}
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-paper"
          >
            {unread}
            <span className="sr-only"> non lue{unread > 1 ? 's' : ''}</span>
          </span>
        ) : null}
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Filtrer par lecture"
          onKeyDown={onMenuKey}
          className="absolute top-full left-0 z-30 mt-1 w-52 rounded-md border border-line-strong bg-surface p-1 shadow-lg"
        >
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.id === value}
              onClick={() => {
                onChange(choice.id);
                setOpen(false);
                trigger.current?.focus();
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-sm border-0 bg-transparent px-3 py-2 text-left text-[13px] text-ink hover:bg-hover focus-visible:bg-hover"
            >
              <span className={choice.id === value ? 'font-semibold' : ''}>{choice.label}</span>
              <span className="text-muted">
                {choice.id === 'unread' && unread > 0 ? unread : null}
                {choice.id === value ? (
                  <span aria-hidden="true" className="ml-2 text-ink">
                    ✓
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
