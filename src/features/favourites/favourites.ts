import { MAX_STATION_CODES } from '../../../shared/api';

/**
 * Favourite stations, kept on this device only: no account, nothing sent
 * anywhere but the station codes, when asking /api/stations for their prices.
 *
 * Stored with the name as well as the code, so a station FuelCheck stops
 * listing can still be named when we say it has gone. The same pattern as
 * the theme (src/features/theme/theme.ts): every storage access in a try,
 * junk treated as nothing, another tab's change picked up by `storage`.
 */

export interface Favourite {
  code: string;
  name: string;
}

export const FAVOURITES_STORAGE_KEY = 'fuel-finder:favourites:v1';

/** The API answers for this many at once; more than anyone keeps. */
export const MAX_FAVOURITES = MAX_STATION_CODES;

function isFavourite(value: unknown): value is Favourite {
  if (typeof value !== 'object' || value === null) return false;
  const { code, name } = value as Record<string, unknown>;
  return typeof code === 'string' && /^[\w-]{1,32}$/.test(code) && typeof name === 'string';
}

export function readFavourites(): Favourite[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(isFavourite).filter((favourite) => {
      if (seen.has(favourite.code)) return false;
      seen.add(favourite.code);
      return true;
    });
  } catch {
    return [];
  }
}

/** False when it could not be stored (private mode, full storage): it still applies for this visit. */
function writeFavourites(favourites: Favourite[]): boolean {
  try {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(favourites));
    return true;
  } catch {
    return false;
  }
}

let current: Favourite[] | null = null;
const listeners = new Set<() => void>();

export function getFavourites(): Favourite[] {
  current ??= readFavourites();
  return current;
}

function set(next: Favourite[]): void {
  writeFavourites(next);
  current = next;
  for (const listener of listeners) listener();
}

/** Adds the station, or removes it if it is already a favourite. Newest last. */
export function toggleFavourite(favourite: Favourite): void {
  const list = getFavourites();
  if (list.some((f) => f.code === favourite.code)) {
    set(list.filter((f) => f.code !== favourite.code));
  } else if (list.length < MAX_FAVOURITES) {
    set([...list, favourite]);
  }
}

export function removeFavourite(code: string): void {
  set(getFavourites().filter((f) => f.code !== code));
}

export function subscribeFavourites(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== FAVOURITES_STORAGE_KEY) return;
    current = readFavourites();
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** For tests: forget the cached list, as a fresh page load would. */
export function resetFavouritesForTests(): void {
  current = null;
}
