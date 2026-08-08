export const prerender = false;
import type { APIContext } from "astro";

export async function GET({ locals }: APIContext) {
  const DB = (locals as any).runtime?.env?.DB;
  if (!DB) {
    return new Response(JSON.stringify({ ok: false, error: "DB not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const row = await DB.prepare("SELECT value FROM meta WHERE key=?")
      .bind("last_synced")
      .first();

    const lastSynced = (row as any)?.value ?? null;

    return new Response(JSON.stringify({ ok: true, lastSynced }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
