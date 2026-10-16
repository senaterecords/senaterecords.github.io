/** A site path with the deploy base in front: url("/senators/") -> "/ontherecord/senators/" under a project path. */
export function url(path: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}
