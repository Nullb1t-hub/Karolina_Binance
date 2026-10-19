import fs from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import sharp from 'sharp';
import {publishImage} from './publisher.js';
const statePath='.karolina/campaign.json';
const feeds=[{name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},{name:'Cointelegraph',url:'https://cointelegraph.com/rss'},{name:'Decrypt',url:'https://decrypt.co/feed'}];
const maxPosts=60,maxDaily=24,spotTarget=23,futuresTarget=37,now=()=>Date.now();
function decode(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();}
function tag(b,n){const r=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'\\s*>','i'),m=b.match(r);return m?decode(m[1]):'';}
function parseFeed(xml,source){return xml.split(/<item\b/i).slice(1).map(x=>x.split(/<\/item>/i)[0]).map(b=>({source,title:tag(b,'title'),link:tag(b,'link'),description:tag(b,'description'),date:tag(b,'pubDate')})).filter(x=>x.title&&/^https?:\/\//i.test(x.link));}
function dayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function load(){try{return JSON.parse(await fs.readFile(statePath,'utf8'));}catch{return {active:false,startedAt:null,endsAt:null,published:0,perDay:{},seen:[],history:[],lastError:null};}}
async function save(s){await fs.mkdir('.karolina',{recursive:true});await fs.writeFile(statePath,JSON.stringify(s,null,2)+'\n');}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function wrap(s,max){const out=[];let line='';for(const w of String(s||'').split(/\s+/)){if((line+' '+w).trim().length>max&&line){out.push(line);line=w;}else line=(line+' '+w).trim();}if(line)out.push(line);return out.slice(0,3);}
async function getJson(url,timeout=12000){
 let r;
 try{r=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Karolina-MarketScout/2.1'}});}
 catch(e){throw Error('Network request failed for '+new URL(url).host+': '+String(e.cause?.code||e.message||e));}
 if(!r.ok)throw Error(new URL(url).host+' HTTP '+r.status);
 return r.json();
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
 const d=await getJson('https://api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(coin.symbol)+'&interval=1h&limit=24',12000);
 return d.map(x=>Number(x[4])).filter(x=>Number.isFinite(x)&&x>0);
}
function linePath(values){
 const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 return values.map((v,i)=>((i?'L':'M')+(88+i*1024/(values.length-1)).toFixed(1)+' '+(490-(v-min)/span*165).toFixed(1))).join(' ');
}
async function card(coin,values){
 const up=coin.change>=0,accent=up?'#35E6A1':'#FF5576';
 const line=linePath(values),area=line+' L1112 510 L88 510 Z';
 const logoUrl=coin.image||'https://assets.coincap.io/assets/icons/'+encodeURIComponent(coin.ticker.toLowerCase())+'@2x.png';
 let logo=null;try{const r=await fetch(logoUrl,{signal:AbortSignal.timeout(4500)});if(r.ok)logo=await sharp(Buffer.from(await r.arrayBuffer())).resize(84,84,{fit:'contain'}).png().toBuffer();}catch{}
 const ticker=esc(coin.ticker),fullName=esc(coin.name||coin.fullName||coin.ticker);
 const move=(up?'+':'')+Number(coin.change).toFixed(2)+'%';
 const grid=Array.from({length:6},(_,i)=>'<line x1="72" y1="'+(190+i*62)+'" x2="1128" y2="'+(190+i*62)+'" stroke="#1A2536" stroke-width="1"/>').join('');
 const arrow=up
  ? '<path d="M1014 124 L1060 78 L1060 101 L1090 101 L1090 124 L1060 124 L1060 147 Z" fill="'+accent+'"/>'
  : '<path d="M1014 104 L1060 150 L1060 127 L1090 127 L1090 104 L1060 104 L1060 81 Z" fill="'+accent+'"/>';
 const endX=1112,endY=(490-(values[values.length-1]-Math.min(...values))/((Math.max(...values)-Math.min(...values))||1)*165).toFixed(1);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#04060B"/><stop offset=".48" stop-color="#080E19"/><stop offset="1" stop-color="#111827"/></linearGradient><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+accent+'" stop-opacity=".28"/><stop offset="1" stop-color="'+accent+'" stop-opacity=".015"/></linearGradient><linearGradient id="panel" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#111A29" stop-opacity=".96"/><stop offset="1" stop-color="#0A101B" stop-opacity=".72"/></linearGradient><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter></defs><rect width="1200" height="675" fill="url(#bg)"/><circle cx="1030" cy="150" r="245" fill="'+accent+'" opacity=".055"/><circle cx="1030" cy="150" r="180" fill="'+accent+'" opacity=".025"/>'+grid+'<path d="'+area+'" fill="url(#fill)"/><path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="14" opacity=".13" filter="url(#glow)" stroke-linecap="round" stroke-linejoin="round"/><path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+endX+'" cy="'+endY+'" r="12" fill="'+accent+'" opacity=".15"/><circle cx="'+endX+'" cy="'+endY+'" r="5.5" fill="'+accent+'"/><rect x="56" y="48" width="1088" height="126" rx="28" fill="url(#panel)" stroke="#263247" stroke-opacity=".72"/><circle cx="121" cy="111" r="43" fill="#080D16" stroke="#354157" stroke-width="2"/>'+arrow+'<text x="190" y="105" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" letter-spacing="1.5" fill="#F4F7FB">'+ticker+'</text><text x="192" y="140" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#9BA9BC">'+fullName+'</text><rect x="72" y="548" width="1056" height="82" rx="22" fill="#0A101A" fill-opacity=".94" stroke="#273449" stroke-opacity=".8"/><rect x="92" y="570" width="5" height="38" rx="2.5" fill="'+accent+'"/><text x="120" y="583" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="600" letter-spacing="3" fill="#91A0B4">24H CHANGE</text><text x="120" y="612" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="'+accent+'">'+esc(move)+'</text><text x="1100" y="600" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="16" letter-spacing="2" fill="#65748A">MARKET SNAPSHOT</text></svg>';
 let b=await sharp(Buffer.from(svg)).png().toBuffer();
 if(logo){const badge=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><circle cx="121" cy="111" r="34" fill="#080D16"/></svg>');b=await sharp(b).composite([{input:badge},{input:logo,left:79,top:69}]).png().toBuffer();}
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
function fallbackDraft(coin,mode){
 const up=coin.change>=0,move=(up?'+':'')+Number(coin.change).toFixed(2)+'%',volume=compactMoney(coin.volume);
 if(mode==='futures'){
  const hook=up?'🚀 Momentum is heating up':'⚠️ Sellers are in control';
  const question=up?'continuation or a sharp reversal?':'more downside or a bounce from here?';
  return hook+' $'+coin.ticker+' '+move+' in 24h • '+volume+' volume. 👀 Futures traders: '+question+' Check $'+coin.ticker+' on Binance Futures and manage risk. #'+coin.ticker+' #Futures';
 }
 const hook=up?'🚀 Big move alert':'🔻 Downward move alert';
 const question=up?'momentum or a fakeout?':'dip opportunity or more downside?';
 return hook+' $'+coin.ticker+' '+move+' in 24h • '+volume+' volume. 👀 What comes next: '+question+' Find $'+coin.ticker+' on Binance Spot and check the chart. #'+coin.ticker+' #BinanceSpot';
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
 let last='No unused token is listed on the required Binance market';
 for(const original of candidates){
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
 try{if(!process.env.BINANCE_SQUARE_OPENAPI_KEY)throw Error('Missing BINANCE_SQUARE_OPENAPI_KEY; no post sent.');await postOne(s);}catch(e){s.lastError=String(e.message||e).slice(0,500);console.error('POST FAILED: '+s.lastError);}
 if(s.published>=maxPosts||now()>=Date.parse(s.endsAt))s.active=false;await save(s);console.log('PILOT '+(s.active?'ACTIVE':'FINISHED')+' '+s.published+'/'+maxPosts+' perDay='+JSON.stringify(s.perDay)+' error='+(s.lastError||'none'));if(s.lastError)process.exitCode=1;
}
main().catch(e=>{console.error('FATAL: '+String(e.message||e));process.exitCode=1;});
