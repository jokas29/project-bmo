import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

// Staging-only. No checkout, sales, payment or Meta publishing calls.
const BASE = Deno.env.get("SUPABASE_URL") || "https://ubxkqbnzdtgfvphwohzm.supabase.co";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OWNER = "3diaz2000@gmail.com";
const REPOSITORY = "jokas29/project-bmo";
// Only the two reviewed staging-only GitHub workflows may claim/upload previews.
const ALLOWED_WORKFLOWS = new Set([
  REPOSITORY + "/.github/workflows/dropec-premium-gpu.yml@refs/heads/main",
  REPOSITORY + "/.github/workflows/dropec-premium-cloudflare-ai.yml@refs/heads/main",
]);
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
      !ALLOWED_WORKFLOWS.has(String(payload.workflow_ref || "")) || payload.event_name === "pull_request") throw new Error("Forbidden runner");
}
function validatedJobId(value: unknown): string {
  const id=String(value || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Invalid job id");
  return id;
}
function allowedProductImage(value: unknown): string | null {
  // No source is a supported case: the GPU runner produces a labelled
  // conceptual illustration rather than inventing an authentic SKU photo.
  if(typeof value!=="string" || !value.trim())return null;
  try {
    const url=new URL(value);
    if(url.protocol!=="https:" || url.hostname!=="d39ru7awumhhs2.cloudfront.net" ||
       !url.pathname.startsWith("/ecuador/products/") || url.username || url.password ||
       (url.port && url.port!=="443"))return null;
    return url.href;
  }catch{return null}
}
function prompt(product: string, variant: number): string {
  const environment = variant===3
    ? "Premium lifestyle setting context, understated real home interior appropriate to the product category, realistic and tasteful, not showing someone using the product."
    : variant===2
      ? "Premium editorial product photography in a dramatic angled composition, luminous gradients and polished reflections."
      : "Premium commercial hero photography, modern studio lighting, dynamic purple gradients, vivid lime accents, dramatic depth.";
  return [
    "If a product reference is available, use only the physical item, not its marketing text, graphics or background. Otherwise make an explicitly conceptual illustration.",
    environment,
    "No unverifiable details, exact performance claims, measurements or implied medical effects.",
    "No added accessories, no new functions, no claims, no hands manipulating the item, no fictitious packaging.",
    "NO writing, lettering, labels, logos, prices, watermarks, user interface, buttons or numbers.",
    "4:5 portrait full-bleed product scene, hero subject in central 35%-80%, top third and bottom fifth empty for overlaid typography.",
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
  const existing = await admin("/rest/v1/dropec_premium_previews?select=variant,status&job_id=eq."+id);
  let queued = 0;
  for (let variant=1;variant<=3;variant++) {
    if (existing.some((x:any)=>x.variant===variant)) continue;
    await admin("/rest/v1/dropec_premium_previews", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ job_id: id, variant, status:"queued", prompt:prompt(job.product_name,variant) }) });
    queued++;
  }
  // The button is idempotent. Existing jobs are NOT new jobs and will NOT
  // immediately run in the browser; the scheduled private worker leases them.
  return response({ ok:true, job_id:id, queued, existing:existing.length,
    total:queued+existing.length, process_interval_minutes:15,
    message:queued===0?"already_queued":"new_proposals_queued",
    publication_locked:true, gpu_required:true, publishing_enabled:false });
}
async function status(req: Request) {
  await requireOwner(req);
  const id=validatedJobId(new URL(req.url).searchParams.get("job_id"));
  const rows=await admin("/rest/v1/dropec_premium_previews?select=id,variant,status,poster_path,reference_mode,render_error,render_after,render_started_at,render_attempts,created_at,updated_at&job_id=eq."+id+"&order=variant.asc");
  return response({ok:true, previews:rows, process_interval_minutes:15,
    publication_locked:true, publishing_enabled:false});
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
    const source=allowedProductImage(job.source_image_url);
    const acquired=await admin("/rest/v1/dropec_premium_previews?id=eq."+preview.id+"&status=eq.queued",{
      method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
        status:"processing",render_started_at:new Date().toISOString(),render_attempts:Number(preview.render_attempts||0)+1,render_error:null,updated_at:new Date().toISOString(),
      }),
    });
    if(!Array.isArray(acquired)||!acquired.length)continue;
    return response({ok:true,processed:true,preview_id:preview.id,variant:preview.variant,prompt:preview.prompt,
      product_name:clean(job.product_name,130),price:job.product_price,original_url:source,
      original_available:!!source,publication_locked:true,conceptual_review_required:!source});
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
  const allowedModes=new Set(["catalog_reference","promotional_reference","low_resolution_reference","conceptual"]);
  const mode=req.headers.get("x-dropec-reference-mode") || "conceptual";
  if(!allowedModes.has(mode))return response({error:"Invalid reference mode"},422);
  // Unique object per generation; previous images are never overwritten.
  const path=item.job_id+"/premium/variant-"+item.variant+"-"+id+"-"+crypto.randomUUID()+".jpg";
  await admin("/storage/v1/object/"+BUCKET+"/"+path,{method:"POST",headers:{"Content-Type":"image/jpeg","x-upsert":"false"},body});
  const updated=await admin("/rest/v1/dropec_premium_previews?id=eq."+id+"&status=eq.processing",{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"ready",poster_path:path,
      reference_mode:mode,render_error:null,render_started_at:null,updated_at:new Date().toISOString()}),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"Preview changed while uploading"},409);
  return response({ok:true,status:"ready",publication_locked:true,publishing_enabled:false});
}
async function adopt(req: Request) {
  await requireOwner(req);
  const input=await req.json().catch(()=>( {} )) as Json;
  const id=validatedJobId(input.preview_id);
  const previews=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,variant,status,poster_path,reference_mode&id=eq."+id+"&limit=1");
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
      review_notes:"Portada Premium generada con IA ("+(preview.reference_mode||"sin validar")+"). Revisión de fidelidad, precio y texto obligatoria antes de aprobar.",
      render_error:null,render_after:null,render_started_at:null,updated_at:new Date().toISOString(),
    }),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"Portada was concurrently updated"},409);
  await admin("/rest/v1/dropec_creative_jobs?id=eq."+preview.job_id,{
    method:"PATCH",body:JSON.stringify({status:"review",publication_locked:true,caption_reviewed:false,updated_at:new Date().toISOString()}),
  });
  return response({ok:true,adopted_into_slide:1,publication_locked:true,publishing_enabled:false});
}
async function regenerate(req: Request) {
  await requireOwner(req);
  const input=await req.json().catch(()=>( {} )) as Json;
  const id=validatedJobId(input.preview_id);
  const rows=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,status,poster_path,reference_mode&id=eq."+id+"&limit=1");
  const preview=rows?.[0];
  if(!preview || preview.status==="processing")return response({error:"Preview missing or currently rendering"},409);
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked&id=eq."+preview.job_id+"&limit=1");
  const job=jobs?.[0];
  if(!job || !job.publication_locked || ["approved","ready_to_publish","archived"].includes(job.status)){
    return response({error:"Approved or publishable product cannot be regenerated"},409);
  }
  if(preview.poster_path){
    await admin("/rest/v1/dropec_premium_preview_versions?on_conflict=preview_id,poster_path",{
      method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},
      body:JSON.stringify({preview_id:id,poster_path:preview.poster_path,reference_mode:preview.reference_mode||"legacy_overlay"}),
    });
  }
  const updated=await admin("/rest/v1/dropec_premium_previews?id=eq."+id+"&status=eq."+preview.status,{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({
      status:"queued",poster_path:null,reference_mode:"conceptual",render_attempts:0,
      render_after:null,render_started_at:null,render_error:null,updated_at:new Date().toISOString(),
    }),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"Preview changed during reset"},409);
  return response({ok:true,queued:1,archived:!!preview.poster_path,publication_locked:true,publishing_enabled:false});
}

