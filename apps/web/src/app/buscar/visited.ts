/* Histórico de concessionárias visitadas — persistido em localStorage */

const KEY = 'autoconnect:visited-dealers';
const MAX = 50;

export function getVisited(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markVisited(pinId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list = Array.from(getVisited());
    const next = [pinId, ...list.filter((id) => id !== pinId)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignora quota / modo privado */
  }
}
