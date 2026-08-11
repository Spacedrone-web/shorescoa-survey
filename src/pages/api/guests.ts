export const prerender = false;
import type { APIContext } from 'astro';

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/* ── GET — list all guests + lastSynced from meta ── */
export async function GET({ cookies, locals }: APIContext) {
  if (cookies.get('admin_auth')?.value !== 'shores-admin-ok')
    return j({ ok: false, error: 'Unauthorized' }, 401);

  const DB = (locals as any).runtime?.env?.DB;
  if (!DB) return j({ ok: false, error: 'DB binding missing' }, 500);

  try {
    // Correct table definition
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS guests (
        passId      TEXT PRIMARY KEY,
        guest_name  TEXT,
        email       TEXT,
        unit        TEXT,
        created     TEXT,
        arrival     TEXT,
        departure   TEXT,
        email_sent  TEXT DEFAULT 'no'
      )
    `).run();

    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();

    // Fetch all guests
    const { results: guests } = await DB.prepare(
      `SELECT passId, guest_name, email, arrival, departure, unit, email_sent
       FROM guests
       ORDER BY departure DESC, guest_name ASC`
    ).all();

    // Fetch last_synced timestamp
    const metaRow = await DB.prepare(
      `SELECT value FROM meta WHERE key = 'last_synced'`
    ).first();

    const lastSynced: string | null = metaRow?.value ?? null;

    return j({
      ok: true,
      lastSynced,
      guests: guests ?? []
    });

  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

/* ── PATCH — update email_sent for one guest ── */
export async function PATCH({ request, cookies, locals }: APIContext) {
  if (cookies.get('admin_auth')?.value !== 'shores-admin-ok')
    return j({ ok: false, error: 'Unauthorized' }, 401);

  const DB = (locals as any).runtime?.env?.DB;
  if (!DB) return j({ ok: false, error: 'DB binding missing' }, 500);

  try {
    const { passId, emailSent } = await request.json() as {
      passId: string;
      emailSent: string;
    };

    await DB.prepare(
      `UPDATE guests SET email_sent = ? WHERE passId = ?`
    ).bind(emailSent, passId).run();

    return j({ ok: true });

  } catch (err: any) {
    return j({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
