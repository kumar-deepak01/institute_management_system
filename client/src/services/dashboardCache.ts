const cacheDurationMs = 20_000;
let cachedDashboard: { value: unknown; expiresAt: number } | null = null;
let pendingDashboard: Promise<unknown> | null = null;

export function clearDashboardCache() {
  cachedDashboard = null;
  pendingDashboard = null;
}

export function loadDashboardCached<T>(loader: () => Promise<T>, forceFresh = false): Promise<T> {
  if (!forceFresh && cachedDashboard && cachedDashboard.expiresAt > Date.now()) {
    return Promise.resolve(cachedDashboard.value as T);
  }
  if (!forceFresh && pendingDashboard) {
    return pendingDashboard as Promise<T>;
  }
  const request = loader();
  pendingDashboard = request;
  request.then(value => {
    cachedDashboard = { value, expiresAt: Date.now() + cacheDurationMs };
  }, () => {
    cachedDashboard = null;
  }).finally(() => {
    if (pendingDashboard === request) pendingDashboard = null;
  });
  return request;
}

