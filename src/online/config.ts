/** Online play needs a Firebase project (or the local emulators). Without one, the option is disabled. */
export const useEmulators = import.meta.env.VITE_FIREBASE_EMULATORS === '1';
export const onlineAvailable = useEmulators || !!import.meta.env.VITE_FIREBASE_API_KEY;

const NAME_KEY = '4d-chess.name';
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* not persisted */
  }
}
