import { createContext, useContext } from 'react';
import { STANDARD_RULES } from '../engine/game';
import type { Rules } from '../engine/types';

export type BoardTheme = 'wood' | 'slate' | 'tournament' | 'marble' | 'midnight';
export type PieceStyle = 'solid' | 'classic' | 'letters';
export type TimePalette = 'violet' | 'colorblind' | 'neon';

/** Personal preferences, kept in this browser. */
export interface Settings {
  boardTheme: BoardTheme;
  pieceStyle: PieceStyle;
  timePalette: TimePalette;
  coords: boolean;
  animations: boolean;
  /** show dots for where the selected piece can go */
  hints: boolean;
  sound: boolean;
  /** how long the bot may think: 0.5 quick, 1 normal, 2 slow & strong */
  botPace: number;
  /** pass & play: turn the board to face whoever is moving */
  autoFlip: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  boardTheme: 'wood',
  pieceStyle: 'solid',
  timePalette: 'violet',
  coords: true,
  animations: true,
  hints: true,
  sound: true,
  botPace: 1,
  autoFlip: false,
};

const SETTINGS_KEY = '4d-chess.settings';
const HOUSE_KEY = '4d-chess.house-rules';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.) — preferences just won't persist
  }
}

export const loadSettings = () => read(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export function loadHouseRules(): Rules {
  const r = read<Rules>(HOUSE_KEY, STANDARD_RULES);
  return { ...r, ttl: { ...STANDARD_RULES.ttl, ...r.ttl } };
}
export const saveHouseRules = (r: Rules) => write(HOUSE_KEY, r);

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);
export const useSettings = () => useContext(SettingsContext);

/** True when a rule set differs from the standard rules. */
export function isStandard(r: Rules) {
  return JSON.stringify(r) === JSON.stringify(STANDARD_RULES);
}
