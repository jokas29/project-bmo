import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

// Read-only production catalog bridge. Returns only approved, selected items
// to the exact DropEC GitHub Actions workflow; never exposes raw supplier data.
const DB = Deno.env.get("SUPABASE_DB_URL") || "";
const sql = postgres(DB,{max:1,prepare:false,idle_timeout:10,connect_timeout:10,
  max_lifetime:45,ssl:{rejectUnauthorized:true},
  connection:{application_name:"dropec-creative-catalog-bridge",statement_timeout:14000}});
const JWKS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const REPO="jokas29/project-bmo";
const WORKFLOW=REPO+"/.github/workflows/dropec-premium-cloudflare-ai.yml@refs/heads/main";
const HEAD={"Cache-Control":"no-store","Content-Type":"application/json;charset=utf-8"};
const clean=(x:unknown,n=140)=>String(x??"").normalize("NFKC")
  .replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,n);
async function requireRunner(req:Request){
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!token)throw new Error("Unauthorized");
  const {payload}=await jwtVerify(token,JWKS,{issuer:"https://token.actions.githubusercontent.com",
    audience:"dropec-creative-premium"});
  if(payload.repository!==REPO||payload.ref!=="refs/heads/main"||
     payload.workflow_ref!==WORKFLOW||payload.event_name==="pull_request")throw new Error("Forbidden");
}
function benefitsFromSupplier(raw:unknown):string[]{
  const description=String(raw||"").slice(0,7000)
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/p\s*>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&amp;/gi," ");
  const snippets=description.split(/✔️?|✓/u).slice(1);
  const items:string[]=[];
  for(const rawItem of snippets){
    const v=clean(rawItem.split(/\n|🎁|👥|🚀|💬|✅/u)[0],66);
    if(v.length<8||v.length>60||/[$%\d]{5,}/.test(v)||
       /\b(garantiz|milagro|cura|sin esfuerzo|en segundos|sin riesgos|no tóxic|eco.friendly|durader|segur|no se decolora|resultados profesionales|mejores precios|stock|mayorista|recaudo|envío gratis|24 horas|ahorra tiempo)\b/i.test(v))continue;
    if(items.some(x=>x.toLowerCase()===v.toLowerCase()))continue;
    items.push(v.toUpperCase());
    if(items.length===3)break;
  }
  return items.length===3?items:[];
}
function imageFromGallery(value:unknown):string|null{
  if(!Array.isArray(value))return null;
  for(const row of value){
    const path=String(row?.urlS3||row?.url||"");
    try{
      const u=new URL(path.replace(/^\/+/, ""),"https://d39ru7awumhhs2.cloudfront.net/");
      if(u.protocol==="https:"&&u.hostname==="d39ru7awumhhs2.cloudfront.net" &&
         u.pathname.startsWith("/ecuador/products/")&&!u.username&&!u.password)return u.href;
    }catch{/**/}
  }
  return null;
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="GET")return Response.json({ok:false,error:"Method not allowed"},{status:405,headers:HEAD});
  try{
    await requireRunner(req);
    if(!DB)throw new Error("Catalog DB unavailable");
    const rows=await sql`
      select c.woo_product_id,c.dropi_product_id,c.public_name,c.selling_price,
             c.auto_score,c.woo_stock_quantity,p.raw->'gallery' gallery,
             p.raw->>'description' supplier_description
      from dropec_private.bot_woo_catalog_products c
      join public.radar_dropi_products p on p.product_id=c.dropi_product_id
      where c.approved=true and c.auto_managed=true
        and c.woo_status='publish' and c.woo_stock_status='instock'
        and coalesce(c.woo_stock_quantity,0)>0 and c.selling_price between 12 and 60
        and coalesce(c.auto_score,0)>=60
        and not exists (
          select 1 from dropec_private.bot_content_posts pp
          where pp.woo_product_id=c.woo_product_id and pp.status='published'
            and pp.published_at>now()-interval '45 days'
        )
      order by coalesce(c.auto_score,0) desc,c.woo_stock_quantity desc,c.woo_product_id asc
      limit 60
    `;
    const candidates=[];
    for(const r of rows){
      const name=clean(r.public_name,120);
      if(/\b(arma|pistola|cuchillo|medicamento|nicotina|cbd|cannabis|esteroide|loter[ií]a|apuesta|suplemento sexual)\b/i.test(name))continue;
      const photo=imageFromGallery(r.gallery);
      const benefits=benefitsFromSupplier(r.supplier_description);
      const wooId=Number(r.woo_product_id),dropiId=Number(r.dropi_product_id),price=Number(r.selling_price);
      if(!photo||benefits.length!==3||name.length<7||!Number.isSafeInteger(wooId)||
         !Number.isSafeInteger(dropiId)||!Number.isFinite(price)||price<=0)continue;
      candidates.push({woo_product_id:wooId,dropi_product_id:dropiId,product_name:name,
        product_price:price,source_image_url:photo,benefits,benefits_source:"supplier_listing",
        image_quality_warning:/220x220|_220x220/i.test(photo)});
      if(candidates.length>=20)break;
    }
    return Response.json({ok:true,source:"approved_woo_auto_catalog",products:candidates,
      publishing_enabled:false},{headers:HEAD});
  }catch(error){
    const unauthorized=/Unauthorized|Forbidden/.test(String(error));
    return Response.json({ok:false,error:unauthorized?"Unauthorized":"Catalog temporarily unavailable"},
      {status:unauthorized?401:503,headers:HEAD});
  }
});
