import {readOnlyWorkerPreflight} from "./worker_b_preflight_cli.ts";
import {WORKER_B} from "./worker_b_policy.ts";
const base={ACTIONS_ID_TOKEN_REQUEST_URL:"https://pipelines.actions.githubusercontent.com/test?foo=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN:"test-github-request-token"};
const assert=(ok:unknown,message="unexpected")=>{if(!ok)throw Error(message)};
Deno.test("manual OIDC status check never calls WordPress or drops a provider request",async()=>{
  let calls=0;
  const result=await readOnlyWorkerPreflight(base,async(url,init)=>{
    calls++;
    const u=new URL(String(url));
    assert(init?.redirect==="error");
    if(calls===1){
      assert(u.hostname==="pipelines.actions.githubusercontent.com");
      assert(u.searchParams.get("audience")===WORKER_B.audience);
      return Response.json({value:"x".repeat(200)});
    }
    assert(calls===2 && u.hostname==="ubxkqbnzdtgfvphwohzm.supabase.co");
    assert(u.pathname.endsWith("/dropec-shipping-worker-b/status"));
    assert(init?.method==="POST");
    assert((init?.headers as Record<string,string>).Authorization.startsWith("Bearer "));
    return Response.json({ok:true,project:"supabase-b",worker_mode:"manual_only",
      released:false,requirements_satisfied:false});
  });
  assert(calls===2 && result.authenticated && !result.released);
});
Deno.test("rejects a substituted GitHub token endpoint before any network access",async()=>{
  let called=false;
  try{
    await readOnlyWorkerPreflight({...base,ACTIONS_ID_TOKEN_REQUEST_URL:"https://evil.example/token"},
      async()=>{called=true; return Response.json({value:"x".repeat(200)})});
    throw Error("accepted_untrusted_host");
  }catch(error){assert((error as Error).message==="github_oidc_endpoint_not_allowed")}
  assert(!called,"unexpected network access");
});
Deno.test("rejects incorrect project or unpublished broker status",async()=>{
  let count=0;
  try{
    await readOnlyWorkerPreflight(base,async()=>{
      count++;
      return count===1?Response.json({value:"y".repeat(100)}):
        Response.json({ok:true,project:"supabase-a",worker_mode:"manual_only"});
    });
    throw Error("accepted_wrong_project");
  }catch(error){assert((error as Error).message==="unexpected_worker_response")}
});
