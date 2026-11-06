/**
 * DropEC: Ecuador direct-provider quote boundary, STAGED/OFFLINE.
 *
 * This module has NO fetch, Dropi OAuth tokens, order APIs, /wake, cron or
 * mutable commerce flag. It is not wired into a worker or deployed.
 *
 * Per Dropi's tool contract reported through Claude on 2026-10-17,
 * quote_shipping accepts cash_on_delivery, destination_city and products.
 * It DOES NOT accept an origin warehouse. A returned rate without provider
 * confirmation of the actual origin may ONLY be shown as diagnostic, never
 * used to price a customer checkout.
 */
type Row = Record<string,unknown>;
const object = (x:unknown):x is Row => x!==null&&typeof x==="object"&&!Array.isArray(x);
const pin = (x:unknown):x is string => typeof x==="string"&&/^[0-9]{6,16}$/.test(x);
const id = (x:unknown) => Number.isSafeInteger(x)&&Number(x)>0;
const observed = (x:unknown):x is string => typeof x==="string"&&Number.isFinite(Date.parse(x));
export class ProviderReadinessError extends Error {
 constructor(public readonly reason:string){super(reason);this.name="ProviderReadinessError"}
}
function block(reason:string):never{throw new ProviderReadinessError(reason)}
export type VerifiedDropiContext = {
 accountCountry:"EC";
 productId:number;
 productType:"SIMPLE"|"VARIABLE"|"COMBO";
 variationId?:number;
 unitAmount:number;
 quantity:number;
 origin:{
   warehouseId:number;cityId:number;daneCode:string;
   stockAvailable:number;observedAt:string;validUntil:string;
   source:"authenticated_dropi_ecommerce";provenance:string;
 };
 destination:{
   cityId:number;daneCode:string;zipCode:string|null;
   observedAt:string;validUntil:string;
   source:"authenticated_dropi_city_catalog";provenance:string;
 };
};
const within24=(from:unknown,until:unknown,now:Date)=>{
 if(!observed(from)||!observed(until))return false;
 const t=now.valueOf(),a=Date.parse(from),b=Date.parse(until);
 return a<=t&&a>=t-86400000&&b>t&&b>a&&b<=a+86400000;
};
export function verifiedContext(x:unknown,now=new Date()):VerifiedDropiContext {
 if(!object(x)||x.accountCountry!=="EC"||!id(x.productId)||
    !["SIMPLE","VARIABLE","COMBO"].includes(String(x.productType))||
    !id(x.quantity)||Number(x.quantity)>20||
    typeof x.unitAmount!=="number"||!Number.isFinite(x.unitAmount)||
    x.unitAmount<=0||x.unitAmount>100000)block("invalid_country_product_or_quantity");
 if(x.productType==="VARIABLE"?!id(x.variationId):x.variationId!==undefined)
   block("invalid_variation");
 const o=x.origin,d=x.destination;
 if(!object(o)||!id(o.warehouseId)||!id(o.cityId)||!pin(o.daneCode)||
    !id(o.stockAvailable)||Number(o.stockAvailable)<Number(x.quantity)||
    o.source!=="authenticated_dropi_ecommerce"||
    typeof o.provenance!=="string"||o.provenance.length<8||
    !within24(o.observedAt,o.validUntil,now))
   block("official_origin_unverified_or_stale");
 if(!object(d)||!id(d.cityId)||!pin(d.daneCode)||
    !(d.zipCode===null||typeof d.zipCode==="string"&&d.zipCode.length<=64)||
    d.source!=="authenticated_dropi_city_catalog"||
    typeof d.provenance!=="string"||d.provenance.length<8||
    !within24(d.observedAt,d.validUntil,now))
   block("official_destination_unverified_or_stale");
 return x as VerifiedDropiContext;
}
/** Accepts verified private B data only; never take context from public request. */
export function buildReadonlyMcpQuote(x:unknown,now=new Date()) {
 const c=verifiedContext(x,now);
 return {
  cash_on_delivery:false,
  destination_city:{
    id:c.destination.cityId,dane_code:c.destination.daneCode,
    zip_code:c.destination.zipCode,
  },
  products:[{
    id:c.productId,type:c.productType,quantity:c.quantity,
    price:c.unitAmount,
    ...(c.productType==="VARIABLE"?{variation_id:c.variationId}:{}),
  }],
 };
}
/**
 * Dropi returns rates with fractional cents (e.g. $5.1175).
 * Round UP to chargeable cents for internal price comparisons; never round
 * down or present the older $4.52 value as a current carrier quotation.
 */
export function providerAmountToCents(raw:unknown):number {
 const value=typeof raw==="number"&&Number.isFinite(raw)?String(raw):raw;
 if(typeof value!=="string"||!/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,8})?$/.test(value))
   return block("invalid_provider_amount");
 const [d,f=""]=value.split(".");
 const cents=Number(d)*100+Number(f.padEnd(2,"0").slice(0,2));
 const extra=f.length>2&&/[1-9]/.test(f.slice(2));
 const total=cents+(extra?1:0);
 if(total<1||total>50000)return block("invalid_provider_amount");
 return total;
}
export type ProofOfQuoteOrigin={
 source:"dropi_authenticated_quote_result";
 originWarehouseId:number;originCityId:number;originDaneCode:string;
 destinationCityId:number;destinationDaneCode:string;productId:number;
};
export function acceptExactOfficialRoute(
 context:unknown,offer:unknown,now=new Date(),
):{carrier:string;shippingAmountCents:number}|never{
 const c=verifiedContext(context,now);
 if(!object(offer)||offer.provider_error===true||
    !object(offer.proof)||!object(offer.price))
    return block("quote_unverified");
 const proof=offer.proof as Row;
 // The MCP quote_shipping output does not necessarily echo warehouse origin.
 // Do not create a proof locally or synthesize it from B's request.
 if(proof.source!=="dropi_authenticated_quote_result"||
    Number(proof.originWarehouseId)!==c.origin.warehouseId||
    Number(proof.originCityId)!==c.origin.cityId||
    proof.originDaneCode!==c.origin.daneCode||
    Number(proof.destinationCityId)!==c.destination.cityId||
    proof.destinationDaneCode!==c.destination.daneCode||
    Number(proof.productId)!==c.productId)
    return block("provider_route_not_attested");
 if(typeof offer.carrier!=="string"||
    !/^[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._\-]{3,70}$/.test(offer.carrier))
    return block("invalid_carrier");
 if(!Object.hasOwn(offer.price,"usd"))return block("invalid_provider_amount");
 return {carrier:offer.carrier,shippingAmountCents:providerAmountToCents(offer.price.usd)};
}
