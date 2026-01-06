export type Clock = {
  nowMs: () => number;
  nowEpochMs?: () => number;
};

export function createDefaultClock(): Clock {
  const p = (globalThis as any).performance;
  const hasPerfNow = p && typeof p.now === "function";

  const nowMs = hasPerfNow
    ? () => p.now() as number
    : () => Date.now();

  const nowEpochMs = () => Date.now();

  return { nowMs, nowEpochMs };
}
