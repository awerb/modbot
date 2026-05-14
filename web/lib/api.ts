// Client always talks to /api/* on the same origin; Next.js route handlers
// proxy to the FastAPI service (using API_INTERNAL_URL on the server).
export const API = "/api";

export async function jget(path: string) {
  const r = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}

export async function jpost(path: string, body: any) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
  return r.json();
}
