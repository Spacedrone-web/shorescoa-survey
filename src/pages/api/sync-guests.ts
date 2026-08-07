export const prerender = false;
import type { APIContext } from "astro";

const GQL  = "https://8ftizrpawz.us-east-2.awsapprunner.com/graphql";
const COMM = "shoresofpanama";

const HDR: Record<string,string> = {
  "accept":"*/*",
  "content-type":"application/json",
  "Origin":"https://client-admin.symliv.com",
  "Referer":"https://client-admin.symliv.com/",
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0 Safari/537.36",
};

// ---------------------------------------------------------
// Generic GraphQL helper
// ---------------------------------------------------------
async function gql(query: string, variables: Record<string,any>={}, token?: string): Promise<any> {
  const headers = { ...HDR };
  if (token) headers["authorization"] = "Bearer " + token;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);

  let resp: Response;
  try {
    resp = await fetch(GQL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal
    });
  } catch (err: any) {
    clearTimeout(timeout);
    throw new Error("Network error: " + String(err?.message ?? err));
  }

  clearTimeout(timeout);

  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Symliv " + resp.status + ": " + text.slice(0,120));
  }

  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message ?? JSON.stringify(json.errors));
  }

  return json;
}

// ---------------------------------------------------------
// Token helpers
// ---------------------------------------------------------
async function getCommunityToken(): Promise<string> {
  const r = await gql(
    `query getCommunityToken($c:String!){
      getCommunityToken(communityId:$c){success error token}
    }`,
    { c: COMM }
  );

  const p = r?.data?.getCommunityToken;
  if (!p?.success || !p?.token) {
    throw new Error("getCommunityToken: " + (p?.error ?? "no token"));
  }

  return p.token;
}

async function loginUser(email: string, password: string, communityToken: string): Promise<string> {
  const r = await gql(
    `query LoginUser($p:String!,$e:String!){
      loginUser(password:$p,email:$e){success error token}
    }`,
    { p: password, e: email },
    communityToken
  );

  const d = r?.data?.loginUser;
  if (!d?.success || !d?.token) {
    throw new Error("loginUser: " + (d?.error ?? "no token"));
  }

  return d.token;
}

// ---------------------------------------------------------
// Fetch passes (modern schema)
// ---------------------------------------------------------
async function fetchPasses(userToken: string): Promise<any[]> {
  const r = await gql(
    `query GetAllPasses {
      getAllPasses {
        success error
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
    {},
    userToken
  );

  const p = r?.data?.getAllPasses;
  if (!p?.success) {
    throw new Error("getAllPasses: " + (p?.error ?? "fail"));
  }

  return p?.data ?? [];
}

// ---------------------------------------------------------
// Main sync endpoint
// ---------------------------------------------------------
export async function POST({ request, cookies, locals }: APIContext) {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" }
    });

  const env = (locals as any).runtime?.env ?? {};
  const DB  = env.DB;

  const cookieOk = cookies.get("admin_auth")?.value === "shores-admin-ok";
  const keyOk    = (env.SYNC_KEY ?? "") &&
                   request.headers.get("X-Sync-Key") === (env.SYNC_KEY ?? "");

  if (!cookieOk && !keyOk) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!DB) {
    return json({ ok: false, error: "DB not configured" }, 500);
  }

  try {
    // Step 1: Tokens
    const communityToken = await getCommunityToken();
    const userToken = await loginUser(
      env.SYMLIV_EMAIL ?? "jim@shorescoa.com",
      env.SYMLIV_PASSWORD ?? "Chester12C",
      communityToken
    );

    // Step 2: Fetch passes
    const passes = await fetchPasses(userToken);

    // Step 3: Filter passes
    const filtered = passes.filter((p: any) =>
      p.passInfo?.name === "Registration Fee" &&
      ["paid", "ach-pending"].includes(p.paid)
    );

    let inserted = 0;
    let skipped  = 0;

    // Step 4: Insert into D1
    for (const p of filtered) {
      const name  = `${p.userInfo?.firstName ?? ""} ${p.userInfo?.lastName ?? ""}`.trim();
      const email = p.userInfo?.email ?? "";
      const arr   = (p.startDate ?? "").slice(0, 10);
      const dep   = (p.endDate ?? "").slice(0, 10);
      const unit  = p.communityRental?.address ?? "";

      // FIX: Always store createdAt
      const createdAt =
        p.createdAt
          ? p.createdAt.slice(0, 19) // normalize
          : new Date().toISOString(); // fallback

      if (!email || !arr) {
        skipped++;
        continue;
      }

      try {
        await DB.prepare(
          `INSERT INTO guests (guest_name, email, arrival, departure, unit, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             guest_name = excluded.guest_name,
             arrival    = excluded.arrival,
             departure  = excluded.departure,
             unit       = excluded.unit,
             createdAt  = excluded.createdAt,
             synced_at  = datetime('now')`
        )
        .bind(name, email, arr, dep, unit, createdAt)
        .run();

        inserted++;
      } catch (err: any) {
        if (String(err?.message ?? "").includes("UNIQUE")) {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return json({
      ok: true,
      inserted,
      skipped,
      total: filtered.length
    });

  } catch (err: any) {
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
