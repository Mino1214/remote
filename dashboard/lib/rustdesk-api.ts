export type RustdeskDevice = {
  id: string;
  hostname?: string;
  lastSeenAt?: string;
  online?: boolean;
  ownerEmail?: string;
};

const baseUrl = process.env.RUSTDESK_API_BASE_URL || "http://rustdesk-api:21114";
const apiKey = process.env.RUSTDESK_API_KEY || "";

type JwtCache = { token: string; until: number };
let adminJwtCache: JwtCache | null = null;

async function rustdeskFetch(path: string, init?: RequestInit) {
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init?.headers || {});
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`RustDesk API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function tryFetchJson(path: string) {
  try {
    return await rustdeskFetch(path);
  } catch {
    return null;
  }
}

/** lejianwen/rustdesk-api 관리자 로그인 응답 (swagger admin.LoginPayload). */
type AdminLoginEnvelope = {
  code?: number;
  message?: string;
  data?: { token?: string };
};

/** lejianwen/rustdesk-api 관리자 피어 목록 (swagger model.PeerList). */
type PeerListEnvelope = {
  code?: number;
  message?: string;
  data?: {
    list?: PeerRow[];
    page?: number;
    page_size?: number;
    total?: number;
  };
};

type PeerRow = {
  id?: string;
  uuid?: string;
  hostname?: string;
  alias?: string;
  username?: string;
  last_online_time?: number;
  user?: { email?: string };
};

function mapPeerRow(p: PeerRow): RustdeskDevice {
  const id = String(p.uuid || p.id || "").trim();
  const hostname = (p.hostname || p.alias || p.username || "").trim() || undefined;
  const sec = typeof p.last_online_time === "number" ? p.last_online_time : 0;
  const lastSeenAt = sec > 0 ? new Date(sec * 1000).toISOString() : undefined;
  const online = sec > 0 && Date.now() / 1000 - sec < 180;
  const ownerEmail = p.user?.email?.trim() || undefined;
  return { id, hostname, lastSeenAt, online, ownerEmail };
}

async function getRustdeskAdminJwt(): Promise<string | null> {
  const now = Date.now();
  if (adminJwtCache && adminJwtCache.until > now + 15_000) {
    return adminJwtCache.token;
  }

  const username = process.env.RUSTDESK_ADMIN_USERNAME || "admin";
  const password =
    process.env.RUSTDESK_ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "";
  if (!password) {
    console.warn("[rustdesk-api] No ADMIN_INITIAL_PASSWORD / RUSTDESK_ADMIN_PASSWORD for admin JWT");
    return null;
  }

  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store"
  });

  const payload = (await res.json()) as AdminLoginEnvelope;
  if (payload.code !== 0 || !payload.data?.token) {
    console.error("[rustdesk-api] admin login failed", payload.code, payload.message);
    return null;
  }

  const ttlMs = Number(process.env.RUSTDESK_ADMIN_JWT_CACHE_MS || `${45 * 60 * 1000}`);
  adminJwtCache = { token: payload.data.token, until: now + ttlMs };
  return adminJwtCache.token;
}

/** lejianwen/rustdesk-api: Bearer 관리자 JWT + /api/admin/peer/list */
async function listDevicesViaAdminJwt(): Promise<RustdeskDevice[] | null> {
  const token = await getRustdeskAdminJwt();
  if (!token) return null;

  const url = `${baseUrl}/api/admin/peer/list?page=1&page_size=500`;
  const res = await fetch(url, {
    headers: {
      "api-token": token,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  });

  const payload = (await res.json()) as PeerListEnvelope;
  if (payload.code !== 0 || !payload.data?.list) {
    console.error("[rustdesk-api] admin peer list failed", payload.code, payload.message);
    return null;
  }

  return payload.data.list
    .map(mapPeerRow)
    .filter((d) => d.id.length > 0);
}

async function listDevicesLegacyCandidates(): Promise<RustdeskDevice[]> {
  const candidates = ["/api/devices", "/api/device/list", "/api/devices/list", "/api/admin/devices"];
  for (const path of candidates) {
    const payload = await tryFetchJson(path);
    if (!payload) continue;
    if (Array.isArray(payload)) return payload as RustdeskDevice[];
    if (Array.isArray((payload as { data?: unknown[] }).data)) {
      return (payload as { data: RustdeskDevice[] }).data;
    }
  }
  return [];
}

export type RustdeskAdapter = {
  listDevices: () => Promise<RustdeskDevice[]>;
};

const adapter: RustdeskAdapter = {
  async listDevices() {
    try {
      const viaJwt = await listDevicesViaAdminJwt();
      if (viaJwt !== null) {
        return viaJwt;
      }

      return await listDevicesLegacyCandidates();
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        return [
          {
            id: "100000001",
            hostname: "dev-mock-host",
            online: true,
            ownerEmail: "owner@example.com",
            lastSeenAt: new Date().toISOString()
          }
        ];
      }
      throw error;
    }
  }
};

export const rustdeskApi = adapter;
