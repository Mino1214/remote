export type RustdeskDevice = {
  id: string;
  hostname?: string;
  lastSeenAt?: string;
  online?: boolean;
  ownerEmail?: string;
};

const baseUrl = process.env.RUSTDESK_API_BASE_URL || "http://rustdesk-api:21114";
const apiKey = process.env.RUSTDESK_API_KEY || "";

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

export type RustdeskAdapter = {
  listDevices: () => Promise<RustdeskDevice[]>;
};

const adapter: RustdeskAdapter = {
  async listDevices() {
    try {
      // TODO: Endpoint naming differs by rustdesk-api image builds.
      const candidates = ["/api/devices", "/api/device/list", "/api/devices/list", "/api/admin/devices"];
      for (const path of candidates) {
        const payload = await tryFetchJson(path);
        if (!payload) continue;
        if (Array.isArray(payload)) return payload;
        if (Array.isArray((payload as { data?: unknown[] }).data)) return (payload as { data: RustdeskDevice[] }).data;
      }

      // Endpoint is unavailable or unknown on this image build.
      return [];
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
