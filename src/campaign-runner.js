import fs from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import sharp from 'sharp';
import {publishImage} from './publisher.js';
const statePath='.karolina/campaign.json';
const feeds=[{name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},{name:'Cointelegraph',url:'https://cointelegraph.com/rss'},{name:'Decrypt',url:'https://decrypt.co/feed'}];
const maxPosts=720,maxDaily=24,minPostGapMs=55*60*1000,now=()=>Date.now();
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
   const waitMs=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,3000):(1500*(attempt+1));
   console.log(host+' rate limited (429); retry '+(attempt+1)+'/3 after '+Math.round(waitMs/1000)+'s');
   await new Promise(resolve=>setTimeout(resolve,waitMs));
   continue;
  }
  throw Error(host+' HTTP '+r.status);
 }
 throw Error(host+' HTTP 429 after retries');
}
const excluded=new Set(['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','TRX','TON','LINK','LTC','BCH','DOT','AVAX','SHIB','USDC','USDT','FDUSD','DAI','EUR','BRL','TRY']);
const knownPerpetuals=new Set(('1000SATS 1000PEPE 1000SHIB 1INCH AAVE ACE ADA ALGO ANIME APT ARB ARKM ARK ATOM AVAX BCH BEAM BERA BLUR BNB BONK BRETT BTC CFX CHZ COMP CRV DOGE DOT DYDX EGLD ENA ENS ETC ETH FIL FET FLOW FTM GALA GAS GRT HBAR HIFI ICP IMX INJ IOTA JASMY JTO JUP KAS KAVA LDO LINK LISTA LTC MANA MANTA MASK MEME METIS MINA MKR NEAR NEIRO NOT OP ORDI PENDLE PEOPLE PEPE PNUT POL POLYX POPCAT PYTH QNT QTUM RENDER RIF RLC RUNE SAND SEI SHIB SKL SNX SOL STX SUI SUPER SUSHI TAO THETA TIA TLM TNSR TON TRB TRX UNI USUAL VET W WIF WLD XAI XLM XRP XTZ YGG ZEC ZEN ZK ZRO ZRX').split(' '));
async function symbols(){
 try{
  const rows=await getJson('https://fapi.binance.com/fapi/v1/ticker/24hr',15000);
  return rows.filter(x=>String(x.symbol).endsWith('USDT')&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
   .map(x=>({ticker:x.symbol.slice(0,-4),symbol:x.symbol,price:Number(x.lastPrice),change:Number(x.priceChangePercent),volume:Number(x.quoteVolume),trades:Number(x.count),source:'Binance USD-M Futures'}))
   .filter(x=>!excluded.has(x.ticker)&&x.price>0&&x.volume>=1500000&&Math.abs(x.change)>=3.5&&x.trades>=500)
   .sort((a,b)=>Math.abs(b.change)*Math.log10(1+b.volume)-Math.abs(a.change)*Math.log10(1+a.volume)).slice(0,100);
 }catch(e){
  if(!String(e.message||e).includes('HTTP 451'))throw e;
  console.log('Binance USD-M Futures API is geo-blocked on this runner; using OKX USDT perpetual swap data, restricted to known Binance perpetual tickers.');
  const rows=await getJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP',15000);
  return (rows.data||[]).filter(x=>String(x.instId).endsWith('-USDT-SWAP'))
   .map(x=>({ticker:String(x.instId).split('-')[0],symbol:String(x.instId).split('-')[0]+'USDT',okxInstId:x.instId,price:Number(x.last),change:(Number(x.last)/Number(x.open24h)-1)*100,volume:Number(x.volCcy24h||0)*Number(x.last),trades:0,source:'OKX USDT perpetual'}))
   .filter(x=>knownPerpetuals.has(x.ticker)&&!excluded.has(x.ticker)&&x.price>0&&Number.isFinite(x.change)&&x.volume>=1500000&&Math.abs(x.change)>=3.5)
   .sort((a,b)=>Math.abs(b.change)*Math.log10(1+b.volume)-Math.abs(a.change)*Math.log10(1+a.volume)).slice(0,100);
 }
}
async function futuresCandles(coin){
 if(coin.okxInstId){
  const d=await getJson('https://www.okx.com/api/v5/market/candles?instId='+encodeURIComponent(coin.okxInstId)+'&bar=5m&limit=60',12000);
  return (d.data||[]).slice().reverse().map(x=>({open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])}));
 }
 const d=await getJson('https://fapi.binance.com/fapi/v1/klines?symbol='+encodeURIComponent(coin.symbol)+'&interval=5m&limit=60',12000);
 return d.map(x=>({open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])}));
}
async function chartPoints(coin){
 return (await futuresCandles(coin)).map(x=>x.close).filter(x=>Number.isFinite(x)&&x>0);
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
function fallbackDraft(coin){
 const side=coin.signalSide,hour=Number(coin.hourChange),day=Number(coin.change24h);
 const price=Number(coin.price),tp=Number(coin.takeProfit),stretch=Number(coin.stretchTarget),sl=Number(coin.stopLoss);
 if(!(price>0&&tp>0&&stretch>0&&sl>0))throw Error('Invalid Futures entry/TP/SL levels');
 const ticker='$'+coin.ticker,signed=n=>(n>=0?'+':'')+n.toFixed(2)+'%';
 const favorable=(tp/price-1)*(side==='LONG'?1:-1)*100,extended=(stretch/price-1)*(side==='LONG'?1:-1)*100,adverse=(1-sl/price)*(side==='LONG'?1:-1)*100;
 const entry=formatPrice(price),target=formatPrice(tp),runner=formatPrice(stretch),stop=formatPrice(sl);
 let hash=0;for(const ch of coin.ticker)hash=(hash*33+ch.charCodeAt(0))>>>0;hash=(hash+(Number(coin.variantSeed)||0)*17)>>>0;
 const variants=[
  side==='LONG'?'After the pullback, buyers are trying to reclaim the 1H range.':'The bounce is weak so far; sellers still have the cleaner structure.',
  side==='LONG'?'Momentum turned up on the 1H chart. I want price to defend the last swing low.':'The last 1H support gave way. A failed reclaim would keep the short idea alive.',
  side==='LONG'?'This is a breakout attempt, not a chase: the retest is the key.':'This is a breakdown watch, not a blind short: the retest decides.',
  side==='LONG'?'Higher low + improving momentum. The setup fails below the marked stop.':'Lower high + fading bounce. The setup fails above the marked stop.',
  side==='LONG'?'If buyers hold this zone, there may be room for another leg.':'If sellers defend this zone, the next leg could extend lower.',
  side==='LONG'?'I’m watching the 1H close. A weak close cancels the bullish case.':'I’m watching the 1H close. A strong reclaim cancels the bearish case.'
 ];
 const opener=variants[hash%variants.length],heading=side==='LONG'?'🟢 LONG':'🔴 SHORT',direction='#'+side;
 const layouts=[
  ()=>ticker+' '+signed(hour)+' on 1H. '+opener+'\n'+heading+' · Entry '+entry+'\nTP1 '+target+' ('+signed(favorable)+') · stretch '+runner+' ('+signed(extended)+')\nSL '+stop+' ('+signed(-adverse)+')\n#Perpetual #Futures '+direction,
  ()=> '1H setup: '+ticker+'\n'+opener+'\n'+heading+' '+entry+' → '+target+'\nStretch: '+runner+' | invalidation: '+stop+'\n24H '+signed(day)+' · '+signed(hour)+' in 1H\n#Perpetual #Futures '+direction,
  ()=>ticker+' is moving '+signed(hour)+' in 1H.\n'+heading+' · Entry '+entry+'\nTP1 '+target+'; stretch '+runner+'.\nSL '+stop+' ('+signed(-adverse)+').\n'+opener+'\n#Perpetual #Futures '+direction,
  ()=>opener+'\n'+ticker+' · '+heading+'\nEntry '+entry+' | TP '+target+' | stretch '+runner+'\nSL '+stop+'\n1H '+signed(hour)+' / 24H '+signed(day)+'\n#Perpetual #Futures '+direction
 ];
 return layouts[hash%layouts.length]()+ '\n{future}('+coin.symbol+')';
}
async function draft(coin){return fallbackDraft(coin);}

async function postOne(s){
 const today=dayKey();s.perDay=s.perDay||{};
 if((s.perDay[today]||0)>=maxDaily)throw Error('Daily cap reached');
 const list=await symbols();if(!list.length)throw Error('No liquid Binance USD-M Futures breakout tokens found; nothing posted.');
 const history=s.history||[],recentUsed=new Set(history.filter(x=>now()-Date.parse(x.at||'')<6*60*60*1000).map(x=>x.ticker));
 const ranked=[];
 for(const candidate of list.filter(x=>!recentUsed.has(x.ticker)).slice(0,30)){
  try{
   const candles=await futuresCandles(candidate);
   if(candles.length<30)continue;
   const closes=candles.map(x=>x.close),price=closes.at(-1),hourBase=closes.at(-13),hourChange=(price/hourBase-1)*100;
   if(!Number.isFinite(hourChange)||Math.abs(hourChange)<0.65||price<=0)continue;
   const recent=candles.slice(-12);
   const ranges=candles.slice(-15).map((x,i,a)=>Math.max(x.high-x.low,Math.abs(x.high-(a[i-1]?.close??x.open)),Math.abs(x.low-(a[i-1]?.close??x.open))));
   const atr=ranges.reduce((sum,x)=>sum+x,0)/ranges.length;if(!(atr>0))continue;
   const signalSide=hourChange>=0?'LONG':'SHORT',swingLow=Math.min(...recent.map(x=>x.low)),swingHigh=Math.max(...recent.map(x=>x.high));
   const stopLoss=signalSide==='LONG'?Math.min(swingLow,price-1.35*atr):Math.max(swingHigh,price+1.35*atr),risk=Math.abs(price-stopLoss);
   if(!(risk>0)||risk/price>0.045)continue;
   const takeProfit=signalSide==='LONG'?price+2*risk:price-2*risk,stretchTarget=signalSide==='LONG'?price+3*risk:price-3*risk;
   if(takeProfit<=0||stretchTarget<=0||Math.abs(takeProfit-price)/price<0.012)continue;
   ranked.push({...candidate,price,change24h:candidate.change,hourChange,signalSide,takeProfit,stretchTarget,stopLoss,rank:Math.abs(hourChange)*Math.log10(1+candidate.volume)});
  }catch(e){console.log('Futures scan skipped '+candidate.ticker+': '+String(e.message||e));}
 }
 ranked.sort((a,b)=>b.rank-a.rank);
 let last='No token passed the USD-M Futures 1H momentum, liquidity and risk filters';
 for(const coin of ranked.slice(0,12)){
  try{
   const values=await chartPoints(coin);if(values.length<8)throw Error('Not enough Futures chart points');
   coin.variantSeed=s.published||0;const text=await draft(coin),img=await card(coin,values);
   const r=await publishImage(text,img,'market-futures-'+coin.ticker.toLowerCase()+'-'+Date.now()+'.png',{tendency:coin.signalSide==='LONG'?'bullish':'bearish'});
   const entry={at:new Date().toISOString(),ticker:coin.ticker,change:coin.hourChange,volume:coin.volume,marketType:'futures',text,url:r.url||null,postId:r.id||null};
   s.published=(s.published||0)+1;s.perDay[today]=(s.perDay[today]||0)+1;s.seen=(s.seen||[]).concat(coin.ticker).slice(-300);s.history=(s.history||[]).concat(entry).slice(-100);s.lastError=null;
   console.log('PUBLISHED '+s.published+'/'+maxPosts+' FUTURES $'+coin.ticker+' '+coin.hourChange.toFixed(2)+'% '+(r.url||'no URL'));
   console.log('TEXT: '+text);return true;
  }catch(e){last=String(e.message||e);console.log('Skipped Futures $'+coin.ticker+': '+last);}
 }
 throw Error('No eligible Futures token could be published. Last issue: '+last);
}
async function main(){
 let s=await load();const event=process.env.GITHUB_EVENT_NAME||'';
 if(event==='push'&&(s.published||0)>0){const lastPost=Date.parse((s.history||[]).at(-1)?.at||'');if(Number.isFinite(lastPost)&&now()-lastPost<minPostGapMs){console.log('Push-triggered check skipped: last published post is less than 55 minutes old.');return;}console.log('Push-triggered recovery: last post is at least 55 minutes old; attempting publication.');}
 if(event==='schedule'&&s.planVersion!==4){console.log('Scheduled run waiting for manual pilot start.');return;}
 if(event==='workflow_dispatch'&&s.planVersion!==4){s={active:true,startedAt:new Date().toISOString(),endsAt:new Date(now()+30*24*3600000).toISOString(),published:0,perDay:{},seen:[],history:[],lastError:null,planVersion:4};console.log('New 30-day Futures-only campaign starts '+s.startedAt+' ends '+s.endsAt+' target='+maxPosts);}
 if(!s.active||(s.published||0)>=maxPosts||now()>=Date.parse(s.endsAt)){s.active=false;s.lastError='Pilot complete or time expired';await save(s);console.log('Finished '+s.published+'/'+maxPosts);return;}
 try{const lastPost=Date.parse((s.history||[]).at(-1)?.at||'');if(event!=='push'&&Number.isFinite(lastPost)&&now()-lastPost<minPostGapMs){console.log('Throttle: last post is less than 55 minutes old; skipping publish.');return;}if(!process.env.BINANCE_SQUARE_OPENAPI_KEY)throw Error('Missing BINANCE_SQUARE_OPENAPI_KEY; no post sent.');await postOne(s);}catch(e){s.lastError=String(e.message||e).slice(0,500);console.error('POST FAILED: '+s.lastError);}
 if(s.published>=maxPosts||now()>=Date.parse(s.endsAt))s.active=false;await save(s);console.log('PILOT '+(s.active?'ACTIVE':'FINISHED')+' '+s.published+'/'+maxPosts+' perDay='+JSON.stringify(s.perDay)+' error='+(s.lastError||'none'));if(s.lastError)process.exitCode=1;
}
main().catch(e=>{console.error('FATAL: '+String(e.message||e));process.exitCode=1;});
