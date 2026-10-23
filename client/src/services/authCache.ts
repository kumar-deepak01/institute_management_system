import type { Account } from '../types/api';

type CurrentAccountResult = { account: Account };
const cacheDurationMs = 30_000;
let cached: { value: CurrentAccountResult; expiresAt: number } | null = null;
let pending: Promise<CurrentAccountResult> | null = null;
let generation = 0;

export function clearCurrentAccountCache() {
  generation += 1;
  cached = null;
  pending = null;
}

export function loadCurrentAccount(loader: () => Promise<CurrentAccountResult>) {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (pending) return pending;

  const requestGeneration = generation;
  const request = loader();
  pending = request;
  void request.then(value => {
    if (generation === requestGeneration) cached = { value, expiresAt: Date.now() + cacheDurationMs };
  }, () => undefined).finally(() => {
    if (pending === request) pending = null;
  });
  return request;
}
