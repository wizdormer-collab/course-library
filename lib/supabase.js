const BUCKET = "courselib";
const CFG = {
  url: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  key: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
};

export function supabaseConfigured() {
  return !!(CFG.url && CFG.key);
}

async function supa(method, pathname, body, extra = {}) {
  const res = await fetch(CFG.url + pathname, {
    method,
    headers: {
      apikey: CFG.key,
      Authorization: "Bearer " + CFG.key,
      ...(body ? { "Content-Type": "application/octet-stream" } : {}),
      ...extra
    },
    body: body || undefined
  });
  return res;
}

export async function ensureBucket() {
  if (!supabaseConfigured()) return;
  try {
    const exists = await supa("GET", "/storage/v1/bucket/" + BUCKET);
    if (exists.status === 200) return;
  } catch {}
  try {
    await supa("POST", "/storage/v1/bucket", JSON.stringify({ id: BUCKET, name: BUCKET, public: false }), {
      "Content-Type": "application/json"
    });
  } catch {}
}

export async function supaPut(key, data) {
  if (!supabaseConfigured()) return;
  const r = await supa("POST", "/storage/v1/object/" + BUCKET + "/" + key, data, { "x-upsert": "true" });
  if (r.status !== 200) throw new Error("Supabase write failed (" + r.status + ")");
}

export async function supaGet(key) {
  if (!supabaseConfigured()) return null;
  const r = await supa("GET", "/storage/v1/object/" + BUCKET + "/" + key);
  if (r.status !== 200) return null;
  return await r.text();
}

export async function supaGetBuf(key) {
  if (!supabaseConfigured()) return null;
  const r = await supa("GET", "/storage/v1/object/" + BUCKET + "/" + key);
  if (r.status !== 200) return null;
  return Buffer.from(await r.arrayBuffer());
}

export async function supaDelete(key) {
  if (!supabaseConfigured()) return;
  try {
    await supa("DELETE", "/storage/v1/object/" + BUCKET + "/" + key);
  } catch {}
}
