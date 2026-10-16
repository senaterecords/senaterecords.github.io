// JSON files fetched in the browser, kept in memory after they load. A failed request is forgotten, so the next
// attempt asks again instead of reusing the failure.

export function jsonCache(resolve: (path: string) => string) {
  const cache = new Map<string, Promise<unknown>>();
  return <T,>(path: string): Promise<T> => {
    if (!cache.has(path)) {
      const request = fetch(resolve(path)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
      request.catch(() => cache.delete(path));
      cache.set(path, request);
    }
    return cache.get(path) as Promise<T>;
  };
}
