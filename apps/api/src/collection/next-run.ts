/** Fuseau de l'utilisateur : l'heure de la collecte quotidienne est une heure murale française, été comme hiver. */
const TIMEZONE = 'Europe/Paris';

/** Décalage (ms) entre l'heure murale de Paris et UTC à cet instant : +1 h l'hiver, +2 h l'été. */
function parisOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** Prochain instant (ms depuis epoch) où il est `hhmm` à Paris, strictement après `now`. */
export function nextDailyRun(now: number, hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number) as [number, number];
  const offsetNow = parisOffsetMs(now);
  const wallNow = new Date(now + offsetNow);
  for (let dayShift = 0; dayShift <= 2; dayShift++) {
    const wallTarget = Date.UTC(
      wallNow.getUTCFullYear(),
      wallNow.getUTCMonth(),
      wallNow.getUTCDate() + dayShift,
      hour,
      minute,
    );
    // Le décalage est celui de l'instant visé (changement d'heure possible entre maintenant et la cible).
    let candidate = wallTarget - offsetNow;
    candidate = wallTarget - parisOffsetMs(candidate);
    if (candidate > now) return candidate;
  }
  throw new Error('Heure de collecte introuvable.');
}