// Premium carousel is an explicit owner-requested, staging-only queue.
// The existing three Premium previews remain cover ALTERNATIVES; interiors
// are stored in the existing four-slide review table, never in those previews.
const PREMIUM_CAROUSEL_PENDING="premium_carousel_queued";
const PREMIUM_CAROUSEL_ACTIVE="premium_carousel_active";
const PREMIUM_BENEFITS_REQUIRED="premium_benefits_required";
const BENEFIT_SOURCES=new Set(["supplier_listing","catalogue","owner_verified"]);
function validatedBenefits(items: unknown, source: unknown): string[] | null {
  if(typeof source!=="string" || !BENEFIT_SOURCES.has(source) ||
     !Array.isArray(items) || items.length!==3)return null;
  const results: string[]=[];
  for(const item of items){
    if(typeof item!=="string" || item.length>100)return null;
    const value=clean(item,100).toUpperCase();
    if(value.length<8 || value.length>66 || /[$%\r\n]/.test(item) ||
       /GARANTIZ|MILAGRO|CURA\b|SIN ESFUERZO|100 POR CIENTO/i.test(value))return null;
    results.push(value);
  }
  return new Set(results).size===3?results:null;
}

// Generic owner-controlled benefit copy, never inferred from only a product title.
// Keep the existing slide visible in review until the replacement is delivered.
async function saveBenefits(req: Request) {
  await requireOwner(req);
  const input=await req.json().catch(() => ({})) as Json;
  const id=validatedJobId(input.job_id);
  const source=clean(input.benefits_source,40);
  const benefits=validatedBenefits(input.benefits,source);
  if(!benefits)return response({error:"Se requieren exactamente 3 beneficios distintos y una fuente válida; sin promesas no sustentadas."},422);
  const rows=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked,prompt_bundle&id=eq."+id+"&limit=1");
  const job=rows?.[0];
  if(!job || job.publication_locked!==true || !["review","awaiting_images","generating"].includes(job.status)){
    return response({error:"Solo productos privados no aprobados pueden editar beneficios."},409);
  }
  const covers=await admin("/rest/v1/dropec_creative_slides?select=image_path,status&job_id=eq."+id+"&slide_number=eq.1&limit=1");
  const premium=String(covers?.[0]?.image_path||"").includes("/premium/") &&
    ["uploaded","approved"].includes(covers?.[0]?.status);
  const rows3=await admin("/rest/v1/dropec_creative_slides?select=id,status,image_path,review_notes,render_error&job_id=eq."+id+"&slide_number=eq.3&limit=1");
  const slide=rows3?.[0];
  if(!slide || ["approved","rendering"].includes(slide.status))return response({error:"No se modifican beneficios aprobados o en generación."},409);
  if(slide.image_path){
    await admin("/rest/v1/dropec_creative_slide_versions?on_conflict=job_id,slide_number,image_path",{
      method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},
      body:JSON.stringify({job_id:id,slide_number:3,image_path:slide.image_path,
        previous_status:slide.status,review_notes:slide.review_notes||null}),
    });
  }
  const bundle=job.prompt_bundle && typeof job.prompt_bundle==="object" && !Array.isArray(job.prompt_bundle)
    ? {...job.prompt_bundle}:{} as Json;
  const existing=Array.isArray(bundle.slides)?bundle.slides.filter((x:any)=>x && Number(x.slide)!==3):[];
  const old=Array.isArray(bundle.slides)?bundle.slides.find((x:any)=>x && Number(x.slide)===3):null;
  bundle.slides=[...existing,{...(old && typeof old==="object"?old:{}),slide:3,role:"beneficios",
    headline:"3 BENEFICIOS DEL PRODUCTO",benefits,benefits_source:source}].sort((a:any,b:any)=>Number(a.slide)-Number(b.slide));
  const updated=await admin("/rest/v1/dropec_creative_jobs?id=eq."+id+"&status=eq."+job.status,{
    method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({prompt_bundle:bundle,status:"review",publication_locked:true,caption_reviewed:false,updated_at:new Date().toISOString()}),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"El producto cambió durante la edición."},409);
  // No job-wide rebuild, no deletion and no alteration of slides 1, 2 or 4.
  if(premium){
    const next=await admin("/rest/v1/dropec_creative_slides?id=eq."+slide.id+"&status=eq."+slide.status,{
      method:"PATCH",headers:{Prefer:"return=representation"},
      body:JSON.stringify({status:"pending",role:"beneficios",render_error:PREMIUM_CAROUSEL_PENDING,
        render_attempts:0,render_after:null,render_started_at:null,
        review_notes:"Versión anterior conservada; tres beneficios del proveedor o catálogo pendientes de revisión.",
        updated_at:new Date().toISOString()}),
    });
    if(!Array.isArray(next)||next.length!==1)return response({error:"La diapositiva cambió durante la edición."},409);
  }
  return response({ok:true,saved:3,source,queued:premium,publication_locked:true,publishing_enabled:false});
}


