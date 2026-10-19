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
 return d.map(x=>({ticker:String(x.symbol||'').toUpperCase(),symbol:String(x.symbol||'').toUpperCase()+'USDT',price:Number(x.current_price),change:Number(x.price_change_percentage_24h),volume:Number(x.total_volume),marketCap:Number(x.market_cap||0),coinId:x.id,image:x.image,source:'CoinGecko'}))
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
 const up=coin.change>=0,accent=up?'#24DDA0':'#FF496C';
 const line=linePath(values),area=line+' L1112 510 L88 510 Z';
 const logoUrl=coin.image||'https://assets.coincap.io/assets/icons/'+encodeURIComponent(coin.ticker.toLowerCase())+'@2x.png';
 let logo=null;try{const r=await fetch(logoUrl,{signal:AbortSignal.timeout(4500)});if(r.ok)logo=await sharp(Buffer.from(await r.arrayBuffer())).resize(76,76,{fit:'contain'}).png().toBuffer();}catch{}
 const grid=Array.from({length:6},(_,i)=>'<line x1="72" y1="'+(170+i*67)+'" x2="1128" y2="'+(170+i*67)+'" stroke="#182132" stroke-width="1"/>').join('');
 const arrow=up
  ? '<path d="M1030 118 L1080 68 L1080 96 L1110 96 L1110 118 L1080 118 L1080 146 Z" fill="'+accent+'" opacity=".95"/>'
  : '<path d="M1030 105 L1080 155 L1080 127 L1110 127 L1110 105 L1080 105 L1080 77 Z" fill="'+accent+'" opacity=".95"/>';
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#03050A"/><stop offset=".55" stop-color="#080D17"/><stop offset="1" stop-color="#0B1220"/></linearGradient><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+accent+'" stop-opacity=".22"/><stop offset="1" stop-color="'+accent+'" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/><circle cx="1050" cy="90" r="210" fill="'+accent+'" opacity=".025"/>'+grid+'<path d="'+area+'" fill="url(#fill)"/><path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+(88+(values.length-1)*1024/(values.length-1)).toFixed(1)+'" cy="'+(490-(values[values.length-1]-Math.min(...values))/((Math.max(...values)-Math.min(...values))||1)*165).toFixed(1)+'" r="7" fill="'+accent+'"/>'+arrow+'<circle cx="120" cy="108" r="49" fill="#101827" stroke="#263248" stroke-width="2"/><path d="M88 108 L110 130 L151 84" fill="none" stroke="'+accent+'" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/><line x1="72" y1="540" x2="1128" y2="540" stroke="#1B2638" stroke-width="1"/><path d="M72 575 L1128 575" stroke="#111A29" stroke-width="1"/><path d="M72 605 L1128 605" stroke="#111A29" stroke-width="1"/></svg>';
 let b=await sharp(Buffer.from(svg)).png().toBuffer();
 if(logo){const badge=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><circle cx="120" cy="108" r="38" fill="#080D17"/></svg>');b=await sharp(b).composite([{input:badge},{input:logo,left:82,top:70}]).png().toBuffer();}
 return b;
}
async function stories(s){const all=[];for(const f of feeds){try{const r=await fetch(f.url,{signal:AbortSignal.timeout(10000),headers:{'user-agent':'KarolinaCryptoNews/1.0'}});if(r.ok)all.push(...parseFeed(await r.text(),f.name));}catch(e){console.log('Feed '+f.name+': '+e.message);}}const seen=new Set(s.seen||[]),cut=now()-72*3600000;return all.filter(x=>!seen.has(x.link)&&(!Date.parse(x.date)||Date.parse(x.date)>=cut)).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));}
function parseJson(raw){const t=String(raw||'').trim(),a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)throw Error('AI returned invalid JSON');return JSON.parse(t.slice(a,b+1));}
function fallbackDraft(coin,mode){
 const up=coin.change>=0,move=(up?'+':'')+coin.change.toFixed(2)+'%';
 if(mode==='futures')return '$'+coin.ticker+' '+(up?'🚀':'🔻')+' '+move+' in 24h. Check the Binance Futures market, manage your risk, and decide: long or short? '+coin.futuresUrl+' #'+coin.ticker+' #Futures';
 return '$'+coin.ticker+' '+(up?'🚀':'🔻')+' '+move+' in 24h. Check the Binance Spot market and make your own call—buying or waiting? '+coin.spotUrl+' #'+coin.ticker+' #Spot';
}
async function draft(coin,mode){
 const facts='$'+coin.ticker+' moved '+(coin.change>=0?'+':'')+coin.change.toFixed(2)+'% in 24h; volume $'+Math.round(coin.volume)+'.';
 try{
  if(!process.env.GEMINI_API_KEY)throw Error('No Gemini key');
  const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
  const res=await ai.models.generateContent({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',contents:'Write a punchy Binance Square post in English, maximum 2 short sentences plus hashtags, under 240 characters. Start with cashtag $'+coin.ticker+'. This post is for Binance '+(mode==='futures'?'Futures':'Spot')+'. Include a natural call to check this market and one engaging question. Keep playful and sharp, not a news article. Facts only: '+facts+' Never give a guaranteed outcome, price target, or direct buy/sell instruction. Include this market URL: '+(mode==='futures'?coin.futuresUrl:coin.spotUrl)+'. Finish with #'+coin.ticker+' #'+(mode==='futures'?'Futures':'Spot')+'. Output only the post.'});
  const t=String(res.text||'').trim();
  if(t.length>=20&&t.length<=280&&t.includes('$'+coin.ticker)&&!/(guaranteed|sure profit|100% profit)/i.test(t))return t;
 }catch(e){console.log('AI caption fallback: '+String(e.message||e).slice(0,120));}
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
  const data=await getJson('https://fapi.binance.com/fapi/v1/ticker/24hr',15000);
  marketSet=new Set(data.map(x=>x.symbol).filter(x=>String(x).endsWith('USDT')));
 }else{
  try{
   const data=await getJson('https://api.binance.com/api/v3/ticker/24hr',15000);
   marketSet=new Set(data.map(x=>x.symbol).filter(x=>String(x).endsWith('USDT')));
  }catch{
   const data=await getJson('https://api.binance.vision/api/v3/ticker/24hr',15000);
   marketSet=new Set(data.map(x=>x.symbol).filter(x=>String(x).endsWith('USDT')));
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
 const s=await load(),event=process.env.GITHUB_EVENT_NAME||'';
 if(event==='push'){console.log('Publishing paused: push runs only validate code.');return;}
 if(event==='schedule'&&s.planVersion!==2){console.log('Scheduled run waiting for manual pilot start.');return;}
 if(event==='workflow_dispatch'&&s.planVersion!==2){s={active:true,startedAt:new Date().toISOString(),endsAt:new Date(now()+72*3600000).toISOString(),published:0,perDay:{},seen:[],history:[],lastError:null,planVersion:2};console.log('New 3-day pilot starts '+s.startedAt+' ends '+s.endsAt+' target='+maxPosts+' mix spot='+spotTarget+' futures='+futuresTarget);}
 if(!s.active||(s.published||0)>=maxPosts||now()>=Date.parse(s.endsAt)){s.active=false;s.lastError='Pilot complete or time expired';await save(s);console.log('Finished '+s.published+'/'+maxPosts);return;}
 try{if(!process.env.BINANCE_SQUARE_OPENAPI_KEY)throw Error('Missing BINANCE_SQUARE_OPENAPI_KEY; no post sent.');await postOne(s);}catch(e){s.lastError=String(e.message||e).slice(0,500);console.error('POST FAILED: '+s.lastError);}
 if(s.published>=maxPosts||now()>=Date.parse(s.endsAt))s.active=false;await save(s);console.log('PILOT '+(s.active?'ACTIVE':'FINISHED')+' '+s.published+'/'+maxPosts+' perDay='+JSON.stringify(s.perDay)+' error='+(s.lastError||'none'));if(s.lastError)process.exitCode=1;
}
main().catch(e=>{console.error('FATAL: '+String(e.message||e));process.exitCode=1;});
