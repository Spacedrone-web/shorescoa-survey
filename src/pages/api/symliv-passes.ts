export const prerender = false;
import type { APIContext } from 'astro';

const API_ENDPOINT = 'https://8ftizrpawz.us-east-2.awsapprunner.com/graphql';
const COMMUNITY_ID = 'shoresofpanama';
const BASE_HEADERS: Record<string, string> = {
  'accept': '*/*', 'content-type': 'application/json',
  'Origin': 'https://client-admin.symliv.com',
  'Referer': 'https://client-admin.symliv.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
};

async function gql(query: string, variables: Record<string,any> = {}, token?: string): Promise<any> {
  const headers: Record<string,string> = { ...BASE_HEADERS };
  if (token) headers['authorization'] = 'Bearer ' + token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(API_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: ctrl.signal });
  } catch (e: any) { clearTimeout(timer); throw new Error('Network error: ' + String(e?.message ?? e)); }
  clearTimeout(timer);
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error('Symliv returned ' + resp.status + ': ' + text.slice(0, 120)); }
  if (json?.errors?.length) throw new Error(json.errors[0]?.message ?? JSON.stringify(json.errors));
  return json;
}

async function getCommunityToken(): Promise<string> {
  const r = await gql(`query getCommunityToken($communityId: String!) { getCommunityToken(communityId: $communityId) { success error token } }`, { communityId: COMMUNITY_ID });
  const p = r?.data?.getCommunityToken;
  if (!p?.success || !p?.token) throw new Error('getCommunityToken failed: ' + (p?.error ?? 'no token'));
  return p.token;
}

async function loginUser(email: string, password: string, communityToken: string): Promise<string> {
  const r = await gql(`query LoginUser($password: String!, $email: String!) { loginUser(password: $password, email: $email) { success error token data { userId firstName lastName email roles status } } }`, { email, password }, communityToken);
  const p = r?.data?.loginUser;
  if (!p?.success || !p?.token) throw new Error('loginUser failed: ' + (p?.error ?? 'no token'));
  return p.token;
}

async function fetchPasses(userToken: string): Promise<any[]> {
  const r = await gql(`query GetAllPasses { getAllPasses { success error data { paid status startDate endDate registrationId externalCredentialNumber communityRental { address } userInfo { firstName lastName email } passInfo { name } } } }`, {}, userToken);
  const p = r?.data?.getAllPasses;
  if (!p?.success) throw new Error('getAllPasses failed: ' + (p?.error ?? 'unknown'));
  return p?.data ?? [];
}

export async function GET({ request, cookies, locals }: APIContext) {
  const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (cookies.get('admin_auth')?.value !== 'shores-admin-ok') return json({ ok: false, error: 'Unauthorized' }, 401);
  const env = (locals as any).runtime?.env ?? {};
  const SYMLIV_EMAIL    = env.SYMLIV_EMAIL    ?? 'jim@shorescoa.com';
  const SYMLIV_PASSWORD = env.SYMLIV_PASSWORD ?? 'Chester12C';
  const url = new URL(request.url);
  const startBegin = url.searchParams.get('startBegin') ?? '';
  const startEnd   = url.searchParams.get('startEnd')   ?? '';
  try {
    const communityToken = await getCommunityToken();
    const userToken      = await loginUser(SYMLIV_EMAIL, SYMLIV_PASSWORD, communityToken);
    const passes         = await fetchPasses(userToken);
    const filtered = passes.filter((p: any) => {
      const d = (p.startDate ?? '').slice(0, 10);
      if (startBegin && d < startBegin) return false;
      if (startEnd   && d > startEnd)   return false;
      return true;
    });
    const rows = filtered.map((p: any) => ({
      firstName: p.userInfo?.firstName ?? '', lastName: p.userInfo?.lastName ?? '',
      email: p.userInfo?.email ?? '', unit: p.communityRental?.address ?? '',
      startDate: (p.startDate ?? '').slice(0, 10), endDate: (p.endDate ?? '').slice(0, 10),
      passType: p.passInfo?.name ?? '', status: p.status ?? '',
      paid: p.paid ?? false, registrationId: p.registrationId ?? '',
      credentialNumber: p.externalCredentialNumber ?? '',
    }));
    return json({ ok: true, rows });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
