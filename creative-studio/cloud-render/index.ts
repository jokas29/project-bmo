import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { Image as ModernImage } from "jsr:@matmen/imagescript@3.2.1";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const BASE = Deno.env.get("SUPABASE_URL") || "https://ubxkqbnzdtgfvphwohzm.supabase.co";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OWNER = "3diaz2000@gmail.com";
const REPOSITORY = "jokas29/project-bmo";
const WORKFLOW = REPOSITORY + "/.github/workflows/dropec-creative-cloud-render.yml@refs/heads/main";
const BUCKET = "dropec-creative-private";
const BOLD_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-ExtraBold.ttf";
const REG_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const CORS = {"Access-Control-Allow-Origin":"https://project-bmo.pages.dev","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type","Vary":"Origin"};
let boldFont: Uint8Array | null = null;
let regularFont: Uint8Array | null = null;

function response(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {status, headers: {...CORS,"Content-Type":"application/json;charset=utf-8","Cache-Control":"no-store"}});
}
function errMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function clean(input: unknown, length=90) {
  return String(input ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200d]/g," ").replace(/\s+/g," ").trim().slice(0,length);
}
async function admin(path: string, init: RequestInit = {}) {
  if (!SERVICE) throw new Error("Missing server-side Supabase credential");
  const res = await fetch(BASE + path, { ...init, headers: {
    apikey: SERVICE, Authorization: "Bearer " + SERVICE,
    ...(init.body && !(init.body instanceof Uint8Array) ? {"Content-Type":"application/json"} : {}),
    ...(init.headers || {}),
  }, signal: AbortSignal.timeout(25000)});
  const raw = await res.text();
  let parsed: any;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  if (!res.ok) throw new Error("Supabase " + res.status + ": " + (typeof parsed === "string" ? parsed.slice(0,180) : JSON.stringify(parsed).slice(0,180)));
  return parsed;
}
async function requireOwner(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (!token) throw new Error("Unauthorized");
  const res = await fetch(BASE + "/auth/v1/user", {headers: {apikey: SERVICE,Authorization: "Bearer " + token}, signal:AbortSignal.timeout(12000)});
  if (!res.ok) throw new Error("Unauthorized");
  const user = await res.json();
  if (!user.id || clean(user.email,250).toLowerCase() !== OWNER || !user.email_confirmed_at) throw new Error("Forbidden");
}
async function requireRunner(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (!token) throw new Error("Unauthorized");
  const {payload} = await jwtVerify(token,JWKS,{issuer:"https://token.actions.githubusercontent.com",audience:"dropec-creative"});
  if (payload.repository !== REPOSITORY || payload.ref !== "refs/heads/main" || payload.workflow_ref !== WORKFLOW) throw new Error("Forbidden runner");
}
function color(hex: string, alpha=255) {
  const s=hex.replace("#","");
  const n=parseInt(s,16);
  return Image.rgbaToColor((n>>16)&255,(n>>8)&255,n&255,alpha);
}
function rounded(im: Image,x: number,y: number,w: number,h: number,r: number,fill: number) {
  r=Math.max(0,Math.min(r,Math.floor(w/2),Math.floor(h/2)));
  im.drawBox(x+r,y,w-2*r,h,fill).drawBox(x,y+r,w,h-2*r,fill);
  for (const px of [x+r,x+w-r-1]) for (const py of [y+r,y+h-r-1]) im.drawCircle(px,py,r,fill);
}
function words(txt: string,chars=23,limit=3) {
  const parts=clean(txt,175).split(" "), result: string[]=[]; let row="";
  for (const word of parts) {
    if ((row ? row.length+1 : 0)+word.length>chars && row) {result.push(row);row=word;} else row+=(row?" ":"")+word;
  }
  if (row) result.push(row);
  if(result.length>limit) return result.slice(0,limit-1).concat(result.slice(limit-1).join(" "));
  return result;
}
async function font(url: string) {
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:"error"});
  if(!r.ok) throw new Error("Font unavailable "+r.status);
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.byteLength<30000 || bytes.byteLength>2000000) throw new Error("Invalid font payload");
  return bytes;
}
async function fonts() {
  if(!boldFont) boldFont=await font(BOLD_URL);
  if(!regularFont) regularFont=await font(REG_URL);
  return {bold:boldFont,regular:regularFont};
}
async function draw(im: Image,value: string,x: number,y: number,size: number,ink: string,bold=true,maxWidth=940) {
  const f=await fonts();
  let n=size;
  let layer=await Image.renderText(bold ? f.bold : f.regular,n,clean(value,200),color(ink));
  while(layer.width>maxWidth&&n>22) {n-=3;layer=await Image.renderText(bold?f.bold:f.regular,n,clean(value,200),color(ink));}
  im.composite(layer,x,y);
  return layer.height;
}
async function headline(im: Image, txt: string, x: number,y: number,ink: string,size=65,chars=22) {
  let yy=y;
  for(const part of words(txt,chars,3)) { yy+=await draw(im,part,x,yy,size,ink,true,900)+8; }
  return yy;
}
async function imageBytes(job: any) {
  const value=String(job.source_image_url || "");
  let url: string;
  let headers: HeadersInit = {};
  if(value.startsWith("storage://")) {
    const path=value.slice("storage://".length);
    if(!path || path.split("/").includes("..")) throw new Error("Invalid private image path");
    url=BASE + "/storage/v1/object/authenticated/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/");
    headers={apikey:SERVICE,Authorization:"Bearer "+SERVICE};
  } else {
    const u=new URL(value);
    if(u.protocol!=="https:" || u.hostname!=="d39ru7awumhhs2.cloudfront.net" || !u.pathname.startsWith("/ecuador/products/")) throw new Error("Original image host not yet approved; upload a private original photo");
    url=u.href;
  }
  const r=await fetch(url,{headers,redirect:"error",signal:AbortSignal.timeout(17000)});
  if(!r.ok) throw new Error("Original product photo HTTP "+r.status);
  const ct=(r.headers.get("content-type")||"").toLowerCase();
  if(ct && !ct.includes("image/") && !ct.includes("octet-stream")) throw new Error("Original photo response is not an image");
  const raw=new Uint8Array(await r.arrayBuffer());
  if(raw.byteLength<800 || raw.byteLength>12*1024*1024) throw new Error("Original photo size invalid");
  try { return await Image.decode(raw); }
  catch (oldError) {
    // The legacy compositor's decoder lacks WebP; decode with a pinned modern codec
    // and pass lossless PNG pixels to the proven slide renderer.
    try {
      const modern=await ModernImage.decode(raw);
      const png=await modern.encode();
      return await Image.decode(png);
    } catch (newError) {
      throw new Error("Unsupported original image: "+clean(errMessage(newError),130));
    }
  }
}
function photo(im: Image,source: Image,top: number,height: number,width=900) {
  const p=source.clone();
  p.contain(width-35,height-35);
  rounded(im,90,top,width,height,42,color("#FFFFFF"));
  im.composite(p,90+Math.round((width-p.width)/2),top+Math.round((height-p.height)/2));
}
async function ensureCaption(job: any) {
  if (clean(job.caption_draft,2000)) return;
  const product=clean(job.product_name,110);
  const slides=Array.isArray(job.prompt_bundle?.slides)?job.prompt_bundle.slides:[];
  const opener=clean(slides.find((x:any)=>Number(x.slide)===1)?.headline||"Descubre un producto para tu hogar",130);
  const price=Number(job.product_price);
  const tags=["#DropEC","#Ecuador","#Hogar"];
  const lower=product.toLowerCase();
  if(/ajo|cocina|ingredientes|picadora/.test(lower)) tags.push("#Cocina");
  if(/mueble|herramienta|mover/.test(lower)) tags.push("#Organizacion");
  let caption=opener+"\n\n"+product+".\n";
  if(Number.isFinite(price)&&price>0) caption+="Precio referencial de catálogo: $"+price.toFixed(2)+" (sujeto a confirmación).\n";
  caption+="Consulta disponibilidad y costo de envío para tu ciudad antes de pagar.\n\nEscríbenos por mensaje privado para solicitar una cotización.\n\n"+tags.join(" ");
  await admin("/rest/v1/dropec_creative_jobs?id=eq."+job.id+"&caption_draft=is.null",{
    method:"PATCH",body:JSON.stringify({caption_draft:caption,hashtags:tags,caption_reviewed:false,updated_at:new Date().toISOString()})
  });
}
async function compose(job: any, number: number) {
  const W=1080,H=1350;
  const slides=Array.isArray(job.prompt_bundle?.slides)?job.prompt_bundle.slides:[];
  const spec=slides.find((x: any)=>Number(x.slide)===number)||{};
  const source=await imageBytes(job);
  const lowQuality=source.width<550 || source.height<550;
  const backgrounds=["#171322","#F5F2EB","#241C39","#171322"];
  const inks=["#F7F5FF","#1D1829","#F7F5FF","#F7F5FF"];
  const accent=["#CDFF61","#7B52E8","#CDFF61","#CDFF61"];
  const idx=number-1;
  const im=new Image(W,H).fill(color(backgrounds[idx]));
  im.drawCircle(1000,100,210,color(idx===1?"#E5D6FF":"#332747"));
  im.drawCircle(42,1220,205,color(idx===1?"#E3D8FA":"#322447"));
  rounded(im,75,65,200,69,32,color(accent[idx]));
  await draw(im,"DropEC",99,78,34,"#16131F",true,158);
  await draw(im,"CARRUSEL  /  "+number+" DE 4",785,92,21,inks[idx],false,240);
  const title=clean(spec.headline,140) || clean(job.product_name,110);
  await headline(im,title,92,175,inks[idx],number===4?59:66,number===4?24:23);
  // Preserve the actual product photograph. No synthetic pieces, capabilities or lifestyle demonstrations.
  if (number===1) {
    photo(im,source,470,682);
    rounded(im,100,1154,390,62,26,color("#D7FF7A"));
    await draw(im,"DESCUBRE EL PRODUCTO",120,1172,23,"#151323",true,345);
  } else if(number===2) {
    photo(im,source,520,605);
    await draw(im,"UNA SOLUCIÓN PARA EXPLORAR",104,1160,25,"#4C365D",true,850);
  } else if(number===3) {
    photo(im,source,475,685);
    await draw(im,"CONOCE SUS DETALLES",104,1172,29,"#D1FF79",true,850);
  } else {
    photo(im,source,438,640);
    const price=Number(job.product_price);
    if(Number.isFinite(price)&&price>0) {
      await draw(im,"PRECIO DE CATÁLOGO  $"+price.toFixed(2),98,1100,34,accent[idx],true,850);
    }
    await draw(im,"Solicita tu cotización",98,1170,34,"#F7F5FF",true,850);
    await draw(im,"Envío por confirmar antes de pagar",98,1223,23,"#D7D1E1",false,900);
  }
  const data=await im.encodeJPEG(87);
  if(data.byteLength>15*1024*1024) throw new Error("Rendered file exceeds storage cap");
  return {data,warning:lowQuality?"La foto original tiene resolución insuficiente ("+source.width+"×"+source.height+"); sustituir antes de aprobar.":null};
}
async function enqueue(req: Request) {
  await requireOwner(req);
  const body=await req.json();
  const id=String(body.job_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return response({error:"Invalid job id"},400);
  const list=await admin("/rest/v1/dropec_creative_jobs?select=id,status,publication_locked&id=eq."+encodeURIComponent(id)+"&limit=1");
  const job=list?.[0];
  if(!job) return response({error:"Product not found"},404);
  if(!["pending","prepared","generating","awaiting_images","review"].includes(job.status)) return response({error:"Job locked or already approved"},409);
  const slides=await admin("/rest/v1/dropec_creative_slides?select=id,status,image_path&job_id=eq."+id+"&order=slide_number.asc");
  if(slides.length!==4) return response({error:"Expected exactly four slides"},409);
  let count=0;
  for(const s of slides) {
    if(s.image_path || ["uploaded","approved","rendering"].includes(s.status)) continue;
    await admin("/rest/v1/dropec_creative_slides?id=eq."+s.id,{method:"PATCH",body:JSON.stringify({status:"pending",render_error:null,render_after:null,render_attempts:0,review_notes:null})});
    count++;
  }
  if(count===0 && !slides.some((x:any)=>x.status==="rendering")) return response({error:"No empty slides to compose; existing images preserved"},409);
  await admin("/rest/v1/dropec_creative_jobs?id=eq."+id,{method:"PATCH",body:JSON.stringify({status:"generating",publication_locked:true,updated_at:new Date().toISOString()})});
  return response({ok:true,queued:count,job_id:id,publication_locked:true});
}
async function recoverStale() {
  const before=new Date(Date.now()-12*60*1000).toISOString();
  const stale=await admin("/rest/v1/dropec_creative_slides?select=id,render_attempts&status=eq.rendering&render_started_at=lt."+encodeURIComponent(before)+"&limit=20");
  for(const s of stale) {
    await admin("/rest/v1/dropec_creative_slides?id=eq."+s.id+"&status=eq.rendering",{method:"PATCH",body:JSON.stringify({status:s.render_attempts>=3?"error":"pending",render_error:"Interrupted render recovered",render_started_at:null,render_after:null})});
  }
}
async function autoQueueOne() {
  const settings=await admin("/rest/v1/dropec_creative_automation_settings?select=enabled,max_jobs_per_day&singleton=eq.true&limit=1");
  if(!settings?.[0]?.enabled) return null;
  const today=new Date().toISOString().slice(0,10)+"T00:00:00.000Z";
  const completed=await admin("/rest/v1/dropec_creative_jobs?select=id&status=in.(generating,review,approved,ready_to_publish)&updated_at=gte."+encodeURIComponent(today)+"&limit=100");
  if(completed.length>=Number(settings[0].max_jobs_per_day||3)) return null;
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,source_image_url&status=eq.pending&publication_locked=eq.true&order=created_at.asc&limit=10");
  for(const job of jobs) {
    const image=String(job.source_image_url||"");
    if(!image.startsWith("storage://")&&!image.startsWith("https://d39ru7awumhhs2.cloudfront.net/ecuador/products/")) continue;
    const slides=await admin("/rest/v1/dropec_creative_slides?select=id,status,image_path&job_id=eq."+job.id+"&order=slide_number.asc");
    if(slides.length!==4 || !slides.every((s:any)=>s.status==="pending"&&!s.image_path)) continue;
    const updated=await admin("/rest/v1/dropec_creative_jobs?id=eq."+job.id+"&status=eq.pending&publication_locked=eq.true",{
      method:"PATCH",headers:{Prefer:"return=representation"},
      body:JSON.stringify({status:"generating",publication_locked:true,updated_at:new Date().toISOString()})
    });
    if(Array.isArray(updated)&&updated.length) return job.id;
  }
  return null;
}
async function processOne(autoSelect=true) {
  await recoverStale();
  const jobs=await admin("/rest/v1/dropec_creative_jobs?select=id,product_name,product_price,source_image_url,prompt_bundle,caption_draft,status&status=eq.generating&order=created_at.asc&limit=15");
  for(const job of jobs) {
    const slides=await admin("/rest/v1/dropec_creative_slides?select=id,slide_number,status,image_path,render_after,render_attempts&job_id=eq."+job.id+"&order=slide_number.asc");
    const pending=slides.find((s:any)=>s.status==="pending" && !s.image_path && (!s.render_after || new Date(s.render_after).getTime()<=Date.now()));
    if(!pending) continue;
    const acquired=await admin("/rest/v1/dropec_creative_slides?id=eq."+pending.id+"&status=eq.pending",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"rendering",render_started_at:new Date().toISOString(),render_attempts:Number(pending.render_attempts||0)+1,render_error:null})});
    if(!Array.isArray(acquired)||!acquired.length) continue;
    const attempts=Number(pending.render_attempts||0)+1;
    try {
      await ensureCaption(job);
      const {data,warning}=await compose(job,Number(pending.slide_number));
      const path=job.id+"/auto/slide-"+pending.slide_number+"-"+Date.now()+".jpg";
      await admin("/storage/v1/object/"+BUCKET+"/"+path,{method:"POST",headers:{"Content-Type":"image/jpeg","x-upsert":"false"},body:data});
      await admin("/rest/v1/dropec_creative_slides?id=eq."+pending.id+"&status=eq.rendering",{method:"PATCH",body:JSON.stringify({image_path:path,status:"uploaded",review_notes:warning,render_started_at:null,render_after:null,render_error:null})});
      const latest=await admin("/rest/v1/dropec_creative_slides?select=status&job_id=eq."+job.id);
      if(latest.length===4 && latest.every((s:any)=>["uploaded","approved"].includes(s.status))) {
        await admin("/rest/v1/dropec_creative_jobs?id=eq."+job.id+"&status=eq.generating",{method:"PATCH",body:JSON.stringify({status:"review",publication_locked:true,updated_at:new Date().toISOString()})});
      }
      return {ok:true,processed:true,product_id:job.id,slide_number:pending.slide_number,bytes:data.byteLength,warning:warning||undefined,publication_locked:true};
    } catch(error) {
      const detail=clean(errMessage(error),350);
      const permanent=attempts>=3 || /Original image host|Invalid private|photo size invalid|Original product photo HTTP 40/.test(detail);
      const minutes=Math.min(30,Math.pow(2,attempts)*2);
      await admin("/rest/v1/dropec_creative_slides?id=eq."+pending.id+"&status=eq.rendering",{method:"PATCH",body:JSON.stringify({status:permanent?"error":"pending",render_error:detail,review_notes:permanent?"Requiere intervención: "+detail:null,render_started_at:null,render_after:permanent?null:new Date(Date.now()+minutes*60000).toISOString()})});
      return {ok:false,processed:true,retry:!permanent,slide_number:pending.slide_number,error:detail};
    }
  }
  if(autoSelect){const next=await autoQueueOne();if(next)return await processOne(false);}
  return {ok:true,processed:false,reason:"no_eligible_work"};
}
Deno.serve(async(req: Request)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  const pathname=new URL(req.url).pathname;
  if(req.method==="GET"&&pathname.endsWith("/health")) return response({service:"dropec-creative-render",status:"ready",publishing_enabled:false});
  if(req.method!=="POST") return response({error:"Method Not Allowed"},405);
  try {
    if(pathname.endsWith("/enqueue")) return await enqueue(req);
    if(pathname.endsWith("/worker")) { await requireRunner(req);return response(await processOne());}
    return response({error:"Unknown action"},404);
  } catch(error) {
    const message=errMessage(error);
    const code=/(Unauthorized|Forbidden)/.test(message)?401:503;
    return response({ok:false,error:clean(message,320)},code);
  }
});