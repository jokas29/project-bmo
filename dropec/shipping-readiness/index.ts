import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { assessShipping, type ShippingSnapshot } from "./guard.ts";
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{max:1,prepare:false,ssl:{rejectUnauthorized:true},connection:{application_name:'dropec-shipping-quote',statement_timeout:15000}});
const SAFE={"Cache-Control":"no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff"};
const json=(d:unknown,s=200)=>Response.json(d,{status:s,headers:SAFE});
const clean=(v:unknown,n=300)=>String(v??'').normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const eq=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
async function internalKey(){const[r]=await sql`select decrypted_secret from vault.decrypted_secrets where name='dropec_bot_internal_key' limit 1`;return String(r?.decrypted_secret||'')}
async function originForWoo(wooProductId:number){const[r]=await sql`select (select w->'warehouse'->'city' from jsonb_array_elements(coalesce(p.raw->'warehouse_product','[]'::jsonb)) w where coalesce(nullif(w->>'stock','')::int,0)>0 and w->'warehouse'->'city'->>'cod_dane' is not null limit 1) as origin from dropec_private.bot_woo_catalog_products c join public.radar_dropi_products p on p.product_id=c.dropi_product_id where c.woo_product_id=${wooProductId} limit 1`;return r?.origin||null}
async function quote(platform:string,senderId:string){const[s]=await sql`select * from dropec_private.bot_checkout_sessions where platform=${platform} and sender_id=${senderId}`;if(!s)return{ok:false,error:'checkout_missing'};if(!s.woo_product_id||!s.city||!s.province)return{ok:false,error:'delivery_data_missing'};const productAmount=Number(s.unit_price||0)*Number(s.quantity||1);if(productAmount<=0)return{ok:false,error:'invalid_product_amount'};if(s.shipping_quoted_at&&s.shipping_amount!==null&&Number(s.shipping_amount)>0)return{ok:true,shipping_amount:Number(s.shipping_amount),total_amount:Number(s.total_amount||productAmount+Number(s.shipping_amount)),source:String(s.shipping_quote_source||'dropi')};const origin=await originForWoo(Number(s.woo_product_id));if(!origin?.cod_dane)return{ok:false,error:'origin_catalog_missing'};const[j]=await sql`select * from dropec_private.bot_shipping_quote_jobs where platform=${platform} and sender_id=${senderId} and woo_product_id=${Number(s.woo_product_id)} and province=${String(s.province)} and city=${String(s.city)} and product_amount=${productAmount} and quantity=${Number(s.quantity||1)} order by created_at desc limit 1`;if(j?.status==='completed'&&Number(j.shipping_amount)>0){const shipping=Number(j.shipping_amount),total=productAmount+shipping;await sql`update dropec_private.bot_checkout_sessions set shipping_amount=${shipping},total_amount=${total},shipping_quoted_at=coalesce(shipping_quoted_at,now()),shipping_quote_source='dropi_v2',payment_amount=${total},updated_at=now() where platform=${platform} and sender_id=${senderId}`;return{ok:true,shipping_amount:shipping,total_amount:total,carrier:j.carrier||null}}if(j?.status==='queued'||j?.status==='processing')return{ok:false,error:'shipping_quote_pending',job_id:j.id};const payload={woo_product_id:Number(s.woo_product_id),province:clean(s.province,80),city:clean(s.city,80),amount:productAmount,quantity:Number(s.quantity||1),rate_type:'SIN RECAUDO',origin};const[created]=await sql`insert into dropec_private.bot_shipping_quote_jobs(platform,sender_id,woo_product_id,province,city,product_amount,quantity,request_payload,status) values(${platform},${senderId},${Number(s.woo_product_id)},${String(s.province)},${String(s.city)},${productAmount},${Number(s.quantity||1)},${sql.json(payload)},'queued') returning id`;return{ok:false,error:'shipping_quote_pending',job_id:created.id}}

