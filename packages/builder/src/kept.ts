// What a browser keeps for itself in its local storage: the low-power switch, the measured
// strain, the 3D quality. A browser that cannot keep it still honours it for the session.

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for this session only.
  }
}

/** Unset: the key reads as never kept. */
export function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Forgotten for this session only.
  }
}
