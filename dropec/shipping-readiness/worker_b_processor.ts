/**
 * Single-job worker for a FUTURE, separately authorized GitHub manual run.
 * NOT imported by the current offline/status-only workflow.
 * Requires explicit run authorization plus B broker's independent release/DB gates.
 * No Dropi API, order/wallet/payment routes, cron or /wake.
 */
import {
  assertQuoteEndpoint, serializeQuoteRequest, validateQuoteResponse,
  type VerifiedQuoteRequest, type ValidShippingQuote
} from "./wordpress_quote_bridge.ts";

const BRIDGE="https://ubxkqbnzdtgfvphwohzm.supabase.co/functions/v1/dropec-shipping-worker-b";
const LIVE_RELEASE="operator_approved_quote_only_v1";
export type SignedClaim = {
  id: string;
  endpoint: string;
  raw: string;
  signature: string;
  lease_nonce: string;
  expected: VerifiedQuoteRequest;
  destination_code: string;
};
export type OneQuoteResult = {status:"no_job"|"completed"|"already_completed"|"queued"|"failed"};
const fail = (code:string):never=>{throw Error(code)};
async function strictJson(response: Response, maxBytes=128000): Promise<unknown> {
  if(!response.ok) fail("http_status_unavailable");
  if (Number(response.headers.get("content-length")||0)>maxBytes) fail("large_response");
  if(!response.body) fail("missing_body");
  let total=0;
  const chunks:Uint8Array[]=[];
  const reader=response.body!.getReader();
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maxBytes) fail("large_response");
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  const buffer=new Uint8Array(total);
  let at=0;
  for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.length}
  try {return JSON.parse(new TextDecoder().decode(buffer))}
  catch{return fail("invalid_json")}
}
function object(raw:unknown):Record<string,unknown> {
  if(!raw || typeof raw!=="object" || Array.isArray(raw)) return fail("invalid_response");
  return raw as Record<string,unknown>;
}
export function validateSignedClaim(input: unknown): SignedClaim {
  const b=object(input);
  if(!/^[a-f0-9-]{36}$/.test(String(b.id||"")) ||
     !/^[a-f0-9-]{72}$/.test(String(b.lease_nonce||"")) ||
     typeof b.raw!=="string" || !b.signature ||
     !/^[A-Za-z0-9+/]{43}=$/.test(String(b.signature)) ||
     !b.expected || typeof b.expected!=="object" ||
     !/^[0-9]{6,16}$/.test(String(b.destination_code||""))) {
    fail("invalid_signed_claim");
  }
  const endpoint=assertQuoteEndpoint(String(b.endpoint||""));
  const expected=b.expected as VerifiedQuoteRequest;
  const canonical=serializeQuoteRequest(expected);
  if(b.raw!==canonical) fail("noncanonical_claim_payload");
  const body=object(JSON.parse(b.raw));
  if(!body.origin || typeof body.origin!=="object" ||
      (body.origin as Record<string,unknown>).cod_dane!==expected.origin.cod_dane)
    fail("claim_origin_mismatch");
  return {...b,endpoint,expected} as SignedClaim;
}

async function wpQuote(job: SignedClaim, transport: typeof fetch):Promise<ValidShippingQuote> {
  const response=await transport(job.endpoint,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(25000),
    headers:{"Content-Type":"application/json","Accept":"application/json",
      "x-dropec-signature":job.signature,"Cache-Control":"no-store"},
    body:job.raw,
  });
  const reply=await strictJson(response);
  const result=validateQuoteResponse(reply,job.expected);
  if(result.destination_code!==job.destination_code) fail("destination_pin_mismatch");
  return result;
}

async function brokerPost(
  path:"claim"|"complete", jwt:string, body:unknown, transport:typeof fetch
) {
  const response=await transport(BRIDGE+"/"+path,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
    headers:{"Authorization":"Bearer "+jwt,"Content-Type":"application/json"},
    body:JSON.stringify(body),
  });
  const result=object(await strictJson(response));
  if(result.ok!==true) fail("broker_rejected");
  return result;
}
/** Provider calls only happen when separately released; never use in existing CI workflow. */
export async function runOneShippingB(
  jwt:string, approval:string, brokerTransport:typeof fetch, wordpressTransport:typeof fetch,
):Promise<OneQuoteResult> {
  if(approval!==LIVE_RELEASE || jwt.length<20) fail("provider_quote_not_authorized");
  const claim=await brokerPost("claim",jwt,{},brokerTransport);
  if(claim.job===null) return {status:"no_job"};
  const job=validateSignedClaim(claim.job);
  let message:Record<string,unknown>;
  try {
    const quote=await wpQuote(job,wordpressTransport);
    message={id:job.id,lease_nonce:job.lease_nonce,ok:true,quote:{ok:true,...quote}};
  }catch {
    message={id:job.id,lease_nonce:job.lease_nonce,ok:false,error:"provider_quote_failed"};
  }
  const completed=await brokerPost("complete",jwt,message,brokerTransport);
  const status=String(completed.status||"");
  if(status!=="completed" && status!=="already_completed" &&
    status!=="queued" && status!=="failed") fail("unexpected_completion_status");
  return {status:status as OneQuoteResult["status"]};
}
