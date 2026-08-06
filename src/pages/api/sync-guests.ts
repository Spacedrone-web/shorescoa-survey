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
    // ── Ensure tables exist ───────────────────────────────────────
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS guests (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_name TEXT,
        email      TEXT,
        arrival    TEXT,
        departure  TEXT,
        unit       TEXT,
        email_sent TEXT DEFAULT 'no',
        createdAt  TEXT
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

    // Ensure createdAt column exists (safe if already present)
    await DB.prepare(`ALTER TABLE guests ADD COLUMN createdAt TEXT`).run()
      .catch(() => {/* column may already exist */});

    // ── Symliv auth ──────────────────────────────────────────────
    const SYMLIV_EMAIL    = env.SYMLIV_EMAIL    ?? '';
    const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD ?? '';
    const GQL = 'https://8ftizrpawz.us-east-2.awsapprunner.com/graphql';

    // Step 1: community token
    const tokenRes  = await fetch(GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query getCommunityToken($communityId: String!) {
          getCommunityToken(communityId: $communityId) {
            success
            error
            token
          }
        }`,
        variables: { communityId: "shoresofpanama" },
        operationName: "getCommunityToken"
      })
    });

    const tokenData = await tokenRes.json();
    const communityToken = tokenData?.data?.getCommunityToken?.token;
    if (!communityToken) return j({ ok: false, error: 'Failed to get community token' }, 500);

    // Step 2: user token
    const loginRes  = await fetch(GQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${communityToken}`
      },
      body: JSON.stringify({
        query: `query LoginUser($password: String!, $email: String!) {
          loginUser(password: $password, email: $email) {
            success
            error
            token
            data {
              userId
              communityCode
              firstName
              lastName
              email
              roles
              phoneNumber
              status
            }
          }
        }`,
        variables: { email: SYMLIV_EMAIL, password: SYMLIV_PASSWORD },
        operationName: "LoginUser"
      })
    });

    const loginData = await loginRes.json();
    const userToken = loginData?.data?.loginUser?.token;
    if (!userToken) return j({ ok: false, error: 'Symliv login failed' }, 500);

    // Step 3: fetch all passes (correct archive schema + createdAt)
    const passRes  = await fetch(GQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({
        query: `query GetAllPasses {
          getAllPasses {
            success
            error
            data {
              paid
              startDate
              endDate
              createdAt
              communityRental { address }
              userInfo { firstName lastName email }
              passInfo { name }
            }
          }
        }`,
        operationName: "GetAllPasses"
      })
    });

    const passData = await passRes.json();
    const passes   = passData?.data?.getAllPasses?.data ?? [];

    // Filter: only paid passes (archive behavior)
    const filtered = passes.filter((p: any) => p.paid === true || p.paid === "true");

    // ── INSERT OR IGNORE — never overwrites email_sent ───────────
    let inserted = 0, skipped = 0;

    for (const p of filtered) {
      try {
        const guestName = `${p.userInfo?.firstName ?? ''} ${p.userInfo?.lastName ?? ''}`.trim();
        const email     = p.userInfo?.email ?? '';
        const arrival   = p.startDate ?? '';
        const departure = p.endDate ?? '';
        const unit      = p.communityRental?.address ?? '';
        const createdAt = p.createdAt ?? '';

        const result = await DB.prepare(
          `INSERT OR IGNORE INTO guests(guest_name, email, arrival, departure, unit, createdAt)
           VALUES(?, ?, ?, ?, ?, ?)`
        ).bind(guestName, email, arrival, departure, unit, createdAt).run();

        if ((result.meta?.changes ?? 0) > 0) inserted++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    // ── Write last_synced timestamp ───────────────────────────────
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT OR REPLACE INTO meta(key, value) VALUES('last_synced', ?)`
    ).bind(now).run();

    return j({ ok: true, inserted, skipped, total: filtered.length, last_synced: now });

  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