async function prepareCarousel(req: Request) {
  await requireOwner(req);
  const body=await req.json().catch(()=>( {} )) as Json;
  const previewId=validatedJobId(body.preview_id);
  const refreshInteriors=body.refresh_interiors===true;
  const selected=await admin("/rest/v1/dropec_premium_previews?select=id,job_id,status,poster_path,reference_mode&id=eq."+previewId+"&limit=1");
  const cover=selected?.[0];
  if(!cover || cover.status!=="ready" || !cover.poster_path) return response({error:"Elige una portada Premium terminada"},409);
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked&limit=1&id=eq."+cover.job_id);
  const job=jobs?.[0];
  if(!job || job.publication_locked!==true ||
     !["review","awaiting_images","generating"].includes(job.status)) {
    return response({error:"Solo trabajos privados sin aprobación pueden generar interiores Premium"},409);
  }
  const slides=await admin("/rest/v1/dropec_creative_slides?select=id,slide_number,status,image_path,review_notes,render_error&job_id=eq."+job.id+"&order=slide_number.asc");
  if(slides.length!==4 || slides.some((x:any)=>x.status==="approved" || x.status==="rendering")) {
    return response({error:"No se reemplazan diapositivas aprobadas o en generación"},409);
  }
  const existing=slides.slice(1).every((x:any)=>
    x.status==="uploaded" && x.review_notes?.startsWith("Premium cinematográfico"));
  if(refreshInteriors && slides[0].image_path!==cover.poster_path)
    return response({error:"Para recrear interiores conserva la portada Premium actualmente seleccionada"},409);
  if(existing && !refreshInteriors && slides[0].image_path===cover.poster_path) {
    return response({ok:true,already_prepared:true,queued:0,publication_locked:true,publishing_enabled:false});
  }
  // Archive old pictures before changing ANY path; never delete storage.
  for(const item of slides) {
    const keep=item.slide_number===1?cover.poster_path:null;
    if(item.image_path && item.image_path!==keep) {
      await admin("/rest/v1/dropec_creative_slide_versions?on_conflict=job_id,slide_number,image_path",{
        method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},
        body:JSON.stringify({job_id:job.id,slide_number:item.slide_number,
          image_path:item.image_path,previous_status:item.status,review_notes:item.review_notes||null}),
      });
    }
  }
  // Job must stay review, not generating, to prevent the old photo-pasting
  // cloud renderer from racing with this more accurate FLUX pipeline.
  await admin("/rest/v1/dropec_creative_jobs?id=eq."+job.id,{
    method:"PATCH",body:JSON.stringify({status:"review",publication_locked:true,
      caption_reviewed:false,updated_at:new Date().toISOString()}),
  });
  for(const item of slides) {
    const isCover=item.slide_number===1;
    const patch=isCover?{
      status:"uploaded",image_path:cover.poster_path,render_error:null,render_after:null,
      render_started_at:null,
      review_notes:"Portada cinematográfica elegida para revisión, "+(cover.reference_mode||"referencia sin verificar")+".",
      updated_at:new Date().toISOString(),
    }:{
      status:"pending",image_path:null,render_attempts:0,render_after:null,
      render_started_at:null,render_error:PREMIUM_CAROUSEL_PENDING,
      review_notes:"En cola para ilustración Premium, sin publicación.",
      updated_at:new Date().toISOString(),
    };
    const changed=await admin("/rest/v1/dropec_creative_slides?id=eq."+item.id+"&status=eq."+item.status,{
      method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch),
    });
    if(!Array.isArray(changed)||changed.length!==1) return response({error:"Cambió el estado de la diapositiva; vuelve a revisar"},409);
  }
  return response({ok:true,queued:3,refreshed:refreshInteriors,job_id:job.id,publication_locked:true,
    publishing_enabled:false,process_interval_minutes:15});
}

