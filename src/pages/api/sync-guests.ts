// src/pages/api/sync-guests.ts
export const prerender = false;
import type { APIContext } from "astro";

const API_ENDPOINT  = "https://8ftizrpawz.us-east-2.awsapprunner.com/graphql";
const COMMUNITY_ID  = "shoresofpanama";

const BASE_HEADERS: Record<string, string> = {
  accept: "*/*",
  "content-type": "application/json",
  Origin:  "https://client-admin.symliv.com",
  Referer: "https://client-admin.symliv.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
};

async function gql(
  query: string,
  variables: Record<string, any> = {},
  token?: string
): Promise<any> {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const resp = await fetch(API_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = (await resp.json()) as any;
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message ?? JSON.stringify(json.errors));
  }
  return json;
}

async function getCommunityToken(): Promise<string> {
  const result = await gql(
    `query getCommunityToken($communityId: String!) {
      getCommunityToken(communityId: $communityId) { success error token }
    }`,
    { communityId: COMMUNITY_ID }
  );
  const p = result?.data?.getCommunityToken;
  if (!p?.success || !p?.token)
    throw new Error(`getCommunityToken failed: ${p?.error ?? "no token"}`);
  return p.token;
}

async function loginUser(
  email: string,
  password: string,
  communityToken: string
): Promise<string> {
  const result = await gql(
    `query LoginUser($password: String!, $email: String!) {
      loginUser(password: $password, email: $email) {
        success error token
        data { userId firstName lastName email roles status }
      }
    }`,
    { email, password },
    communityToken
  );
  const p = result?.data?.loginUser;
  if (!p?.success || !p?.token)
    throw new Error(`loginUser failed: ${p?.error ?? "no token"}`);
  return p.token;
}

async function fetchPasses(userToken: string): Promise<any[]> {
  const result = await gql(
    `query GetAllPasses {
      getAllPasses {
        success error
        data {
          paid status startDate endDate createdAt registrationId
          externalCredentialNumber
          communityRental { address }
          userInfo { firstName lastName email }
          passInfo { name }
        }
      }
    }`,
    {},
    userToken
  );
  const p = result?.data?.getAllPasses;
  if (!p?.success)
    throw new Error(`getAllPasses failed: ${p?.error ?? "success=false"}`);
  return p?.data ?? [];
}

export async function POST({ cookies, locals }: APIContext) {
  const j = (d: any, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { "Content-Type": "application/json" },
    });

  if (cookies.get("admin_auth")?.value !== "shores-admin-ok")
    return j({ ok: false, error: "Unauthorized" }, 401);

  const env             = (locals as any).runtime?.env ?? {};
  const DB              = env.DB;
  const SYMLIV_EMAIL    = env.SYMLIV_EMAIL    ?? "jim@shorescoa.com";
  const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD ?? "Chester12C";

  if (!DB) return j({ ok: false, error: "DB binding not found" }, 500);

  // Ensure meta table exists (safe to call every time)
  await DB.prepare(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
  ).run();

  try {
    const communityToken = await getCommunityToken();
    const userToken      = await loginUser(SYMLIV_EMAIL, SYMLIV_PASSWORD, communityToken);
    const passes         = await fetchPasses(userToken);

    // Filter to active/confirmed passes only
    const filtered = passes.filter(
      (p: any) => p.status === "active" || p.status === "confirmed"
    );

    let inserted = 0, skipped = 0;

    for (const p of filtered) {
      const guestName = `${p.userInfo?.firstName ?? ""} ${p.userInfo?.lastName ?? ""}`.trim();
      const email     = p.userInfo?.email      ?? "";
      const arrival   = (p.startDate ?? "").slice(0, 10);
      const departure = (p.endDate   ?? "").slice(0, 10);
      const unit      = p.communityRental?.address ?? "";

      if (!arrival || !departure) { skipped++; continue; }

      // INSERT OR IGNORE — never overwrites existing rows (email_sent is safe)
      const result = await DB
        .prepare(
          "INSERT OR IGNORE INTO guests(guest_name,email,arrival,departure,unit) VALUES(?,?,?,?,?)"
        )
        .bind(guestName, email, arrival, departure, unit)
        .run();

      if (result.meta?.changes > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }

    // Write sync timestamp to meta — never touches guests table
    const now = new Date().toISOString();
    await DB
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_synced', ?)")
      .bind(now)
      .run();

    return j({ ok: true, inserted, skipped, total: filtered.length });
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
