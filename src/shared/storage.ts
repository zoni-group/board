export function loadText(key: string, fallback?: string): string;
export function loadText(key: string, fallback: null): string | null;
export function loadText(key: string, fallback: string | null = ''): string | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function saveText(key: string, value: string): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export function hasStoredValue(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function loadBoolean(key: string, fallback = false): boolean {
  const value = loadText(key, null);
  return value === null ? fallback : value === 'true';
}

export function saveBoolean(key: string, value: boolean): void {
  saveText(key, String(Boolean(value)));
}

interface NumberOptions {
  parse?: (value: string) => number;
  validate?: (value: number) => boolean;
}

export function loadNumber(key: string, fallback = 0, options: NumberOptions = {}): number {
  const value = loadText(key, null);
  if (value === null || value === '') return fallback;

  const parse = typeof options.parse === 'function' ? options.parse : Number.parseFloat;
  const validate = typeof options.validate === 'function' ? options.validate : () => true;
  const parsed = parse(value);

  if (!Number.isFinite(parsed) || !validate(parsed)) {
    return fallback;
  }

  return parsed;
}

export function saveNumber(key: string, value: number): void {
  saveText(key, String(value));
}

export function loadJson(key: string, fallback: unknown = null): unknown {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return false;
    localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