async function claimCarousel(req: Request) {
  await requireRunner(req);
  const old=new Date(Date.now()-25*60000).toISOString();
  const stale=await admin("/rest/v1/dropec_creative_slides?select=id,render_attempts&status=eq.rendering&render_error=eq."+
    PREMIUM_CAROUSEL_ACTIVE+"&render_started_at=lt."+encodeURIComponent(old)+"&limit=10");
  for(const item of stale) {
    const exhausted=Number(item.render_attempts||0)>=3;
    await admin("/rest/v1/dropec_creative_slides?id=eq."+item.id+"&status=eq.rendering&render_error=eq."+PREMIUM_CAROUSEL_ACTIVE,{
      method:"PATCH",body:JSON.stringify({status:exhausted?"error":"pending",
        render_error:exhausted?"Premium worker lease expired":PREMIUM_CAROUSEL_PENDING,
        render_started_at:null,
        render_after:exhausted?null:new Date(Date.now()+15*60000).toISOString()}),
    });
  }
  const rows=await admin("/rest/v1/dropec_creative_slides?select=id,job_id,slide_number,status,render_attempts,render_after&status=eq.pending&render_error=eq."+
    PREMIUM_CAROUSEL_PENDING+"&slide_number=in.(2,3,4)&order=slide_number.asc&limit=25");
  for(const item of rows) {
    if(item.render_after && Date.parse(item.render_after)>Date.now())continue;
    const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked,product_name,product_price,source_image_url,prompt_bundle&id=eq."+item.job_id+"&limit=1");
    const job=jobs?.[0];
    if(!job || job.publication_locked!==true || job.status!=="review")continue;
    const cover=await admin("/rest/v1/dropec_creative_slides?select=image_path,status&job_id=eq."+job.id+"&slide_number=eq.1&limit=1");
    if(!cover?.[0]?.image_path || !["uploaded","approved"].includes(cover[0].status))continue;
    const number=Number(item.slide_number);
    const variant=({2:3,3:1,4:2} as Record<number,number>)[number];
    const original=allowedProductImage(job.source_image_url);
    const custom=Array.isArray(job.prompt_bundle?.slides)
      ? job.prompt_bundle.slides.find((x:any)=>x && Number(x.slide)===number)
      : null;
    const benefitItems=number===3?validatedBenefits(custom?.benefits,custom?.benefits_source):null;
    if(number===3 && !benefitItems){
      await admin("/rest/v1/dropec_creative_slides?id=eq."+item.id+
        "&status=eq.pending&render_error=eq."+PREMIUM_CAROUSEL_PENDING,{
        method:"PATCH",body:JSON.stringify({render_error:PREMIUM_BENEFITS_REQUIRED,
          review_notes:"Faltan tres beneficios documentados. Agrégalos desde el panel privado; no se inventarán."}),
      });
      continue;
    }
    const acquired=await admin("/rest/v1/dropec_creative_slides?id=eq."+item.id+
      "&status=eq.pending&render_error=eq."+PREMIUM_CAROUSEL_PENDING,{
      method:"PATCH",headers:{Prefer:"return=representation"},
      body:JSON.stringify({status:"rendering",render_error:PREMIUM_CAROUSEL_ACTIVE,
        render_started_at:new Date().toISOString(),
        render_attempts:Number(item.render_attempts||0)+1}),
    });
    if(!Array.isArray(acquired)||acquired.length!==1)continue;
    const candidate=typeof custom?.headline==="string"?clean(custom.headline,90):"";
    const heading=number===3?"3 BENEFICIOS DEL PRODUCTO":
      candidate && !/[\\d$%]/.test(candidate) && !/garantiz|gratis|milagro|cura|descuento/i.test(candidate)
      ? candidate:null;
    return response({ok:true,processed:true,carousel:true,slide_number:number,
      slide_id:item.id,preview_id:item.id,variant,
      prompt:prompt(job.product_name,variant),
      product_name:clean(job.product_name,130),price:job.product_price,
      slide_headline:number===4?null:heading,slide_benefits:benefitItems,
      original_url:original,original_available:!!original,
      publication_locked:true,conceptual_review_required:!original});
  }
  return response({ok:true,processed:false,reason:"no_queued_premium_carousel_slide"});
}

