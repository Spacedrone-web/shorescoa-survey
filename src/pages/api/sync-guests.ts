export const prerender = false;
import type { APIContext } from 'astro';

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST({ request, cookies, locals }: APIContext) {
  // Dual auth: browser cookie OR GitHub Actions X-Sync-Key header
  const cookieOk = cookies.get('admin_auth')?.value === 'shores-admin-ok';
  const syncKey  = (locals as any).runtime?.env?.SYNC_KEY ?? '';
  const headerOk = syncKey && request.headers.get('X-Sync-Key') === syncKey;
  if (!cookieOk && !headerOk) return j({ ok: false, error: 'Unauthorized' }, 401);

  const env = (locals as any).runtime?.env;
  const DB  = env?.DB;
  if (!DB) return j({ ok: false, error: 'DB binding missing' }, 500);

  try {
    // Ensure tables exist
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS guests (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_name TEXT,
        email      TEXT,
        arrival    TEXT,
        departure  TEXT,
        unit       TEXT,
        email_sent TEXT DEFAULT 'no'
      )
    `).run();

    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();

    await DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_dedup ON guests(email, arrival, departure)
    `).run().catch(() => {/* index may already exist */});

    // ── Symliv auth ──────────────────────────────────────────────
    const SYMLIV_EMAIL    = env.SYMLIV_EMAIL    ?? '';
    const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD ?? '';
    const GQL = 'https://8ftizrpawz.us-east-2.awsapprunner.com/graphql';

    // Step 1: community token
    const tokenRes  = await fetch(GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query { getCommunityToken(communityId: "shoresofpanama") }`
      })
    });
    const tokenData = await tokenRes.json() as any;
    const communityToken = tokenData?.data?.getCommunityToken?.token;
    if (!communityToken) return j({ ok: false, error: 'Failed to get community token' }, 500);

    // Step 2: user token
    const loginRes  = await fetch(GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${communityToken}` },
      body: JSON.stringify({
        query: `mutation {
          loginUser(email: "${SYMLIV_EMAIL}", password: "${SYMLIV_PASSWORD}") { token }
        }`
      })
    });
    const loginData = await loginRes.json() as any;
    const userToken = loginData?.data?.loginUser?.token;
    if (!userToken) return j({ ok: false, error: 'Symliv login failed' }, 500);

    // Step 3: fetch all passes
    const passRes  = await fetch(GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({
        query: `query {
          getAllPasses(communityId: "shoresofpanama") {
            id guestName email arrivalDate departureDate unit status
          }
        }`
      })
    });
    const passData = await passRes.json() as any;
    const passes   = passData?.data?.getAllPasses ?? [];

    // Filter to active/confirmed/approved only
    const filtered = passes.filter((p: any) =>
      ['active', 'confirmed', 'approved'].includes((p.status ?? '').toLowerCase())
    );

    // ── INSERT OR IGNORE — never overwrites email_sent ───────────
    let inserted = 0, skipped = 0;
    for (const p of filtered) {
      try {
        const result = await DB.prepare(
          `INSERT OR IGNORE INTO guests(guest_name, email, arrival, departure, unit)
           VALUES(?, ?, ?, ?, ?)`
        ).bind(
          p.guestName     ?? p.guest_name   ?? '',
          p.email         ?? '',
          p.arrivalDate   ?? p.arrival      ?? '',
          p.departureDate ?? p.departure    ?? '',
          p.unit          ?? ''
        ).run();
        if ((result.meta?.changes ?? 0) > 0) inserted++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    // ── Write last_synced timestamp to meta ──────────────────────
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT OR REPLACE INTO meta(key, value) VALUES('last_synced', ?)`
    ).bind(now).run();

    return j({ ok: true, inserted, skipped, total: filtered.length, last_synced: now });

  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

