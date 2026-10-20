import fs from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import sharp from 'sharp';
import {publishImage} from './publisher.js';
const statePath='.karolina/campaign.json';
const feeds=[{name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},{name:'Cointelegraph',url:'https://cointelegraph.com/rss'},{name:'Decrypt',url:'https://decrypt.co/feed'}];
const maxPosts=30,maxDaily=10,spotTarget=12,futuresTarget=18,minPostGapMs=55*60*1000,now=()=>Date.now();
function decode(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();}
function tag(b,n){const r=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'\\s*>','i'),m=b.match(r);return m?decode(m[1]):'';}
function parseFeed(xml,source){return xml.split(/<item\b/i).slice(1).map(x=>x.split(/<\/item>/i)[0]).map(b=>({source,title:tag(b,'title'),link:tag(b,'link'),description:tag(b,'description'),date:tag(b,'pubDate')})).filter(x=>x.title&&/^https?:\/\//i.test(x.link));}
function dayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function load(){try{return JSON.parse(await fs.readFile(statePath,'utf8'));}catch{return {active:false,startedAt:null,endsAt:null,published:0,perDay:{},seen:[],history:[],lastError:null};}}
async function save(s){await fs.mkdir('.karolina',{recursive:true});await fs.writeFile(statePath,JSON.stringify(s,null,2)+'\n');}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function wrap(s,max){const out=[];let line='';for(const w of String(s||'').split(/\s+/)){if((line+' '+w).trim().length>max&&line){out.push(line);line=w;}else line=(line+' '+w).trim();}if(line)out.push(line);return out.slice(0,3);}
async function getJson(url,timeout=12000){
 const host=new URL(url).host;
 for(let attempt=0;attempt<4;attempt++){
  let r;
  try{r=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Karolina-MarketScout/2.1','accept':'application/json'}});}
  catch(e){throw Error('Network request failed for '+host+': '+String(e.cause?.code||e.message||e));}
  if(r.ok)return r.json();
  if(r.status===429&&attempt<3){
   const retryAfter=Number(r.headers.get('retry-after'));
   const waitMs=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,20000):(4000*(attempt+1));
   console.log(host+' rate limited (429); retry '+(attempt+1)+'/3 after '+Math.round(waitMs/1000)+'s');
   await new Promise(resolve=>setTimeout(resolve,waitMs));
   continue;
  }
  throw Error(host+' HTTP '+r.status);
 }
 throw Error(host+' HTTP 429 after retries');
}
const excluded=new Set(['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','TRX','TON','LINK','LTC','BCH','DOT','AVAX','SHIB','USDC','USDT','FDUSD','DAI','EUR','BRL','TRY']);
async function symbols(){
 try{
  const d=await getJson('https://api.binance.vision/api/v3/ticker/24hr',15000);
  const rows=d.filter(x=>String(x.symbol).endsWith('USDT')&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
   .map(x=>({ticker:x.symbol.slice(0,-4),symbol:x.symbol,price:Number(x.lastPrice),change:Number(x.priceChangePercent),volume:Number(x.quoteVolume),trades:Number(x.count),source:'Binance Spot'}))
   .filter(x=>!excluded.has(x.ticker)&&x.price>0&&x.volume>=1500000&&Math.abs(x.change)>=4.5&&x.trades>=1000)
   .sort((a,b)=>Math.abs(b.change)*Math.log10(1+b.volume)-Math.abs(a.change)*Math.log10(1+a.volume));
  if(rows.length>=3)return rows.slice(0,100);
  console.log('Binance market feed returned too few breakouts; falling back to CoinGecko');
 }catch(e){console.log('Binance market feed failed: '+e.message+'; falling back to CoinGecko');}
 const d=await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&price_change_percentage=24h',18000);
 return d.map(x=>({ticker:String(x.symbol||'').toUpperCase(),name:x.name,symbol:String(x.symbol||'').toUpperCase()+'USDT',price:Number(x.current_price),change:Number(x.price_change_percentage_24h),volume:Number(x.total_volume),marketCap:Number(x.market_cap||0),coinId:x.id,image:x.image,source:'CoinGecko'}))
  .filter(x=>x.ticker&&!excluded.has(x.ticker)&&x.price>0&&x.volume>=1500000&&Math.abs(x.change)>=4.5&&(!x.marketCap||x.marketCap<15000000000))
  .sort((a,b)=>Math.abs(b.change)*Math.log10(1+b.volume)-Math.abs(a.change)*Math.log10(1+a.volume)).slice(0,100);
}
async function chartPoints(coin){
 if(coin.coinId){
  const d=await getJson('https://api.coingecko.com/api/v3/coins/'+encodeURIComponent(coin.coinId)+'/market_chart?vs_currency=usd&days=1',15000);
  return (d.prices||[]).map(x=>Number(x[1])).filter(x=>Number.isFinite(x)&&x>0);
 }
 const d=await getJson('https://api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(coin.symbol)+'&interval=1m&limit=60',12000);
 return d.map(x=>Number(x[4])).filter(x=>Number.isFinite(x)&&x>0);
}
function linePath(values){
 const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 return values.map((v,i)=>((i?'L':'M')+(88+i*1024/(values.length-1)).toFixed(1)+' '+(490-(v-min)/span*165).toFixed(1))).join(' ');
}
async function card(coin,values){
  const up=coin.change>=0,accent=up?'#36F5A0':'#FF4F78',accent2=up?'#00C2FF':'#FF9A5B';
  const line=linePath(values),area=line+' L1112 505 L88 505 Z';
  const logoUrl=coin.image||'https://assets.coincap.io/assets/icons/'+encodeURIComponent(coin.ticker.toLowerCase())+'@2x.png';
  let logo=null;
  try{
   const r=await fetch(logoUrl,{signal:AbortSignal.timeout(4500)});
   if(r.ok){
    const raw=await sharp(Buffer.from(await r.arrayBuffer())).resize(78,78,{fit:'cover',position:'centre'}).png().toBuffer();
    const mask=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="78" height="78"><circle cx="39" cy="39" r="38" fill="white"/></svg>');
    logo=await sharp(raw).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
   }
  }catch{}
  const ticker=esc(coin.ticker),fullName=esc(coin.name||coin.fullName||coin.ticker);
  const move=(Number(coin.hourChange??coin.change)>=0?'+':'')+Number(coin.hourChange??coin.change).toFixed(2)+'%';
  const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
  const endX=1112,endY=(490-(values[values.length-1]-min)/span*165).toFixed(1);
  const grid=Array.from({length:6},(_,i)=>'<line x1="72" y1="'+(205+i*58)+'" x2="1128" y2="'+(205+i*58)+'" stroke="#203047" stroke-width="1" opacity=".78"/>').join('');
  const trend=up
   ? '<path d="M0 48 L31 17 L48 34 L82 0 M54 0 H82 V28" fill="none" stroke="'+accent+'" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
   : '<path d="M0 0 L31 31 L48 14 L82 48 M54 48 H82 V20" fill="none" stroke="'+accent+'" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs>'+
  '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050712"/><stop offset=".48" stop-color="#0A1020"/><stop offset="1" stop-color="#11192B"/></linearGradient>'+
  '<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop stop-color="'+accent+'" stop-opacity="0"/><stop offset=".5" stop-color="'+accent+'" stop-opacity=".9"/><stop offset="1" stop-color="'+accent2+'" stop-opacity="0"/></linearGradient>'+
  '<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+accent+'" stop-opacity=".34"/><stop offset="1" stop-color="'+accent+'" stop-opacity=".01"/></linearGradient>'+
  '<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#131D30" stop-opacity=".98"/><stop offset="1" stop-color="#090E1A" stop-opacity=".97"/></linearGradient>'+
  '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>'+
  '</defs><rect width="1200" height="675" fill="url(#bg)"/>'+
  '<circle cx="1020" cy="100" r="250" fill="'+accent+'" opacity=".07"/><circle cx="1040" cy="110" r="165" fill="'+accent2+'" opacity=".045"/>'+
  '<g fill="'+accent+'" opacity=".8"><path d="M102 42 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"/><path d="M1080 192 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"/><circle cx="1110" cy="76" r="2"/><circle cx="995" cy="188" r="2"/></g>'+
  '<path d="M35 177 H1165" stroke="url(#shine)" stroke-width="2" opacity=".9"/>'+
  '<text x="1134" y="57" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="#8F9DB4">LIVE MARKET PULSE</text>'+
  '<rect x="56" y="77" width="1088" height="103" rx="25" fill="url(#panel)" stroke="#34445E" stroke-opacity=".8"/>'+
  '<circle cx="121" cy="128" r="43" fill="'+accent+'" opacity=".13" filter="url(#glow)"/>'+
  '<text x="188" y="121" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="800" letter-spacing="1.5" fill="#FFFFFF">'+ticker+'</text>'+
  '<text x="190" y="151" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="500" fill="#AAB8CE">'+fullName+'</text>'+
  '<rect x="824" y="102" width="288" height="49" rx="24" fill="'+accent+'" fill-opacity=".12" stroke="'+accent+'" stroke-opacity=".55"/>'+
  '<circle cx="849" cy="126" r="5" fill="'+accent+'"/><text x="868" y="133" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" letter-spacing="2" fill="'+accent+'">'+(up?'BULLISH MOMENTUM':'BEARISH MOMENTUM')+'</text>'+
  grid+
  '<path d="'+area+'" fill="url(#fill)"/>'+
  '<path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="18" opacity=".17" filter="url(#glow)" stroke-linecap="round" stroke-linejoin="round"/>'+
  '<path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>'+
  '<path d="M90 516 H1110" stroke="url(#shine)" stroke-width="2" opacity=".85"/>'+
  '<circle cx="'+endX+'" cy="'+endY+'" r="18" fill="'+accent+'" opacity=".14"/><circle cx="'+endX+'" cy="'+endY+'" r="7" fill="'+accent+'" stroke="#FFFFFF" stroke-width="2"/>'+
  '<g transform="translate(1010 225) scale(.9)"><path d="'+(up?'M0 48 L31 17 L48 34 L82 0 M54 0 H82 V28':'M0 0 L31 31 L48 14 L82 48 M54 48 H82 V20')+'" fill="none" stroke="'+accent+'" stroke-width="18" opacity=".25" filter="url(#glow)" stroke-linecap="round" stroke-linejoin="round"/>'+trend+'</g>'+
  '<rect x="56" y="535" width="1088" height="93" rx="24" fill="url(#panel)" stroke="#34445E" stroke-opacity=".78"/>'+
  '<line x1="420" y1="552" x2="420" y2="611" stroke="#34445E"/><line x1="790" y1="552" x2="790" y2="611" stroke="#34445E"/>'+
  '<text x="82" y="568" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#9BAAC0">1H PRICE MOVE</text>'+
  '<text x="80" y="613" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="900" letter-spacing="-1.5" fill="'+accent+'">'+esc(move)+'</text>'+
  '<text x="455" y="568" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#9BAAC0">24H VOLUME</text>'+
  '<text x="455" y="607" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="800" fill="#FFFFFF">'+esc(compactMoney(coin.volume))+'</text>'+
  '<text x="825" y="568" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#9BAAC0">LAST PRICE · USD</text>'+
  '<text x="825" y="607" font-family="Arial,Helvetica,sans-serif" font-size="31" font-weight="800" fill="#FFFFFF">'+esc(formatPrice(coin.price))+'</text></svg>';
  let b=await sharp(Buffer.from(svg)).png().toBuffer();
  if(logo)b=await sharp(b).composite([{input:logo,left:82,top:89}]).png().toBuffer();
  return b;
}
async function stories(s){const all=[];for(const f of feeds){try{const r=await fetch(f.url,{signal:AbortSignal.timeout(10000),headers:{'user-agent':'KarolinaCryptoNews/1.0'}});if(r.ok)all.push(...parseFeed(await r.text(),f.name));}catch(e){console.log('Feed '+f.name+': '+e.message);}}const seen=new Set(s.seen||[]),cut=now()-72*3600000;return all.filter(x=>!seen.has(x.link)&&(!Date.parse(x.date)||Date.parse(x.date)>=cut)).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));}
function parseJson(raw){const t=String(raw||'').trim(),a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)throw Error('AI returned invalid JSON');return JSON.parse(t.slice(a,b+1));}
function compactMoney(value){
 const n=Number(value)||0;
 if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
 if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
 if(n>=1e3)return '$'+(n/1e3).toFixed(0)+'K';
 return '$'+Math.round(n).toLocaleString('en-US');
}
function formatPrice(value){
 const n=Number(value)||0;
 if(n>=1000)return '$'+n.toLocaleString('en-US',{maximumFractionDigits:2});
 if(n>=1)return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
 if(n>=0.01)return '$'+n.toFixed(4);
 return '$'+n.toPrecision(4);
}
function fallbackDraft(coin,mode){
 const side=coin.signalSide|| (coin.change>=0?'LONG':'SHORT');
 const move=(coin.hourChange>=0?'+':'')+Number(coin.hourChange??coin.change).toFixed(2)+'%';
 const price=Number(coin.price),tp=Number(coin.takeProfit),sl=Number(coin.stopLoss);
 const direction=side==='LONG'?'LONG':'SHORT';
 const reason=side==='LONG'
  ? '1h momentum is positive and price is holding above the recent range.'
  : '1h momentum is negative and price is pressing below the recent range.';
 return '🎯 $'+coin.ticker+' — '+direction+' SETUP\n\n'
  +'⚡ 1h move: '+move+' | Volume: '+compactMoney(coin.volume)+'\n'
  +'Entry: '+formatPrice(price)+'\n'
  +'Take profit: '+formatPrice(tp)+'\n'
  +'Stop loss: '+formatPrice(sl)+'\n\n'
  +reason+' Setup is invalid if price hits SL.\n\n'
  +'Would you take this setup or wait? 👇\n'
  +'📈 '+(mode==='futures'?'Binance Futures':'Binance Spot')+': $'+coin.ticker+'\n\n'
  +'#'+coin.ticker+' #'+direction+' '+(mode==='futures'?'#Futures':'#Crypto');
}
async function draft(coin,mode){
 // Keep captions consistent and mobile-friendly: emojis, market facts, a real question,
 // and a clear CTA. Never include raw/public URLs in the Binance Square caption.
 return fallbackDraft(coin,mode);
}
async function postOne(s){
 const today=dayKey();s.perDay=s.perDay||{};
 if((s.perDay[today]||0)>=maxDaily)throw Error('Daily cap reached');
 const list=await symbols();if(!list.length)throw Error('No high-volume 24h breakout tokens found; nothing posted.');
 const history=s.history||[];
 const spotCount=history.filter(x=>x.marketType==='spot').length;
 const futuresCount=history.filter(x=>x.marketType==='futures').length;
 const nextN=(s.published||0)+1;
 const shouldFutures=futuresCount<Math.floor(nextN*futuresTarget/maxPosts) && futuresCount<futuresTarget;
 const mode=shouldFutures?'futures':'spot';
 let marketSet;
 if(mode==='futures'){
  try{
   const data=await getJson('https://fapi.binance.com/fapi/v1/ticker/24hr',15000);
   marketSet=new Set(data.map(x=>x.symbol).filter(x=>String(x).endsWith('USDT')));
  }catch(e){
   // GitHub-hosted runners can be geo-blocked by Binance Futures (HTTP 451).
   // Fall back only to a conservative set of commonly listed USDⓈ-M perpetuals,
   // intersected with live CoinGecko candidates, rather than aborting the whole run.
   console.log('Binance Futures feed unavailable: '+String(e.message||e)+'; using conservative known-perpetual fallback');
   const knownPerpetuals=new Set(('1000SATS 1000PEPE 1000SHIB 1INCH AAVE ACE ADA ALGO ANIME APT ARB ARKM ARK ATOM AVAX BCH BEAM BERA BLUR BNB BONK BRETT BTC CFX CHZ COMP CRV DOGE DOT DYDX EGLD ENA ENS ETC ETH FIL FET FLOW FTM GALA GAS GRT HBAR HIFI ICP IMX INJ IOTA JASMY JTO JUP KAS KAVA LDO LINK LISTA LTC MANA MANTA MASK MEME METIS MINA MKR NEAR NEIRO NOT OP ORDI PENDLE PEOPLE PEPE PNUT POL POLYX POPCAT PYTH QNT QTUM RENDER RIF RLC RUNE SAND SEI SHIB SKL SNX SOL STX SUI SUPER SUSHI TAO THETA TIA TLM TNSR TON TRB TRX UNI USUAL VET W WIF WLD XAI XLM XRP XTZ YGG ZEC ZEN ZK ZRO ZRX').split(' '));
   marketSet=new Set(list.filter(x=>knownPerpetuals.has(x.ticker)).map(x=>x.ticker+'USDT'));
  }
 }else{
  try{
   const data=await getJson('https://api.binance.com/api/v3/ticker/24hr',15000);
   marketSet=new Set(data.map(x=>x.symbol).filter(x=>String(x).endsWith('USDT')));
  }catch(e){
   console.log('Binance Vision spot-list fallback failed: '+String(e.message||e));
   // When Binance market endpoints are unreachable, continue using CoinGecko-backed
   // candidates; their price chart is available separately and publishing can still proceed.
   marketSet=new Set(list.filter(x=>x.coinId).map(x=>x.ticker+'USDT'));
  }
 }
 const seen=new Set(s.seen||[]);
 const candidates=list.filter(x=>!seen.has(x.ticker)&&marketSet.has(x.ticker+'USDT')).slice(0,12);
 const ranked=[];
 for(const candidate of candidates){
  try{
   let closes,highs,lows,atr;
   if(candidate.coinId){
    // Binance endpoints are geo/DNS blocked on some GitHub-hosted runners.
    // CoinGecko's market chart provides a usable fallback for hourly momentum.
    const prices=await chartPoints(candidate);
    if(prices.length<8)continue;
    closes=prices;
    const recent=prices.slice(-4);
    highs=recent;lows=recent;
    const hourIndex=Math.max(0,prices.length-13);
    const first=prices[hourIndex],lastPrice=prices[prices.length-1];
    const moves=prices.slice(-13).slice(1).map((v,i)=>Math.abs(v-prices[prices.length-13+i])).filter(v=>Number.isFinite(v)&&v>0);
    atr=moves.length?moves.reduce((n,x)=>n+x,0)/moves.length*2.5:0;
    const hourChange=(lastPrice-first)/first*100;
    const recentHigh=Math.max(...highs),recentLow=Math.min(...lows);
    if(!Number.isFinite(hourChange)||Math.abs(hourChange)<0.8||!atr||lastPrice<=0)continue;
    const signalSide=hourChange>0?'LONG':'SHORT',price=lastPrice;
    const stopLoss=signalSide==='LONG'?Math.min(recentLow,price-1.35*atr):Math.max(recentHigh,price+1.35*atr);
    const risk=Math.abs(price-stopLoss);
    if(!risk||risk/price>0.045)continue;
    const takeProfit=signalSide==='LONG'?price+1.8*risk:price-1.8*risk;
    ranked.push({...candidate,price,change:hourChange,hourChange,signalSide,takeProfit,stopLoss,rank:Math.abs(hourChange)*Math.log10(1+candidate.volume)});
   }else{
    const candles=await getJson('https://api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(candidate.symbol)+'&interval=1m&limit=60',10000);
    if(candles.length<50)continue;
    closes=candles.map(x=>Number(x[4]));highs=candles.map(x=>Number(x[2]));lows=candles.map(x=>Number(x[3]));
    const first=closes[0],lastPrice=closes[closes.length-1],hourChange=(lastPrice-first)/first*100;
    const recentHigh=Math.max(...highs.slice(-15)),recentLow=Math.min(...lows.slice(-15));
    const ranges=candles.slice(-20).map(x=>Number(x[2])-Number(x[3])).filter(x=>x>0);
    atr=ranges.reduce((n,x)=>n+x,0)/Math.max(1,ranges.length);
    if(!Number.isFinite(hourChange)||Math.abs(hourChange)<0.8||!atr||lastPrice<=0)continue;
    const signalSide=hourChange>0?'LONG':'SHORT',price=lastPrice;
    const stopLoss=signalSide==='LONG'?Math.min(recentLow,price-1.35*atr):Math.max(recentHigh,price+1.35*atr);
    const risk=Math.abs(price-stopLoss);
    if(!risk||risk/price>0.045)continue;
    const takeProfit=signalSide==='LONG'?price+1.8*risk:price-1.8*risk;
    ranked.push({...candidate,price,change:hourChange,hourChange,signalSide,takeProfit,stopLoss,rank:Math.abs(hourChange)*Math.log10(1+candidate.volume)});
   }
  }catch(e){console.log('market scan skipped '+candidate.ticker+': '+String(e.message||e));}
 }
 ranked.sort((a,b)=>b.rank-a.rank);
 const candidatesRanked=ranked.slice(0,12);
 let last='No unused token passed the one-hour momentum and liquidity filters';
 for(const original of candidatesRanked){
  const coin={...original,spotUrl:'https://www.binance.com/en/trade/'+original.ticker+'_USDT?type=spot',futuresUrl:'https://www.binance.com/en/futures/'+original.ticker+'USDT'};
  try{
   const values=await chartPoints(coin);if(values.length<8)throw Error('Not enough real chart points');
   const text=await draft(coin,mode),img=await card(coin,values);
   const r=await publishImage(text,img,'market-'+mode+'-'+coin.ticker.toLowerCase()+'-'+Date.now()+'.png');
   const entry={at:new Date().toISOString(),ticker:coin.ticker,change:coin.change,volume:coin.volume,marketType:mode,text,url:r.url||null,postId:r.id||null};
   s.published=(s.published||0)+1;s.perDay[today]=(s.perDay[today]||0)+1;s.seen=(s.seen||[]).concat(coin.ticker).slice(-300);s.history=(s.history||[]).concat(entry).slice(-100);s.lastError=null;
   console.log('PUBLISHED '+s.published+'/'+maxPosts+' '+mode.toUpperCase()+' $'+coin.ticker+' '+coin.change.toFixed(2)+'% '+(r.url||'no URL'));
   console.log('MIX spot='+spotCount+' futures='+futuresCount+' targets='+spotTarget+'/'+futuresTarget);
   console.log('TEXT: '+text);return true;
  }catch(e){last=String(e.message||e);console.log('Skipped $'+coin.ticker+': '+last);}
 }
 throw Error('No eligible '+mode+' token could be published. Last issue: '+last);
}
async function main(){
 let s=await load();const event=process.env.GITHUB_EVENT_NAME||'';
 if(event==='push'){console.log('Publishing paused: push runs only validate code.');return;}
 if(event==='schedule'&&s.planVersion!==2){console.log('Scheduled run waiting for manual pilot start.');return;}
 if(event==='workflow_dispatch'&&s.planVersion!==2){s={active:true,startedAt:new Date().toISOString(),endsAt:new Date(now()+72*3600000).toISOString(),published:0,perDay:{},seen:[],history:[],lastError:null,planVersion:2};console.log('New 3-day pilot starts '+s.startedAt+' ends '+s.endsAt+' target='+maxPosts+' mix spot='+spotTarget+' futures='+futuresTarget);}
 if(!s.active||(s.published||0)>=maxPosts||now()>=Date.parse(s.endsAt)){s.active=false;s.lastError='Pilot complete or time expired';await save(s);console.log('Finished '+s.published+'/'+maxPosts);return;}
 try{const lastPost=Date.parse((s.history||[]).at(-1)?.at||'');if(event!=='push'&&Number.isFinite(lastPost)&&now()-lastPost<minPostGapMs){console.log('Throttle: last post is less than 55 minutes old; skipping publish.');return;}if(!process.env.BINANCE_SQUARE_OPENAPI_KEY)throw Error('Missing BINANCE_SQUARE_OPENAPI_KEY; no post sent.');await postOne(s);}catch(e){s.lastError=String(e.message||e).slice(0,500);console.error('POST FAILED: '+s.lastError);}
 if(s.published>=maxPosts||now()>=Date.parse(s.endsAt))s.active=false;await save(s);console.log('PILOT '+(s.active?'ACTIVE':'FINISHED')+' '+s.published+'/'+maxPosts+' perDay='+JSON.stringify(s.perDay)+' error='+(s.lastError||'none'));if(s.lastError)process.exitCode=1;
}
main().catch(e=>{console.error('FATAL: '+String(e.message||e));process.exitCode=1;});