async function completeCarousel(req: Request) {
  await requireRunner(req);
  const id=validatedJobId(new URL(req.url).searchParams.get("slide_id"));
  if(Number(req.headers.get("content-length")||0)>7*1024*1024) return response({error:"JPEG too large"},413);
  if(!req.headers.get("content-type")?.startsWith("image/jpeg")) return response({error:"JPEG required"},415);
  const slideRows=await admin("/rest/v1/dropec_creative_slides?select=id,job_id,slide_number,status,render_error,image_path&id=eq."+id+"&limit=1");
  const slide=slideRows?.[0];
  // A selective slide-3 refresh keeps the previously uploaded private image
  // visible while rendering. All other slides still require an empty slot.
  const permittedPrior=slide?.slide_number===3 &&
    String(slide?.image_path||"").startsWith(String(slide?.job_id||"")+"/premium/carousel-slide-3-");
  if(!slide || ![2,3,4].includes(slide.slide_number) || slide.status!=="rendering" ||
     slide.render_error!==PREMIUM_CAROUSEL_ACTIVE ||
     (slide.image_path && !permittedPrior)) return response({error:"No active private carousel lease"},409);
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked&id=eq."+slide.job_id+"&limit=1");
  if(jobs?.[0]?.publication_locked!==true || jobs?.[0]?.status!=="review")return response({error:"Carousel job no longer private"},409);
  const data=new Uint8Array(await req.arrayBuffer());
  if(data.byteLength<15000 || data.byteLength>7*1024*1024 ||
    data[0]!==255 || data[1]!==216 || data[2]!==255) return response({error:"Invalid generated JPEG"},422);
  const mode=req.headers.get("x-dropec-reference-mode")||"conceptual";
  if(!["catalog_reference","promotional_reference","low_resolution_reference","conceptual"].includes(mode))return response({error:"Unknown reference mode"},422);
  const path=slide.job_id+"/premium/carousel-slide-"+slide.slide_number+"-"+crypto.randomUUID()+".jpg";
  await admin("/storage/v1/object/"+BUCKET+"/"+path,{method:"POST",headers:{"Content-Type":"image/jpeg","x-upsert":"false"},body:data});
  const updated=await admin("/rest/v1/dropec_creative_slides?id=eq."+id+
    "&status=eq.rendering&render_error=eq."+PREMIUM_CAROUSEL_ACTIVE,{
    method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({status:"uploaded",image_path:path,render_error:null,
      render_after:null,render_started_at:null,
      review_notes:"Premium cinematográfico · "+(mode==="conceptual"?"IMAGEN ILUSTRATIVA; producto no verificado. ":"")+
        (slide.slide_number===2?"Uso por persona generado con IA: verificar manos, mecanismo real y seguridad. ":
        slide.slide_number===3?"Tres beneficios declarados por su fuente: verificar cada afirmación y la escena con el producto real. ":
        "Comprobar precio y contacto antes de compartir. ")+
        "Revisión humana obligatoria, nunca publicar automáticamente.",
      updated_at:new Date().toISOString()}),
  });
  if(!Array.isArray(updated)||updated.length!==1)return response({error:"Lease changed during upload"},409);
  return response({ok:true,status:"uploaded",slide_number:slide.slide_number,
    publication_locked:true,publishing_enabled:false});
}

