import type { Logger } from "../types/index.js";
import type { Clock } from "./timing.js";

export function toModelSafeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}

export const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

/**
 * Runs an async task while measuring duration and logging success or failure.
 * Logs include duration_ms and, on failure, a normalized error object.
 */
export async function logTimed<T>(
  logger: Logger,
  clock: Clock,
  event: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
  level: "debug" | "info" | "warn" = "info",
): Promise<T> {
  const start = clock.nowMs();
  try {
    const result = await fn();
    const end = clock.nowMs();
    const durationMs = Math.max(0, end - start);
    logger[level](event, {
      ...meta,
      ok: true,
      duration_ms: durationMs,
      ...(clock.nowEpochMs ? { timestamp_epoch_ms: clock.nowEpochMs() } : {}),
    });
    return result;
  } catch (err) {
    const end = clock.nowMs();
    const durationMs = Math.max(0, end - start);
    logger.error(event, {
      ...meta,
      ok: false,
      duration_ms: durationMs,
      error: toModelSafeError(err),
      ...(clock.nowEpochMs ? { timestamp_epoch_ms: clock.nowEpochMs() } : {}),
    });
    throw err;
  }
}
