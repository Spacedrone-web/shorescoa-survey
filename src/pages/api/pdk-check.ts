// src/pages/api/pdk-check.ts
import type { APIRoute } from 'astro';

export const prerender = false;

const PDK_AUTH_URL    = 'https://accounts.pdk.io/oauth/token';
const PDK_SEARCH_BASE = 'https://systems.pdk.io';

export const GET: APIRoute = async ({ request }) => {
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    };

    try {
        const url  = new URL(request.url);
        const rfid = url.searchParams.get('q')?.trim();

        if (!rfid) {
            return new Response(
                JSON.stringify({ found: false, error: 'Missing q parameter' }),
                { status: 400, headers }
            );
        }

        const pdkEmail    = import.meta.env.PDK_EMAIL;
        const pdkPassword = import.meta.env.PDK_PASSWORD;
        const pdkClientId = import.meta.env.PDK_CLIENT_ID ?? 'io.pdk.panel';
        const pdkSystemId = import.meta.env.PDK_SYSTEM_ID;

        if (!pdkEmail || !pdkPassword || !pdkSystemId) {
            return new Response(
                JSON.stringify({ found: false, error: 'Server configuration error — missing env vars' }),
                { status: 500, headers }
            );
        }

        // ── FIX: OAuth2 password grant MUST be application/x-www-form-urlencoded (RFC 6749) ──
        const authBody = new URLSearchParams({
            grant_type : 'password',
            username   : pdkEmail,
            password   : pdkPassword,
            client_id  : pdkClientId,
        });

        const authRes = await fetch(PDK_AUTH_URL, {
            method  : 'POST',
            headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
            body    : authBody.toString(),
        });

        if (!authRes.ok) {
            const errText = await authRes.text().catch(() => '');
            console.error('[pdk-check] Auth failed:', authRes.status, errText.slice(0, 300));
            return new Response(
                JSON.stringify({ found: false, error: `PDK auth failed (${authRes.status})` }),
                { status: 502, headers }
            );
        }

        // PDK may return token as access_token, token, or id_token — handle all three
        const authData = await authRes.json() as Record<string, unknown>;
        const token = (
            authData.access_token ??
            authData.token        ??
            authData.id_token
        ) as string | undefined;

        if (!token) {
            console.error('[pdk-check] No token in response:', JSON.stringify(authData).slice(0, 300));
            return new Response(
                JSON.stringify({ found: false, error: 'No token returned from PDK' }),
                { status: 502, headers }
            );
        }

        // ── Search the PDK system ──────────────────────────────────────────────────
        const searchUrl = `${PDK_SEARCH_BASE}/${pdkSystemId}/search?q=${encodeURIComponent(rfid)}`;
        const searchRes = await fetch(searchUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept'       : 'application/json',
            },
        });

        if (!searchRes.ok) {
            console.error('[pdk-check] Search failed:', searchRes.status);
            return new Response(
                JSON.stringify({ found: false, error: `PDK search failed (${searchRes.status})` }),
                { status: 502, headers }
            );
        }

        // Determine found: JSON array with items = found; empty array or "no matching" text = not found
        const ct = searchRes.headers.get('content-type') ?? '';
        let found = false;

        if (ct.includes('application/json')) {
            const results = await searchRes.json();
            found = Array.isArray(results) ? results.length > 0 : Boolean(results);
        } else {
            const text = await searchRes.text();
            const lower = text.toLowerCase();
            found = !lower.includes('no matching') && text.trim().length > 0;
        }

        return new Response(JSON.stringify({ found }), { status: 200, headers });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[pdk-check] Unexpected error:', message);
        return new Response(
            JSON.stringify({ found: false, error: 'Internal server error' }),
            { status: 500, headers }
        );
    }
};
