import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { assessShipping, type ShippingSnapshot } from "./guard.ts";
import { freshMatchingQuote } from "./quote_policy.ts";
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{max:1,prepare:false,ssl:{rejectUnauthorized:true},connection:{application_name:'dropec-shipping-quote',statement_timeout:15000}});
const SAFE={"Cache-Control":"no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff"};
const json=(d:unknown,s=200)=>Response.json(d,{status:s,headers:SAFE});
const clean=(v:unknown,n=300)=>String(v??'').normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const eq=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
async function internalKey(){const[r]=await sql`select decrypted_secret from vault.decrypted_secrets where name='dropec_bot_internal_key' limit 1`;return String(r?.decrypted_secret||'')}
async function originForWoo(wooProductId: number, quantity: number) {
  // Read only provider-verified, unexpired snapshots from Supabase B. If a
  // product can ship from multiple live warehouses, refuse to guess which one.
  const [row] = await sql`
    select count(*)::int as choices, (array_agg(o.origin_city))[1] as origin
    from dropec_private.bot_woo_catalog_products c
    join dropec_private.shipping_verified_origins o
      on o.dropi_product_id = c.dropi_product_id
    where c.woo_product_id = ${wooProductId}
      and c.dropi_product_id is not null
      and c.approved = true and c.woo_status = 'publish'
      and o.stock_available >= ${quantity}
      and o.observed_at <= now() and o.valid_until > now()
  `;
  if (Number(row?.choices) !== 1) return null;
  const candidate = row.origin;
  if (!candidate || typeof candidate.cod_dane !== "string" ||
      (!Number.isInteger(Number(candidate.id)) || Number(candidate.id) <= 0)) return null;
  return candidate;
}
async function quote(platform: string, senderId: string) {
  const [s] = await sql`
    select * from dropec_private.bot_checkout_sessions
    where platform = ${platform} and sender_id = ${senderId}
  `;
  if (!s) return { ok:false, error:"checkout_missing" };
  if (!s.woo_product_id || !s.city || !s.province) {
    return { ok:false, error:"delivery_data_missing" };
  }
  const qty=Number(s.quantity);
  const productAmount=Number(s.unit_price)*qty;
  if (!Number.isSafeInteger(qty) || qty<1 || qty>20 ||
      !Number.isFinite(productAmount) || productAmount<=0) {
    return { ok:false, error:"invalid_product_amount" };
  }

  const origin=await originForWoo(Number(s.woo_product_id),qty);
  if (!origin) return { ok:false, error:"verified_origin_unavailable_or_ambiguous" };

  const [j] = await sql`
    select * from dropec_private.bot_shipping_quote_jobs
    where platform = ${platform} and sender_id = ${senderId}
      and woo_product_id = ${Number(s.woo_product_id)}
      and province = ${String(s.province)} and city = ${String(s.city)}
      and product_amount = ${productAmount} and quantity = ${qty}
    order by created_at desc limit 1
  `;
  const context = {
    woo_product_id:Number(s.woo_product_id),quantity:qty,
    product_amount:productAmount,province:String(s.province),
    city:String(s.city),origin:{id:origin.id,cod_dane:origin.cod_dane}
  };
  const shipping=freshMatchingQuote(j,context);
  if (shipping!==null) {
    const total=productAmount+shipping;
    await sql`
      update dropec_private.bot_checkout_sessions
      set shipping_amount=${shipping}, total_amount=${total},
          shipping_quoted_at=now(), shipping_quote_source='dropi_v2',
          payment_amount=${total},updated_at=now()
      where platform=${platform} and sender_id=${senderId}
        and woo_product_id=${Number(s.woo_product_id)}
        and unit_price=${Number(s.unit_price)} and quantity=${qty}
        and city=${String(s.city)} and province=${String(s.province)}
    `;
    return {ok:true,shipping_amount:shipping,total_amount:total,carrier:j?.carrier||null};
  }
  if (j?.status==='queued'||j?.status==='processing') {
    return {ok:false,error:"shipping_quote_pending",job_id:j.id};
  }
  // The legacy unique partial index allows only one open job per sender.
  // Never auto-cancel or overwrite a different in-progress customer quote.
  const [otherOpen]=await sql`
    select id from dropec_private.bot_shipping_quote_jobs
    where platform=${platform} and sender_id=${senderId}
      and status in ('queued','processing') limit 1
  `;
  if (otherOpen) return {ok:false,error:"different_shipping_quote_already_pending"};
  const payload={
    woo_product_id:Number(s.woo_product_id),
    province:clean(s.province,80),city:clean(s.city,80),
    amount:productAmount,quantity:qty,rate_type:"SIN RECAUDO",
    origin
  };
  const [created]=await sql`
    insert into dropec_private.bot_shipping_quote_jobs
      (platform,sender_id,woo_product_id,province,city,
       product_amount,quantity,request_payload,status)
    values (${platform},${senderId},${Number(s.woo_product_id)},
      ${String(s.province)},${String(s.city)},
      ${productAmount},${qty},${sql.json(payload)},'queued')
    returning id
  `;
  return {ok:false,error:"shipping_quote_pending",job_id:created.id};
}

async function pipelineReadiness() {
  const [state] = await sql`
    select
      coalesce((select worker_enabled from dropec_private.shipping_pipeline_control where singleton=true),false) as worker_enabled,
      (select worker_heartbeat_at from dropec_private.shipping_pipeline_control where singleton=true) as worker_heartbeat_at,
      (select provider_bridge_verified_at from dropec_private.shipping_pipeline_control where singleton=true) as provider_bridge_verified_at,
      coalesce((select enabled from dropec_private.bot_woo_config where singleton=true),false) as woo_enabled,
      coalesce((select webhook_secret_id is not null from dropec_private.bot_woo_config where singleton=true),false) as woo_webhook_signature_ready,
      exists(select 1 from vault.secrets where name='dropec_bot_internal_key') as internal_key_ready,
      (select count(*)::int from dropec_private.bot_woo_catalog_products where dropi_product_id is not null) as linked_products,
      (select count(*)::int
       from dropec_private.bot_woo_catalog_products c
       where c.dropi_product_id is not null
         and c.approved = true and c.woo_status = 'publish'
         and (select count(*) from dropec_private.shipping_verified_origins o
              where o.dropi_product_id=c.dropi_product_id
                and o.stock_available > 0
                and o.observed_at <= now() and o.valid_until > now())=1
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

Deno.serve(async req=>{try{const u=new URL(req.url);if(req.method==='GET'&&u.pathname.endsWith('/health')){const readiness=await pipelineReadiness();return json({service:'dropec-shipping-quote',status:readiness.status,quote_processing_ready:readiness.quote_processing_ready,mode:'disabled_until_processor_verified'})}if(req.method==='GET'&&u.pathname.endsWith('/diagnostics')){const key=req.headers.get('x-dropec-internal')||'',expected=await internalKey();if(!expected||!eq(key,expected))return new Response('Unauthorized',{status:401,headers:SAFE});const readiness=await pipelineReadiness();return json({ok:true,readiness})}if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:SAFE});const key=req.headers.get('x-dropec-internal')||'',expected=await internalKey();if(!expected||!eq(key,expected))return new Response('Unauthorized',{status:401,headers:SAFE});const readiness=await pipelineReadiness();if(!readiness.quote_processing_ready)return json({ok:false,error:'shipping_pipeline_unavailable'},503);const b=await req.json().catch(()=>({})) as any;return json(await quote(clean(b.platform||'instagram',30),clean(b.sender_id,120)))}catch(e){return json({ok:false,error:'temporary_failure'},503)}});
