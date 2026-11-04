import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

// Staging-only. No checkout, sales, payment or Meta publishing calls.
const BASE = Deno.env.get("SUPABASE_URL") || "https://ubxkqbnzdtgfvphwohzm.supabase.co";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OWNER = "3diaz2000@gmail.com";
const REPOSITORY = "jokas29/project-bmo";
const WORKFLOW = REPOSITORY + "/.github/workflows/dropec-premium-gpu.yml@refs/heads/main";
const BUCKET = "dropec-creative-private";
const ORIGIN = "https://project-bmo.pages.dev";
const CORS = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type", "Vary": "Origin" };
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

type Json = Record<string, unknown>;
function response(value: unknown, status=200) {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store" } });
}
function clean(value: unknown, limit=180) {
  return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0,limit);
}
function errorText(err: unknown) { return err instanceof Error ? err.message : String(err); }
async function admin(path: string, init: RequestInit={}) {
  if (!SERVICE) throw new Error("Missing server-side credential");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE);
  headers.set("Authorization", "Bearer " + SERVICE);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(BASE + path, { ...init, headers, signal: AbortSignal.timeout(22000) });
  const raw = await result.text();
  let value: any;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!result.ok) throw new Error("Staging request " + result.status + ": " + clean(typeof value === "string" ? value : JSON.stringify(value), 180));
  return value;
}
async function requireOwner(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (!token) throw new Error("Unauthorized");
  const result = await fetch(BASE + "/auth/v1/user", {
    headers: { "apikey": SERVICE, "Authorization": "Bearer " + token },
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw new Error("Unauthorized");
  const user = await result.json();
  if (!user.id || !user.email_confirmed_at || clean(user.email,250).toLowerCase() !== OWNER) throw new Error("Forbidden");
}
async function requireRunner(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (!token) throw new Error("Unauthorized");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://token.actions.githubusercontent.com", audience: "dropec-creative-premium",
  });
  if (payload.repository !== REPOSITORY || payload.ref !== "refs/heads/main" ||
      payload.workflow_ref !== WORKFLOW || payload.event_name === "pull_request") throw new Error("Forbidden runner");
}
function validatedJobId(value: unknown): string {
  const id=String(value || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Invalid job id");
  return id;
}
function allowedProductImage(value: unknown): string {
  const raw = String(value || "");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "d39ru7awumhhs2.cloudfront.net" ||
      !url.pathname.startsWith("/ecuador/products/") || url.username || url.password) {
    throw new Error("Premium scenes need a public original product photo from the verified catalogue; private images are not sent to GPU.");
  }
  return url.href;
}
function prompt(product: string, variant: number): string {
  const environment = variant===3
    ? "Premium lifestyle setting context, understated real home interior appropriate to the product category, realistic and tasteful, not showing someone using the product."
    : variant===2
      ? "Premium editorial product photography in a dramatic angled composition, luminous gradients and polished reflections."
      : "Premium commercial hero photography, modern studio lighting, dynamic purple gradients, vivid lime accents, dramatic depth.";
  return [
    "Use the provided exact product photograph as an image reference.",
    environment,
    "The real physical product should retain its silhouette, color, parts, size relationships and materials.",
    "No added accessories, no new functions, no claims, no hands manipulating the item, no fictitious packaging.",
    "NO writing, lettering, labels, logos, prices, watermarks, user interface, buttons or numbers.",
    "4:5 portrait product ad visual, center-right visual interest and generous negative space for later typography.",
    "Product reference: " + clean(product,100) + ".",
  ].join(" ");
}
async function queue(req: Request) {
  await requireOwner(req);
  const input = await req.json().catch(() => ({})) as Json;
  const id = validatedJobId(input.job_id);
  const rows = await admin("/rest/v1/dropec_creative_jobs?select=id,product_name,source_image_url,status,publication_locked&id=eq."+id+"&limit=1");
  const job = rows?.[0];
  if (!job || !job.publication_locked || !["pending","prepared","generating","awaiting_images","review"].includes(job.status)) {
    return response({ error: "Only locked, non-approved staging products may be tested" },409);
  }
  allowedProductImage(job.source_image_url);
  const existing = await admin("/rest/v1/dropec_premium_previews?select=variant,status&job_id=eq."+id);
  let queued = 0;
  for (let variant=1;variant<=3;variant++) {
    if (existing.some((x:any)=>x.variant===variant)) continue;
    await admin("/rest/v1/dropec_premium_previews", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ job_id: id, variant, status:"queued", prompt:prompt(job.product_name,variant) }) });
    queued++;
  }
  return response({ ok:true, job_id:id, queued, existing:existing.length, publication_locked:true, gpu_required:true });
}
async function status(req: Request) {
  await requireOwner(req);
  const id=validatedJobId(new URL(req.url).searchParams.get("job_id"));
  const rows=await admin("/rest/v1/dropec_premium_previews?select=id,variant,status,poster_path,render_error,render_attempts,created_at,updated_at&job_id=eq."+id+"&order=variant.asc");
  return response({ok:true, previews:rows, publication_locked:true, publishing_enabled:false});
}
async function claim(req: Request) {
  await requireRunner(req);
  const before=new Date(Date.now()-25*60*1000).toISOString();
  const stale=await admin("/rest/v1/dropec_premium_previews?select=id,render_attempts&status=eq.processing&render_started_at=lt."+encodeURIComponent(before)+"&limit=8");
  for(const row of stale) {
    await admin("/rest/v1/dropec_premium_previews?id=eq."+row.id+"&status=eq.processing", {
      method:"PATCH", body:JSON.stringify({
        status:row.render_attempts>=3?"error":"queued", render_error:"Worker lease expired",render_started_at:null,
        render_after:row.render_attempts>=3?null:new Date(Date.now()+15*60*1000).toISOString(),updated_at:new Date().toISOString(),
      }),
    });
  }
  const list=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,variant,prompt,render_attempts,render_after&status=eq.queued&order=created_at.asc&limit=15");
  for(const preview of list) {
    if(preview.render_after && Date.parse(preview.render_after)>Date.now()) continue;
    const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,product_name,product_price,source_image_url,status,publication_locked&id=eq."+preview.job_id+"&limit=1");
    const job=jobs?.[0];
    if(!job || !job.publication_locked || ["approved","ready_to_publish","archived"].includes(job.status)) continue;
    let source: string;
    try { source=allowedProductImage(job.source_image_url); }
    catch {
      await admin("/rest/v1/dropec_premium_previews?id=eq."+preview.id+"&status=eq.queued",{
        method:"PATCH",body:JSON.stringify({status:"needs_source",render_error:"Use a verified public original product photo.",updated_at:new Date().toISOString()})});
      continue;
    }
    const acquired=await admin("/rest/v1/dropec_premium_previews?id=eq."+preview.id+"&status=eq.queued",{
      method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
        status:"processing",render_started_at:new Date().toISOString(),render_attempts:Number(preview.render_attempts||0)+1,render_error:null,updated_at:new Date().toISOString(),
      }),
    });
    if(!Array.isArray(acquired)||!acquired.length)continue;
    return response({ok:true,processed:true,preview_id:preview.id,variant:preview.variant,prompt:preview.prompt,
      product_name:clean(job.product_name,130),price:job.product_price,original_url:source,publication_locked:true});
  }
  return response({ok:true,processed:false,reason:"no_eligible_premium_previews"});
}
async function complete(req: Request) {
  await requireRunner(req);
  const id=validatedJobId(new URL(req.url).searchParams.get("preview_id"));
  const len=Number(req.headers.get("content-length")||0);
  if(len>7*1024*1024) return response({error:"Preview too large"},413);
  if(!req.headers.get("content-type")?.startsWith("image/jpeg")) return response({error:"JPEG required"},415);
  const rows=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,variant,status,poster_path&id=eq."+id+"&limit=1");
  const item=rows?.[0];
  if(!item || item.status!=="processing" || item.poster_path) return response({error:"Preview is no longer processing"},409);
  const body=new Uint8Array(await req.arrayBuffer());
  if(body.byteLength<15000 || body.byteLength>7*1024*1024 || body[0]!==255 || body[1]!==216 || body[2]!==255) {
    return response({error:"Invalid JPEG preview"},422);
  }
  const path=item.job_id+"/premium/variant-"+item.variant+"-"+id+".jpg";
  await admin("/storage/v1/object/"+BUCKET+"/"+path,{method:"POST",headers:{"Content-Type":"image/jpeg","x-upsert":"false"},body});
  await admin("/rest/v1/dropec_premium_previews?id=eq."+id+"&status=eq.processing",{
    method:"PATCH",body:JSON.stringify({status:"ready",poster_path:path,render_error:null,render_started_at:null,updated_at:new Date().toISOString()}),
  });
  return response({ok:true,status:"ready",publication_locked:true,publishing_enabled:false});
}
async function adopt(req: Request) {
  await requireOwner(req);
  const input=await req.json().catch(()=>( {} )) as Json;
  const id=validatedJobId(input.preview_id);
  const previews=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,variant,status,poster_path&id=eq."+id+"&limit=1");
  const preview=previews?.[0];
  if(!preview || preview.status!=="ready" || !preview.poster_path) {
    return response({error:"Premium preview must be ready before manual adoption"},409);
  }
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked&limit=1&id=eq."+preview.job_id);
  const job=jobs?.[0];
  if(!job || !job.publication_locked || !["review","awaiting_images","generating","pending"].includes(job.status)) {
    return response({error:"Approved or published jobs cannot be modified"},409);
  }
  const slides=await admin("/rest/v1/dropec_creative_slides?select=id,slide_number,image_path,status,review_notes&job_id=eq."+preview.job_id+"&slide_number=eq.1&limit=1");
  const slide=slides?.[0];
  if(!slide || !["pending","uploaded","rejected","error"].includes(slide.status)) {
    return response({error:"Portada is approved or being rendered; change refused"},409);
  }
  if(slide.image_path && slide.image_path!==preview.poster_path) {
    await admin("/rest/v1/dropec_creative_slide_versions?on_conflict=job_id,slide_number,image_path",{
      method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},
      body:JSON.stringify({job_id:preview.job_id,slide_number:1,image_path:slide.image_path,
        previous_status:slide.status,review_notes:slide.review_notes||null}),
    });
  }
  const updated=await admin("/rest/v1/dropec_creative_slides?id=eq."+slide.id+"&status=eq."+slide.status,{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
      image_path:preview.poster_path,status:"uploaded",
      review_notes:"Portada premium experimental, variante "+preview.variant+". Comprueba producto, precio y texto antes de aprobar.",
      render_error:null,render_after:null,render_started_at:null,updated_at:new Date().toISOString(),
    }),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"Portada was concurrently updated"},409);
  await admin("/rest/v1/dropec_creative_jobs?id=eq."+preview.job_id,{
    method:"PATCH",body:JSON.stringify({status:"review",publication_locked:true,caption_reviewed:false,updated_at:new Date().toISOString()}),
  });
  return response({ok:true,adopted_into_slide:1,publication_locked:true,publishing_enabled:false});
}
async function failed(req: Request) {
  await requireRunner(req);
  const input=await req.json().catch(() => ({})) as Json;
  const id=validatedJobId(input.preview_id);
  const rows=await admin("/rest/v1/dropec_premium_previews?select=render_attempts,status&id=eq."+id+"&limit=1");
  const item=rows?.[0];
  if(!item || item.status!=="processing")return response({error:"Preview is not processing"},409);
  const reason=clean(input.error,240) || "Unknown GPU failure";
  const needsSource=/source.*(small|resolution|unavailable|invalid)/i.test(reason);
  const retry= !needsSource && Number(item.render_attempts)<3;
  await admin("/rest/v1/dropec_premium_previews?id=eq."+id+"&status=eq.processing",{
    method:"PATCH",body:JSON.stringify({status:needsSource?"needs_source":retry?"queued":"error",
      render_error:reason,render_started_at:null,updated_at:new Date().toISOString(),
      render_after:retry?new Date(Date.now()+60*60*1000).toISOString():null}),
  });
  return response({ok:true,retry,needs_source:needsSource});
}
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  const path=new URL(req.url).pathname;
  if(req.method==="GET" && path.endsWith("/health"))return response({
    service:"dropec-premium-scene",status:"staging_only",publishing_enabled:false,
    gpu_required:true,no_paid_api:true,model:"FLUX.2-klein-4B",
  });
  try {
    if(req.method==="POST" && path.endsWith("/queue"))return await queue(req);
    if(req.method==="GET" && path.endsWith("/status"))return await status(req);
    if(req.method==="POST" && path.endsWith("/claim"))return await claim(req);
    if(req.method==="POST" && path.endsWith("/complete"))return await complete(req);
    if(req.method==="POST" && path.endsWith("/adopt"))return await adopt(req);
    if(req.method==="POST" && path.endsWith("/failed"))return await failed(req);
    return response({error:"Not found"},404);
  } catch(e) {
    const detail=clean(errorText(e),220);
    const status=/Unauthorized|Forbidden/.test(detail)?401:/Invalid job id/.test(detail)?400:/Premium scenes need/.test(detail)?422:503;
    return response({ok:false,error:detail},status);
  }
});
