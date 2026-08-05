export const prerender = false;
import type { APIContext } from "astro";
const OK = "shores-admin-ok";
const j  = (d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json"}});

export async function GET({cookies,locals}:APIContext){
  if (cookies.get("admin_auth")?.value!==OK) return j({ok:false,error:"Unauthorized"},401);
  const DB=(locals as any).runtime?.env?.DB;
  if (!DB) return j({ok:false,error:"DB not configured"},500);
  try {
    const {results} = await DB.prepare(`
      SELECT * FROM guests
      ORDER BY CAST(SUBSTR(unit,1,CASE WHEN INSTR(unit," ")>0 THEN INSTR(unit," ")-1 ELSE LENGTH(unit) END) AS INTEGER) ASC,
               arrival ASC
    `).all();
    return j({ok:true,guests:results});
  } catch(e:any){ return j({ok:false,error:String(e?.message??e)},500); }
}

export async function PATCH({request,cookies,locals}:APIContext){
  if (cookies.get("admin_auth")?.value!==OK) return j({ok:false,error:"Unauthorized"},401);
  const DB=(locals as any).runtime?.env?.DB;
  if (!DB) return j({ok:false,error:"DB not configured"},500);
  try {
    const {id,emailSent}=await request.json() as {id:number;emailSent:string};
    await DB.prepare("UPDATE guests SET email_sent=? WHERE id=?").bind(emailSent,id).run();
    return j({ok:true});
  } catch(e:any){ return j({ok:false,error:String(e?.message??e)},500); }
}
