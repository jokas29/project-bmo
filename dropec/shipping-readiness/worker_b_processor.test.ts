import {runOneShippingB,validateSignedClaim} from "./worker_b_processor.ts";
import {serializeQuoteRequest} from "./wordpress_quote_bridge.ts";
const chk=(ok:unknown)=>{if(!ok) throw Error("assert_failed")};
const id="11111111-1111-4111-8111-111111111111";
const nonce="22222222-2222-4222-8222-22222222222233333333-3333-4333-8333-333333333333";
const url="https://radarcommerce.byethost7.com/wp-json/dropec/v1/shipping-quote-v2";
const expected={woo_product_id:29,province:"Los Ríos",city:"Babahoyo",amount:25,
  quantity:1,origin:{id:51,cod_dane:"201001001001"}};
const job={id,lease_nonce:nonce,endpoint:url,raw:serializeQuoteRequest(expected),
  signature:"a".repeat(43)+"=",expected,destination_code:"201001013013"};
const ok={ok:true,shipping_amount:3.5,carrier:"Carrier A",origin_code:"201001001001",
  destination_code:"201001013013",options:[{price:3.5,carrier:"Carrier A"}]};
const released="operator_approved_quote_only_v1";
Deno.test("reject live quotes before separate release and never initiate any request",async()=>{
  let n=0;
  const transport=async()=>{n++;return Response.json({ok:true})};
  try{await runOneShippingB("x".repeat(200),"offline",transport,transport);throw Error("accepted")}
  catch(e){chk((e as Error).message==="provider_quote_not_authorized")}
  chk(n===0);
});
Deno.test("signatures, URLs and JSON must match immutable B-origin context",()=>{
  chk(validateSignedClaim(job).raw===job.raw);
  for(const wrong of [
    {...job,endpoint:url.replace("shipping-quote-v2","wake")},
    {...job,raw:job.raw.replace('"quantity":1','"quantity":2')},
    {...job,destination_code:""},
    {...job,signature:"weak"},
  ]) {
    try{validateSignedClaim(wrong);throw Error("unsafe_accepted")}
    catch(e){chk((e as Error).message!=="unsafe_accepted")}
  }
});
Deno.test("complete mock one-quote with 1 signed provider POST, no orders",async()=>{
  const paths:string[]=[];let wpCalls=0;let completion:Record<string,unknown>|undefined;
  const broker=async(uri:RequestInfo|URL,init?:RequestInit)=>{
    const s=String(uri);paths.push(s);
    chk(s.startsWith("https://ubxkqbnzdtgfvphwohzm.supabase.co/"));
    chk(init?.method==="POST" && init.redirect==="error");
    if(s.endsWith("/claim"))return Response.json({ok:true,job});
    if(s.endsWith("/complete")){
      completion=JSON.parse(String(init?.body));
      return Response.json({ok:true,status:"completed"});
    }
    throw Error("unexpected_bridge_operation");
  };
  const wp=async(uri:RequestInfo|URL,init?:RequestInit)=>{
    wpCalls++;chk(String(uri)===url && init?.method==="POST" && init.redirect==="error");
    chk(String(init?.body)===job.raw);
    chk((init?.headers as Record<string,string>)["x-dropec-signature"]===job.signature);
    return Response.json({...ok,raw:{secret:"do_not_forward"}});
  };
  const result=await runOneShippingB("x".repeat(200),released,broker,wp);
  chk(result.status==="completed"&&wpCalls===1&&paths.length===2);
  chk(completion?.ok===true && !!completion?.lease_nonce);
  chk(!(JSON.stringify(completion).includes("do_not_forward")));
});
Deno.test("no quote job means no WordPress or completion request",async()=>{
  let n=0;
  const result=await runOneShippingB("x".repeat(200),released,
    async()=>Response.json({ok:true,job:null}),
    async()=>{n++;return Response.json(ok)});
  chk(result.status==="no_job"&&n===0);
});
Deno.test("provider error is sent as generic retry outcome and never raw provider JSON",async()=>{
  let calls=0,posted:Record<string,unknown>|undefined;
  const broker=async(uri:RequestInfo|URL,init?:RequestInit)=>{
    if(String(uri).endsWith("/claim"))return Response.json({ok:true,job});
    posted=JSON.parse(String(init?.body));return Response.json({ok:true,status:"queued"});
  };
  const result=await runOneShippingB("x".repeat(200),released,broker,
    async()=>{calls++;return Response.json({ok:false,details:{secret:"LEAK"}})});
  chk(result.status==="queued"&&calls===1 && posted?.ok===false);
  chk(!JSON.stringify(posted).includes("LEAK"));
});
Deno.test("bad B lease or altered payload never reaches WordPress",async()=>{
  let calls=0;
  try {
    await runOneShippingB("x".repeat(200),released,
      async()=>Response.json({ok:true,job:{...job,raw:job.raw.replace('"quantity":1','"quantity":4')}}),
      async()=>{calls++;return Response.json(ok)});
    throw Error("unsafe_accepted");
  }catch(e){chk((e as Error).message==="noncanonical_claim_payload")}
  chk(calls===0);
});

Deno.test("ByetHost HTTP 200 HTML browser challenge is never mistaken for a shipping quote",async()=>{
  let providerCalls=0;
  let completed:Record<string,unknown>|undefined;
  const broker=async(uri:RequestInfo|URL,init?:RequestInit)=>{
    if(String(uri).endsWith("/claim"))return Response.json({ok:true,job});
    if(String(uri).endsWith("/complete")){
      completed=JSON.parse(String(init?.body));
      return Response.json({ok:true,status:"failed"});
    }
    throw Error("unexpected_provider_path");
  };
  const wordpress=async()=>{
    providerCalls++;
    return new Response("<html><script>document.cookie='anti_bot'</script></html>",{
      status:200,headers:{"Content-Type":"text/html"}
    });
  };
  const result=await runOneShippingB("x".repeat(200),released,broker,wordpress);
  chk(providerCalls===1&&result.status==="failed");
  chk(completed?.ok===false&&completed.error==="wordpress_hosting_challenge_or_non_json");
  chk(!JSON.stringify(completed).includes("anti_bot"));
});
