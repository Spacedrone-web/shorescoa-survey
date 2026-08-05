export const prerender = false;
import type { APIContext } from "astro";

const GQL  = "https://8ftizrpawz.us-east-2.awsapprunner.com/graphql";
const COMM = "shoresofpanama";
const HDR: Record<string,string> = {
  "accept":"*/*","content-type":"application/json",
  "Origin":"https://client-admin.symliv.com",
  "Referer":"https://client-admin.symliv.com/",
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0 Safari/537.36",
};

async function gql(q: string, vars: Record<string,any>={}, tok?: string): Promise<any> {
  const h = {...HDR}; if (tok) h["authorization"] = "Bearer "+tok;
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 20000);
  let r: Response;
  try { r = await fetch(GQL,{method:"POST",headers:h,body:JSON.stringify({query:q,variables:vars}),signal:ctrl.signal}); }
  catch(e:any){ clearTimeout(t); throw new Error("Network: "+String(e?.message??e)); }
  clearTimeout(t);
  const txt = await r.text(); let j:any;
  try { j = JSON.parse(txt); } catch { throw new Error("Symliv "+r.status+": "+txt.slice(0,120)); }
  if (j?.errors?.length) throw new Error(j.errors[0]?.message??JSON.stringify(j.errors));
  return j;
}

async function commToken(): Promise<string> {
  const r = await gql(`query getCommunityToken($c:String!){getCommunityToken(communityId:$c){success error token}}`,{c:COMM});
  const p = r?.data?.getCommunityToken;
  if (!p?.success||!p?.token) throw new Error("commToken: "+(p?.error??"no token"));
  return p.token;
}

async function login(email:string, pass:string, ct:string): Promise<string> {
  const r = await gql(`query LoginUser($p:String!,$e:String!){loginUser(password:$p,email:$e){success error token}}`,{p:pass,e:email},ct);
  const d = r?.data?.loginUser;
  if (!d?.success||!d?.token) throw new Error("login: "+(d?.error??"no token"));
  return d.token;
}

async function fetchPasses(tok:string): Promise<any[]> {
  const r = await gql(`
    query GetAllPasses {
      getAllPasses {
        success error
        data {
          paid startDate endDate
          communityRental { address }
          userInfo { firstName lastName email }
          passInfo { name }
        }
      }
    }`,{},tok);
  const p = r?.data?.getAllPasses;
  if (!p?.success) throw new Error("getAllPasses: "+(p?.error??"fail"));
  return p?.data??[];
}

export async function POST({request,cookies,locals}:APIContext){
  const j=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json"}});
  const env=(locals as any).runtime?.env??{};
  const cookieOk = cookies.get("admin_auth")?.value==="shores-admin-ok";
  const keyOk    = (env.SYNC_KEY??"") && request.headers.get("X-Sync-Key")===(env.SYNC_KEY??"");
  if (!cookieOk&&!keyOk) return j({ok:false,error:"Unauthorized"},401);
  const DB = env.GUEST_DB;
  if (!DB) return j({ok:false,error:"DB not configured"},500);
  try {
    const ct = await commToken();
    const ut = await login(env.SYMLIV_EMAIL??"jim@shorescoa.com", env.SYMLIV_PASSWORD??"Chester12C", ct);
    const passes = await fetchPasses(ut);
    const filtered = passes.filter((p:any)=>
      p.passInfo?.name==="Registration Fee" &&
      ["paid","ach-pending"].includes(p.paid)
    );
    let inserted=0, skipped=0;
    for (const p of filtered){
      const name  = [p.userInfo?.firstName??"",p.userInfo?.lastName??""].join(" ").trim();
      const email = p.userInfo?.email??"";
      const arr   = (p.startDate??"").slice(0,10);
      const dep   = (p.endDate??"").slice(0,10);
      const unit  = p.communityRental?.address??"";
      if (!email||!arr){skipped++;continue;}
      try {
        await DB.prepare("INSERT INTO guests(guest_name,email,arrival,departure,unit) VALUES(?,?,?,?,?)")
          .bind(name,email,arr,dep,unit).run();
        inserted++;
      } catch(e:any){
        if (String(e?.message??"").includes("UNIQUE")) skipped++;
        else throw e;
      }
    }
    return j({ok:true,inserted,skipped,total:filtered.length});
  } catch(err:any){ return j({ok:false,error:String(err?.message??err)},500); }
}


