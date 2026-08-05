export const prerender = false;
import type { APIContext } from "astro";

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const GQL = "https://8ftizrpawz.us-east-2.awsapprunner.com/graphql";
const COMMUNITY = "shoresofpanama";

async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(GQL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export async function POST({ request, cookies, locals }: APIContext) {
  const env = (locals as any).runtime?.env ?? {};
  const DB = env.DB;
  const SYNC_KEY = env.SYNC_KEY;
  const SYMLIV_EMAIL = env.SYMLIV_EMAIL;
  const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD;

  // ── Auth: accept admin cookie OR X-Sync-Key header (GitHub Actions) ──
  const syncKey = request.headers.get("X-Sync-Key");
  const isAdmin = cookies.get("admin_auth")?.value === "shores-admin-ok";
  const isAutoSync = !!(syncKey && SYNC_KEY && syncKey === SYNC_KEY);
  if (!isAdmin && !isAutoSync)
    return j({ ok: false, error: "Unauthorized" }, 401);

  if (!DB) return j({ ok: false, error: "DB binding missing" }, 500);

  try {
    // Safety: ensure meta table exists
    await DB.prepare(
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`
    ).run();

    // ── Step 1: community token ──
    const tokenData = await gql(
      `query getCommunityToken($communityId: String!) {
         getCommunityToken(communityId: $communityId) { token }
       }`,
      { communityId: COMMUNITY }
    );
    const communityToken = tokenData?.data?.getCommunityToken?.token;
    if (!communityToken)
      return j({ ok: false, error: "No community token returned" }, 502);

    // ── Step 2: login ──
    const loginData = await gql(
      `mutation loginUser($email: String!, $password: String!) {
         loginUser(email: $email, password: $password) { token }
       }`,
      { email: SYMLIV_EMAIL, password: SYMLIV_PASSWORD },
      communityToken
    );
    const userToken = loginData?.data?.loginUser?.token;
    if (!userToken)
      return j({ ok: false, error: "Symliv login failed" }, 502);

    // ── Step 3: fetch passes ──
    const passData = await gql(
      `query getPasses {
         getPasses {
           guestName
           guestEmail
           startDate
           endDate
           unit
           status
         }
       }`,
      {},
      userToken
    );
    const passes: any[] = passData?.data?.getPasses ?? [];

    // Filter active/confirmed passes only
    const filtered = passes.filter((p: any) =>
      ["active", "confirmed", "approved"].includes(
        (p.status ?? "").toLowerCase()
      )
    );

    // ── Step 4: INSERT OR IGNORE preserves existing email_sent values ──
    let inserted = 0,
      skipped = 0;
    for (const p of filtered) {
      try {
        const result = await DB.prepare(
          `INSERT OR IGNORE INTO guests(guest_name, email, arrival, departure, unit)
           VALUES(?, ?, ?, ?, ?)`
        )
          .bind(p.guestName, p.guestEmail, p.startDate, p.endDate, p.unit)
          .run();
        if ((result.meta?.changes ?? 0) > 0) inserted++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    // ── Step 5: update last_synced in meta ──
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT INTO meta(key, value) VALUES('last_synced', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
      .bind(now)
      .run();

    return j({
      ok: true,
      inserted,
      skipped,
      total: filtered.length,
      syncedAt: now,
    });
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
