const SPOT='https://api.binance.com';
const FUT='https://fapi.binance.com';
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Market API HTTP '+r.status);return r.json();}
const n=x=>Number.isFinite(Number(x))?Number(x):0;
const eligible=x=>/^[A-Z0-9]+USDT$/.test(x.symbol||'')&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol||'');
function normalize(rows){return rows.filter(eligible).map(x=>({symbol:x.symbol,price:n(x.lastPrice),change24h:n(x.priceChangePercent),quoteVolume:n(x.quoteVolume),high:n(x.highPrice),low:n(x.lowPrice),trades:n(x.count)})).filter(x=>x.price>0&&x.quoteVolume>0);}
export async function getMarketSnapshot(){
 const results=await Promise.allSettled([get(SPOT+'/api/v3/ticker/24hr'),get(FUT+'/fapi/v1/ticker/24hr')]);
 const spot=results[0].status==='fulfilled'?normalize(results[0].value):[];
 const futures=results[1].status==='fulfilled'?normalize(results[1].value):[];
 if(!spot.length&&!futures.length)throw new Error('Both public Binance market endpoints failed');
 let funding=[];
 try{funding=(await get(FUT+'/fapi/v1/premiumIndex')).map(x=>({symbol:x.symbol,fundingRate:n(x.lastFundingRate)}));}catch{}
 const fm=new Map(funding.map(x=>[x.symbol,x.fundingRate]));
 const fe=futures.map(x=>({...x,fundingRate:fm.get(x.symbol)}));
 const avg=a=>a.slice(0,30).reduce((s,x)=>s+Math.abs(x.change24h),0)/Math.max(1,Math.min(30,a.length));
 const a=avg(spot),b=avg(fe);
 const stressed=fe.filter(x=>Math.abs(x.fundingRate||0)>.0005).length;
 const movers=a=>a.slice().sort((x,y)=>Math.abs(y.change24h)-Math.abs(x.change24h)).slice(0,20);
 return {fetchedAt:new Date().toISOString(),coverage:{spotPairs:spot.length,futuresPairs:fe.length,fundingPairs:funding.length},summary:{avgAbsSpot24hPct:+a.toFixed(2),avgAbsFutures24hPct:+b.toFixed(2),elevatedFundingCount:stressed,suggestedMarket:b>a*1.15&&stressed<8?'futures':'spot'},topMovers:movers(spot),highVolume:spot.slice().sort((x,y)=>y.quoteVolume-x.quoteVolume).slice(0,20),futuresMovers:movers(fe)};
}
export function chooseCandidate(snapshot,state){
 const market=state.settings.marketMode==='adaptive'?snapshot.summary.suggestedMarket:(Math.random()*100<state.settings.spotPercent?'spot':'futures');
 const pool=market==='futures'?snapshot.futuresMovers:snapshot.topMovers;
 const recent=new Set((state.seenTopics||[]).slice(-30));
 const candidate=(pool.filter(x=>!recent.has(x.symbol))[0]||pool[0]);
 if(!candidate)throw new Error('No candidate found');
 return {market,coin:candidate,snapshot};
}