async function pipelineReadiness() {
  const [state] = await sql`
    select
      coalesce((select worker_enabled from dropec_private.shipping_pipeline_control where singleton=true), false) as worker_enabled,
      (select worker_heartbeat_at from dropec_private.shipping_pipeline_control where singleton=true) as worker_heartbeat_at,
      (select provider_bridge_verified_at from dropec_private.shipping_pipeline_control where singleton=true) as provider_bridge_verified_at,
      coalesce((select enabled from dropec_private.bot_woo_config where singleton=true), false) as woo_enabled,
      coalesce((select webhook_secret_id is not null from dropec_private.bot_woo_config where singleton=true), false) as woo_webhook_signature_ready,
      exists(select 1 from vault.secrets where name='dropec_bot_internal_key') as internal_key_ready,
      (select count(*)::int from dropec_private.bot_woo_catalog_products where dropi_product_id is not null) as linked_products,
      (select count(*)::int
         from dropec_private.bot_woo_catalog_products c
         join public.radar_dropi_products p on p.product_id=c.dropi_product_id
        where c.dropi_product_id is not null and exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(p.raw->'warehouse_product')='array'
              then p.raw->'warehouse_product' else '[]'::jsonb end
          ) as w
          where w->'warehouse'->'city'->>'cod_dane' is not null
            and case when (w->>'stock') ~ '^[0-9]+{try{const u=new URL(req.url);if(req.method==='GET'&&u.pathname.endsWith('/health')){const readiness=await pipelineReadiness();return json({service:'dropec-shipping-quote',status:readiness.status,quote_processing_ready:readiness.quote_processing_ready,blockers:readiness.blockers,coverage:readiness.coverage,pending:readiness.pending_jobs,mode:'disabled_until_processor_verified'})}if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:SAFE});const key=req.headers.get('x-dropec-internal')||'',expected=await internalKey();if(!expected||!eq(key,expected))return new Response('Unauthorized',{status:401,headers:SAFE});const readiness=await pipelineReadiness();if(!readiness.quote_processing_ready)return json({ok:false,error:'shipping_pipeline_unavailable',blockers:readiness.blockers},503);const b=await req.json().catch(()=>({})) as any;return json(await quote(clean(b.platform||'instagram',30),clean(b.sender_id,120)))}catch(e){return json({ok:false,error:e instanceof Error?e.message:'temporary_failure'},503)}});
              then (w->>'stock')::numeric > 0 else false end
        )
      ) as products_with_valid_origin,
      (select count(*)::int from dropec_private.bot_shipping_quote_jobs where status in ('queued','processing')) as pending_jobs
  `;
  if (!state) throw new Error("shipping_state_unavailable");
  const status: ShippingSnapshot = {
    worker_enabled: state.worker_enabled === true,
    worker_heartbeat_at: state.worker_heartbeat_at ? new Date(state.worker_heartbeat_at).toISOString() : null,
    provider_bridge_verified_at: state.provider_bridge_verified_at ? new Date(state.provider_bridge_verified_at).toISOString() : null,
    woo_enabled: state.woo_enabled === true,
    woo_webhook_signature_ready: state.woo_webhook_signature_ready === true,
    internal_key_ready: state.internal_key_ready === true,
    linked_products: Number(state.linked_products || 0),
    products_with_valid_origin: Number(state.products_with_valid_origin || 0),
    pending_jobs: Number(state.pending_jobs || 0)
  };
  return assessShipping(status);
}

Deno.serve(async req=>{try{const u=new URL(req.url);if(req.method==='GET'&&u.pathname.endsWith('/health')){const[q]=await sql`select count(*)::int n from dropec_private.bot_shipping_quote_jobs where status in ('queued','processing')`;return json({service:'dropec-shipping-quote',status:'ok',mode:'github_browser_queue',origin_source:'radar_dropi_products',pending:q?.n||0})}if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:SAFE});const key=req.headers.get('x-dropec-internal')||'',expected=await internalKey();if(!expected||!eq(key,expected))return new Response('Unauthorized',{status:401,headers:SAFE});const b=await req.json().catch(()=>({})) as any;return json(await quote(clean(b.platform||'instagram',30),clean(b.sender_id,120)))}catch(e){return json({ok:false,error:e instanceof Error?e.message:'temporary_failure'},503)}});