async function failedCarousel(req: Request) {
  await requireRunner(req);
  const body=await req.json().catch(()=>( {} )) as Json;
  const id=validatedJobId(body.slide_id);
  const rows=await admin("/rest/v1/dropec_creative_slides?select=id,status,render_attempts,render_error&id=eq."+id+"&limit=1");
  const item=rows?.[0];
  if(!item || item.status!=="rendering" || item.render_error!==PREMIUM_CAROUSEL_ACTIVE)return response({error:"No active carousel lease"},409);
  const detail=clean(body.error,210)||"Image generation error";
  const retry=Number(item.render_attempts||0)<3;
  await admin("/rest/v1/dropec_creative_slides?id=eq."+id+"&status=eq.rendering&render_error=eq."+PREMIUM_CAROUSEL_ACTIVE,{
    method:"PATCH",body:JSON.stringify({status:retry?"pending":"error",
      render_error:retry?PREMIUM_CAROUSEL_PENDING:detail,
      render_started_at:null,render_after:retry?new Date(Date.now()+30*60000).toISOString():null,
      review_notes:retry?"Premium: reintento automático pendiente.":"Premium requiere revisión: "+detail}),
  });
  return response({ok:true,retry,publication_locked:true});
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
    if(req.method==="POST" && path.endsWith("/carousel/benefits"))return await saveBenefits(req);
    if(req.method==="POST" && path.endsWith("/carousel/prepare"))return await prepareCarousel(req);
    if(req.method==="POST" && path.endsWith("/carousel/claim"))return await claimCarousel(req);
    if(req.method==="POST" && path.endsWith("/carousel/complete"))return await completeCarousel(req);
    if(req.method==="POST" && path.endsWith("/carousel/failed"))return await failedCarousel(req);
    if(req.method==="POST" && path.endsWith("/queue"))return await queue(req);
    if(req.method==="GET" && path.endsWith("/status"))return await status(req);
    if(req.method==="POST" && path.endsWith("/claim"))return await claim(req);
    if(req.method==="POST" && path.endsWith("/complete"))return await complete(req);
    if(req.method==="POST" && path.endsWith("/adopt"))return await adopt(req);
    if(req.method==="POST" && path.endsWith("/regenerate"))return await regenerate(req);
    if(req.method==="POST" && path.endsWith("/failed"))return await failed(req);
    return response({error:"Not found"},404);
  } catch(e) {
    const detail=clean(errorText(e),220);
    const status=/Unauthorized|Forbidden/.test(detail)?401:/Invalid job id/.test(detail)?400:/Premium scenes need/.test(detail)?422:503;
    return response({ok:false,error:detail},status);
  }
});
