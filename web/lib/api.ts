// Client always talks to /api/* on the same origin; Next.js route handlers
// proxy to the FastAPI service (using API_INTERNAL_URL on the server).
export const API = "/api";

function adminHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const t = window.localStorage.getItem("ADMIN_TOKEN");
    return t ? { "X-Admin-Token": t } : {};
  } catch {
    return {};
  }
}

export function setAdminToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem("ADMIN_TOKEN", token);
    else window.localStorage.removeItem("ADMIN_TOKEN");
  } catch {}
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("ADMIN_TOKEN");
  } catch {
    return null;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

export async function jget<T = any>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
  const r = await withTimeout(
    fetch(`${API}${path}`, { cache: "no-store", headers: adminHeader() }),
    opts?.timeoutMs ?? 10000
  );
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}

export async function jpost<T = any>(path: string, body: any, opts?: { timeoutMs?: number }): Promise<T> {
  const r = await withTimeout(
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeader() },
      body: JSON.stringify(body),
      cache: "no-store",
    }),
    opts?.timeoutMs ?? 30000
  );
  if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
  return r.json();
}
