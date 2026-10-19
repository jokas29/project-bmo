import {
  verifiedContext, buildReadonlyMcpQuote, providerAmountToCents,
  acceptExactOfficialRoute, ProviderReadinessError,
} from "./dropi_direct_ec_policy.ts";
const now=new Date("2026-10-19T20:00:00Z");
const base={
 accountCountry:"EC" as const, productId:20566,productType:"SIMPLE" as const,
 quantity:1,unitAmount:32,
 origin:{
  warehouseId:523,cityId:732,daneCode:"201001002001",stockAvailable:131,
  observedAt:"2026-10-19T19:00:00Z",validUntil:"2026-10-20T18:00:00Z",
  source:"authenticated_dropi_ecommerce" as const,provenance:"official-read-of-product20566",
 },
 destination:{
  cityId:700,daneCode:"201001013001",zipCode:"8",
  observedAt:"2026-10-19T19:00:00Z",validUntil:"2026-10-20T18:00:00Z",
  source:"authenticated_dropi_city_catalog" as const,provenance:"official-citylist-babahoyo",
 }
};
// ALL data above is MOCK. Historical identifiers DO NOT represent live verification.
function check(x:unknown,why="assert_failed"){if(!x)throw Error(why)}
function blocked(fn:()=>unknown,code:string){
 try{fn()}catch(e){
   if(e instanceof ProviderReadinessError&&e.reason===code)return;
   throw e;
 }
 throw Error("expected_"+code);
}
Deno.test("Ecuador-only read-only MCP request never contains order/create fields",()=>{
 const input=buildReadonlyMcpQuote(base,now);
 check(input.cash_on_delivery===false);
 check(input.products.length===1 && input.products[0].id===20566);
 check(input.products[0].quantity===1 && input.products[0].price===32);
 check(input.destination_city.id===700 && input.destination_city.dane_code==="201001013001");
 check(!JSON.stringify(input).includes("order_id"));
 check(!JSON.stringify(input).includes("create_order"));
});
Deno.test("Colombia account and unsigned/unverified snapshots cannot become Ecuador quote",()=>{
 blocked(()=>verifiedContext({...base,accountCountry:"CO"},now),"invalid_country_product_or_quantity");
 blocked(()=>verifiedContext({...base,origin:{...base.origin,source:"screenshot"}},now),"official_origin_unverified_or_stale");
 blocked(()=>verifiedContext({...base,destination:{...base.destination,source:"historical_record"}},now),"official_destination_unverified_or_stale");
});
Deno.test("historical 8-Oct stock and mismatched/empty product stocks reject",()=>{
 blocked(()=>verifiedContext({...base,origin:{...base.origin,observedAt:"2026-10-08T11:18:59Z",validUntil:"2026-10-09T11:18:59Z"}},now),"official_origin_unverified_or_stale");
 blocked(()=>verifiedContext({...base,origin:{...base.origin,stockAvailable:0}},now),"official_origin_unverified_or_stale");
 blocked(()=>verifiedContext({...base,quantity:21},now),"invalid_country_product_or_quantity");
});
Deno.test("Babahoyo cannot default to either DANE code without fresh official city catalogue",()=>{
 blocked(()=>verifiedContext({...base,destination:{...base.destination,source:"mcp-claude-history"}},now),"official_destination_unverified_or_stale");
 blocked(()=>verifiedContext({...base,destination:{...base.destination,validUntil:"2026-10-18T21:00:00Z"}},now),"official_destination_unverified_or_stale");
});
Deno.test("MCP rate with missing ORIGIN evidence remains diagnostic only",()=>{
 const quote={carrier:"LAARCOURIER",price:{usd:"5.1175"}};
 blocked(()=>acceptExactOfficialRoute(base,quote,now),"quote_unverified");
 blocked(()=>acceptExactOfficialRoute(base,{...quote,proof:{source:"dropi_authenticated_quote_result"}},now),"provider_route_not_attested");
});
Deno.test("route attestation binds exact origin and destination; no shipping fee if wrong",()=>{
 const proof={source:"dropi_authenticated_quote_result",originWarehouseId:523,
  originCityId:732,originDaneCode:"201001002001",destinationCityId:700,
  destinationDaneCode:"201001013001",productId:20566};
 const quote={carrier:"LAARCOURIER",price:{usd:"5.1175"},proof};
 check(acceptExactOfficialRoute(base,quote,now).shippingAmountCents===512);
 blocked(()=>acceptExactOfficialRoute(base,{...quote,proof:{...proof,originWarehouseId:999}},now),"provider_route_not_attested");
 blocked(()=>acceptExactOfficialRoute(base,{...quote,proof:{...proof,destinationDaneCode:"201001013013"}},now),"provider_route_not_attested");
 blocked(()=>acceptExactOfficialRoute(base,{...quote,proof:{...proof,productId:3481}},now),"provider_route_not_attested");
});
Deno.test("fractional cents never get rounded down to undercharge a customer",()=>{
 for(const [amount,cents] of [["5.1175",512],["5.16925",517],["0.001",1],["32",3200],["12.50000",1250]])check(providerAmountToCents(amount)===cents);
 blocked(()=>providerAmountToCents("5.1175 USD"),"invalid_provider_amount");
 blocked(()=>providerAmountToCents(-1),"invalid_provider_amount");
 blocked(()=>providerAmountToCents(0),"invalid_provider_amount");
 blocked(()=>providerAmountToCents("1e10"),"invalid_provider_amount");
});
