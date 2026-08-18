// src/pages/api/pdk-check.ts
import type { APIContext } from 'astro';
export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {

  // Cloudflare Pages runtime secrets (NOT import.meta.env — that's build-time only)
  const env = (context.locals as any).runtime?.env ?? {};
  const PDK_EMAIL     = env.PDK_EMAIL     ?? '';
  const PDK_PASSWORD  = env.PDK_PASSWORD  ?? '';
  const PDK_CLIENT_ID = env.PDK_CLIENT_ID ?? 'io.pdk.panel';
  const PDK_SYSTEM_ID = env.PDK_SYSTEM_ID ?? '';

  if (!PDK_EMAIL || !PDK_PASSWORD || !PDK_SYSTEM_ID) {
    return json({ ok: false, error: 'Server configuration error — missing env vars' }, 500);
  }

  const url = new URL(context.request.url);
  const q   = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json({ ok: false, error: 'Missing query parameter: q' }, 400);

  // ── STEP 1: Password grant → id_token ─────────────────────────────────────
  let idToken: string;
  try {
    const r1 = await fetch('https://accounts.pdk.io/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id:  PDK_CLIENT_ID,
        username:   PDK_EMAIL,
        password:   PDK_PASSWORD,
      }).toString(),
    });
    const t1 = await r1.text();
    if (!r1.ok) return json({ ok: false, error: `PDK auth failed (${r1.status})`, detail: t1 }, 502);
    const j1 = JSON.parse(t1);
    idToken = j1.id_token ?? j1.access_token ?? '';
    if (!idToken) return json({ ok: false, error: 'PDK auth: no token in response', detail: t1 }, 502);
  } catch (err: any) {
    return json({ ok: false, error: 'PDK auth request failed', detail: String(err) }, 502);
  }

  // ── STEP 2: Exchange for system-scoped token ───────────────────────────────
  let systemToken: string = idToken;
  try {
    const r2 = await fetch(`https://systems.pdk.io/${PDK_SYSTEM_ID}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({}),
    });
    if (r2.ok) {
      const j2 = JSON.parse(await r2.text());
      systemToken = j2.token ?? j2.access_token ?? idToken;
    }
    // If 404/405 — some PDK setups skip this step; fall back to idToken (already set above)
  } catch { /* fall back to idToken */ }

  // ── STEP 3: Search ─────────────────────────────────────────────────────────
  try {
    const r3 = await fetch(
      `https://systems.pdk.io/${PDK_SYSTEM_ID}/search?q=${encodeURIComponent(q)}`,
      { headers: { 'Authorization': `Bearer ${systemToken}`, 'Accept': 'application/json' } }
    );
    const t3 = await r3.text();
    if (!r3.ok) return json({ ok: false, error: `PDK search failed (${r3.status})`, detail: t3 }, 502);

    // Parse results — handle array, { data: [] }, or plain text
    let results: any[] = [];
    try {
      const p = JSON.parse(t3);
      if (Array.isArray(p))            results = p;
      else if (Array.isArray(p?.data)) results = p.data;
      else if (Array.isArray(p?.results)) results = p.results;
      else if (p && Object.keys(p).length > 0) results = [p];
    } catch {
      if (!t3.toLowerCase().includes('no matching') && t3.trim() && t3.trim() !== '[]') {
        results = [{ raw: t3 }];
      }
    }

    if (results.length === 0) return json({ ok: false, notFound: true, error: 'Card not found' }, 200);
    return json({ ok: true, count: results.length }, 200);

  } catch (err: any) {
    return json({ ok: false, error: 'PDK search request failed', detail: String(err) }, 502);
  }
}

function json(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
