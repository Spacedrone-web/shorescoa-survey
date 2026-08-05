// src/pages/api/guests.ts
export const prerender = false;
import type { APIContext } from "astro";

const j = (d: any, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json" },
  });

/* ── GET — list all guests + last_synced from meta ── */
export async function GET({ cookies, locals }: APIContext) {
  if (cookies.get("admin_auth")?.value !== "shores-admin-ok")
    return j({ ok: false, error: "Unauthorized" }, 401);

  const env = (locals as any).runtime?.env ?? {};
  const DB  = env.DB;
  if (!DB) return j({ ok: false, error: "DB binding not found" }, 500);

  try {
    // Ensure meta table exists so this never crashes even on a fresh DB
    await DB.prepare(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
    ).run();

    const { results: guests } = await DB
      .prepare("SELECT * FROM guests ORDER BY arrival ASC, guest_name ASC")
      .all();

    const metaRow = await DB
      .prepare("SELECT value FROM meta WHERE key = 'last_synced'")
      .first();

    return j({ ok: true, guests: guests ?? [], lastSynced: metaRow?.value ?? null });
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

/* ── PATCH — update email_sent for one guest ── */
export async function PATCH({ request, cookies, locals }: APIContext) {
  if (cookies.get("admin_auth")?.value !== "shores-admin-ok")
    return j({ ok: false, error: "Unauthorized" }, 401);

  const env = (locals as any).runtime?.env ?? {};
  const DB  = env.DB;
  if (!DB) return j({ ok: false, error: "DB binding not found" }, 500);

  try {
    const { id, emailSent } = (await request.json()) as {
      id: number;
      emailSent: string;
    };
    if (!id) return j({ ok: false, error: "Missing id" }, 400);

    await DB
      .prepare("UPDATE guests SET email_sent = ? WHERE id = ?")
      .bind(emailSent, id)
      .run();

    return j({ ok: true });
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
