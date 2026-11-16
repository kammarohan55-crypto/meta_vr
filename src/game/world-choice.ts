/**
 * Which world (and therefore which cast) the app shows. Read from saved
 * settings before the scene is built, so it has no dependencies of its own.
 */
export type WorldName = 'frostpeak' | 'lounge' | 'shrine' | 'domain' | 'celestial';

export const SETTINGS_KEY = 'chaos-table.settings.v1';

export interface WorldInfo {
  id: WorldName;
  title: string;
  /** One line for the arena card. */
  tag: string;
  /** The small caps line above the title screen. */
  kicker: string;
  /** The right-hand label on the title screen. */
  label: string;
  /** The title screen's tagline. */
  line: string;
  /** Title-screen and arena-card art (an in-game capture). */
  art: string;
  /** The world's soundtrack (Kevin MacLeod, incompetech.com, CC BY 4.0; see ASSET_CREDITS.md). */
  music: string;
  /** The track's title, for the credit line. */
  track: string;
  family: 'arena' | 'classic';
}

/**
 * The Penthouse seats 3D scans of real people (Renderpeople models; see ASSET_CREDITS.md). The
 * Meta VR Start competition rules forbid depicting identifiable people other than the entrants,
 * so the world is left out unless a build opts in with VITE_PENTHOUSE=1 (vite.config.ts then
 * also keeps its files in the built site). Nothing else about it has changed.
 */
export const PENTHOUSE = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PENTHOUSE === '1';

/**
 * The title's "Mixed reality" button. It plays the same game over passthrough with the room
 * hidden: nothing reads the real room (no detected surfaces, no anchors). The competition's
 * judging marks that down ("passthrough should be purposeful... not a scene that plays the same
 * with passthrough off") and it was never run on a headset, so the button is left out unless a
 * build opts in with VITE_MIXED_REALITY=1. The mode itself is untouched.
 */
export const MIXED_REALITY = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_MIXED_REALITY === '1';

const ALL_WORLDS: WorldInfo[] = [
  {
    id: 'shrine', title: 'Wisteria Shrine', tag: 'Moonlit shrine · falling petals · waterfall', family: 'arena',
    kicker: 'AFTERHOURS ARENAS  ·  THE WISTERIA SHRINE', label: 'MOONRISE  /  OPEN ALL NIGHT', line: 'A moonlit table under the wisteria.', art: 'textures/arena-shrine.jpg', music: 'audio/music/shrine.ogg', track: 'Ishikari Lore',
  },
  {
    id: 'domain', title: 'Midnight Domain', tag: 'Neon rooftop · rain · a summoning sky', family: 'arena',
    kicker: 'AFTERHOURS ARENAS  ·  THE MIDNIGHT DOMAIN', label: 'NEON  /  RAIN  /  NO CURFEW', line: 'A rooftop table under a turning sky.', art: 'textures/arena-domain.jpg', music: 'audio/music/domain.ogg', track: 'Late Night Radio',
  },
  {
    id: 'celestial', title: 'Celestial Arena', tag: 'Marble above the clouds · golden storms', family: 'arena',
    kicker: 'AFTERHOURS ARENAS  ·  THE CELESTIAL ARENA', label: 'ABOVE THE CLOUDS', line: 'A marble table above a sea of cloud.', art: 'textures/arena-celestial.jpg', music: 'audio/music/celestial.ogg', track: 'Floating Cities',
  },
  {
    id: 'frostpeak', title: 'Frostpeak', tag: 'Fireside deck · snowfall · alpine lake', family: 'classic',
    kicker: 'A CARD GAME AT THE TOP OF THE WORLD', label: 'FROSTPEAK  /  OPEN ALL NIGHT', line: 'A fireside table above the clouds.', art: 'textures/frostpeak-title.jpg', music: 'audio/music/frostpeak.ogg', track: 'Frost Waltz',
  },
  {
    id: 'lounge', title: 'Penthouse', tag: 'Private lounge · city lights · scanned cast', family: 'classic',
    kicker: 'THE SOCIAL CARD LOUNGE', label: 'PRIVATE TABLES  /  OPEN LATE', line: 'A private table above the city.', art: 'textures/penthouse-night-v1.jpg', music: 'audio/music/lounge.ogg', track: 'Bossa Antigua',
  },
];

/** The worlds on offer in this build. */
export const WORLDS: WorldInfo[] = ALL_WORLDS.filter((w) => w.id !== 'lounge' || PENTHOUSE);

export function worldInfo(id: WorldName): WorldInfo {
  return WORLDS.find((w) => w.id === id) ?? WORLDS.find((w) => w.id === 'frostpeak')!;
}

let cached: WorldName | null = null;

/** The saved world: Frostpeak unless another was chosen. */
export function savedWorld(): WorldName {
  if (cached) return cached;
  try {
    const w = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').world;
    cached = WORLDS.some((x) => x.id === w) ? (w as WorldName) : 'frostpeak';
  } catch {
    cached = 'frostpeak';
  }
  return cached;
}

/** The world was switched in place (both worlds seat heroes, so no reload was needed). */
export function setSavedWorld(w: WorldName): void {
  cached = w;
}

/** Every world but the penthouse lounge seats stylized heroes; the lounge keeps its scanned people. */
export function useHeroes(): boolean {
  return savedWorld() !== 'lounge';
}

/** The three arenas (Wisteria Shrine, Midnight Domain, Celestial Arena). */
export function isArena(w: WorldName = savedWorld()): boolean {
  return w === 'shrine' || w === 'domain' || w === 'celestial';
}
