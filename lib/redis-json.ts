/**
 * Upstash Redis auto-deserializes JSON on get(). Values may be a string or object
 * depending on how they were stored — never JSON.parse(object) directly.
 */
export function parseRedisValue<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as T;
  }
  return null;
}

export function parseRedisValueOrThrow<T>(value: unknown, label = "redis"): T {
  const parsed = parseRedisValue<T>(value);
  if (parsed == null) {
    throw new Error(`${label}: invalid or missing value`);
  }
  return parsed;
}
