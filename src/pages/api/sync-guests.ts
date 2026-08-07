export const prerender = false;
import type { APIContext } from "astro";

const GQL = "https://8ftizrpawz.us-east-2.awsapprunner.com/graphql";
const COMM = "shoresofpanama";

const HDR: Record<string, string> = {
  accept: "*/*",
  "content-type": "application/json",
  Origin: "https://client-admin.symliv.com",
  Referer: "https://client-admin.symliv.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0 Safari/537.36",
};

// ---------------------------------------------------------
// DATE NORMALIZER (FINAL FIX)
// ---------------------------------------------------------
function normalizeDate(raw: string): string {
  if (!raw) return "";

  // Case 1: Symliv UI format "6-Aug-26"
  const symlivPattern = /^(\d{1,2})-(\w{3})-(\d{2})$/;
  if (symlivPattern.test(raw)) {
    const [_, d, mon, yy] = raw.match(symlivPattern)!;

    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04",
      May: "05", Jun: "06", Jul: "07", Aug: "08",
      Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };

    const mm = months[mon];
    const yyyy = "20" + yy;

    return `${yyyy}-${mm}-${d.padStart(2, "0")}`;
  }

  // Case 2: ISO timestamp "2026-08-05T12:33:47.277Z"
  const dt = new Date(raw);
  if (!isNaN(dt.getTime())) {
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  // Case 3: Already normalized
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  return "";
}

// ---------------------------------------------------------
// SAFE GRAPHQL WRAPPER
// ---------------------------------------------------------
async function gqlSafe(
  query: string,
  variables: Record<string, any> = {},
  token?: string
): Promise<any> {
  const headers = { ...HDR };
  if (token) headers["authorization"] = "Bearer " + token;

  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 8000;

  let lastError: any = null;
  let attempts = 0;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts++;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(GQL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });

      clearTimeout(timeout);

      const text = await resp.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `Symliv ${resp.status}: ${text.slice(0, 120)} (invalid JSON)`
        );
      }

      if (json?.errors?.length) {
        throw new Error(json.errors[0]?.message ?? JSON.stringify(json.errors));
      }

      return json;
    } catch (err: any) {
      clearTimeout(timeout);
      lastError = err;

      if (attempt === MAX_RETRIES) {
        return {
          data: {
            getAllPasses: {
              success: true,
              error: null,
              data: [],
            },
          },
          fallback: true,
          attempts,
          lastError: String(lastError?.message ?? lastError),
        };
      }

      await new Promise((res) => setTimeout(res, attempt * 500));
    }
  }

  throw new Error("Unexpected gqlSafe exit");
}

// ---------------------------------------------------------
// Token helpers
// ---------------------------------------------------------
async function getCommunityToken(): Promise<string> {
  const r = await gqlSafe(
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

async function loginUser(
  email: string,
  password: string,
  communityToken: string
): Promise<string> {
  const r = await gqlSafe(
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
// Fetch passes
// ---------------------------------------------------------
async function fetchPasses(userToken: string): Promise<any[]> {
  const r = await gqlSafe(
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

  if (r.fallback) return [];

  const p = r?.data?.getAllPasses;
  if (!p?.success) throw new Error("getAllPasses failed");

  return p?.data ?? [];
}

// ---------------------------------------------------------
// Main sync endpoint
// ---------------------------------------------------------
export async function POST({ request, cookies, locals }: APIContext) {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const env = (locals as any).runtime?.env ?? {};
  const DB = env.DB;

  const cookieOk = cookies.get("admin_auth")?.value === "shores-admin-ok";
  const keyOk =
    (env.SYNC_KEY ?? "") &&
    request.headers.get("X-Sync-Key") === (env.SYNC_KEY ?? "");

  if (!cookieOk && !keyOk) return json({ ok: false, error: "Unauthorized" }, 401);
  if (!DB) return json({ ok: false, error: "DB not configured" }, 500);

  try {
    const communityToken = await getCommunityToken();
    const userToken = await loginUser(
      env.SYMLIV_EMAIL ?? "jim@shorescoa.com",
      env.SYMLIV_PASSWORD ?? "Chester12C",
      communityToken
    );

    const passes = await fetchPasses(userToken);

    const filtered = passes.filter((p: any) => {
      const name = (p.passInfo?.name ?? "").toLowerCase();
      const paid = (p.paid ?? "").toLowerCase();
      return (
        name.includes("registration") &&
        (paid.includes("paid") || paid.includes("ach"))
      );
    });

    const CHUNK = 25;
    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    let chunks = 0;

    for (let i = 0; i < filtered.length; i += CHUNK) {
      chunks++;
      const slice = filtered.slice(i, i + CHUNK);

      for (const p of slice) {
        const name = `${p.userInfo?.firstName ?? ""} ${
          p.userInfo?.lastName ?? ""
        }`.trim();
        const email = p.userInfo?.email ?? "";

        const arrival = normalizeDate(p.startDate);
        const dep = normalizeDate(p.endDate);
        const unit = p.communityRental?.address ?? "";
        const createdAt = normalizeDate(p.createdAt);

        if (!email || !arrival) {
          skipped++;
          continue;
        }

        try {
          const result = await DB.prepare(
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
            .bind(name, email, arrival, dep, unit, createdAt)
            .run();

          if (result.success && result.meta?.changed_db) {
            inserted++;
          } else {
            updated++;
          }
        } catch (err: any) {
          if (String(err?.message ?? "").includes("UNIQUE")) {
            skipped++;
          } else {
            throw err;
          }
        }
      }
    }

    return json({
      ok: true,
      inserted,
      updated,
      skipped,
      chunks,
      total: filtered.length,
    });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
