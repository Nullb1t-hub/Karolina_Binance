import fs from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import sharp from 'sharp';
import {publishImage} from './publisher.js';
const statePath='.karolina/campaign.json';
const feeds=[{name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},{name:'Cointelegraph',url:'https://cointelegraph.com/rss'},{name:'Decrypt',url:'https://decrypt.co/feed'}];
const maxPosts=30,maxDaily=10,now=()=>Date.now();
function decode(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();}
function tag(b,n){const r=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'\\s*>','i'),m=b.match(r);return m?decode(m[1]):'';}
function parseFeed(xml,source){return xml.split(/<item\b/i).slice(1).map(x=>x.split(/<\/item>/i)[0]).map(b=>({source,title:tag(b,'title'),link:tag(b,'link'),description:tag(b,'description'),date:tag(b,'pubDate')})).filter(x=>x.title&&/^https?:\/\//i.test(x.link));}
function dayKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function load(){try{return JSON.parse(await fs.readFile(statePath,'utf8'));}catch{return {active:false,startedAt:null,endsAt:null,published:0,perDay:{},seen:[],history:[],lastError:null};}}
async function save(s){await fs.mkdir('.karolina',{recursive:true});await fs.writeFile(statePath,JSON.stringify(s,null,2)+'\n');}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function wrap(s,max){const out=[];let line='';for(const w of String(s||'').split(/\s+/)){if((line+' '+w).trim().length>max&&line){out.push(line);line=w;}else line=(line+' '+w).trim();}if(line)out.push(line);return out.slice(0,3);}
async function symbols(){
 const r=await fetch('https://api.binance.vision/api/v3/ticker/24hr',{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Binance public market data HTTP '+r.status);
 const excluded=new Set(['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','TRX','TON','LINK','LTC','BCH','DOT','AVAX','SHIB','USDC','USDT','FDUSD','DAI']);
 const d=await r.json();
 return d.filter(x=>String(x.symbol).endsWith('USDT')&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
  .map(x=>({ticker:x.symbol.slice(0,-4),symbol:x.symbol,price:Number(x.lastPrice),change:Number(x.priceChangePercent),volume:Number(x.quoteVolume),trades:Number(x.count)}))
  .filter(x=>!excluded.has(x.ticker)&&x.price>0&&x.volume>=1500000&&Math.abs(x.change)>=4.5&&x.trades>=1000)
  .sort((a,b)=>Math.abs(b.change)*Math.log10(1+b.volume)-Math.abs(a.change)*Math.log10(1+a.volume)).slice(0,100);
}
async function chartPoints(coin){
 const r=await fetch('https://api.binance.vision/api/v3/klines?symbol='+encodeURIComponent(coin.symbol)+'&interval=1h&limit=24',{signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Chart data HTTP '+r.status);
 return (await r.json()).map(x=>Number(x[4])).filter(x=>Number.isFinite(x)&&x>0);
}
function linePath(values){
 const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 return values.map((v,i)=>((i?'L':'M')+(88+i*1024/(values.length-1)).toFixed(1)+' '+(490-(v-min)/span*165).toFixed(1))).join(' ');
}
async function card(coin,values){
 const up=coin.change>=0,accent=up?'#36E6A2':'#FF5577',p=(coin.change>=0?'+':'')+coin.change.toFixed(2)+'%';
 const line=linePath(values),area=line+' L1112 510 L88 510 Z';
 const logoUrl='https://assets.coincap.io/assets/icons/'+encodeURIComponent(coin.ticker.toLowerCase())+'@2x.png';
 let logo=null;try{const r=await fetch(logoUrl,{signal:AbortSignal.timeout(4500)});if(r.ok)logo=await sharp(Buffer.from(await r.arrayBuffer())).resize(82,82,{fit:'contain'}).png().toBuffer();}catch{}
 const grid=Array.from({length:5},(_,i)=>'<line x1="88" y1="'+(335+i*42)+'" x2="1112" y2="'+(335+i*42)+'" stroke="#263146"/>').join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#070A11"/><stop offset="1" stop-color="#141E30"/></linearGradient><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+accent+'" stop-opacity=".3"/><stop offset="1" stop-color="'+accent+'" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/><circle cx="1100" cy="70" r="240" fill="'+accent+'" opacity=".045"/><text x="88" y="74" fill="#8190AA" font-size="20" letter-spacing="4" font-family="Arial">MARKET WATCH • 24H</text><text x="88" y="174" fill="#F6F8FC" font-size="70" font-weight="700" font-family="Arial">$'+coin.ticker+'</text><text x="88" y="220" fill="#95A3BC" font-size="23" font-family="Arial">PRICE CHANGE</text><text x="1112" y="174" text-anchor="end" fill="'+accent+'" font-size="64" font-weight="700" font-family="Arial">'+p+'</text><text x="1112" y="220" text-anchor="end" fill="#95A3BC" font-size="21" font-family="Arial">24H VOLUME $'+(coin.volume/1e6).toFixed(1)+'M</text>'+grid+'<path d="'+area+'" fill="url(#fill)"/><path d="'+line+'" fill="none" stroke="'+accent+'" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="88" y1="540" x2="1112" y2="540" stroke="#263146"/><text x="88" y="592" fill="#DCE3EF" font-size="22" font-family="Arial">REAL 1H CANDLES • 24H VIEW</text><text x="88" y="625" fill="#71809B" font-size="17" font-family="Arial">Data: Binance Spot market feed</text><text x="1112" y="600" text-anchor="end" fill="#7F8CA8" font-size="19" font-family="Arial">KAROLINA</text></svg>';
 let b=await sharp(Buffer.from(svg)).png().toBuffer();
 if(logo){const badge=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><circle cx="1020" cy="105" r="52" fill="#FFFFFF"/></svg>');b=await sharp(b).composite([{input:badge},{input:logo,left:979,top:64}]).png().toBuffer();}
 return b;
}
async function stories(s){const all=[];for(const f of feeds){try{const r=await fetch(f.url,{signal:AbortSignal.timeout(10000),headers:{'user-agent':'KarolinaCryptoNews/1.0'}});if(r.ok)all.push(...parseFeed(await r.text(),f.name));}catch(e){console.log('Feed '+f.name+': '+e.message);}}const seen=new Set(s.seen||[]),cut=now()-72*3600000;return all.filter(x=>!seen.has(x.link)&&(!Date.parse(x.date)||Date.parse(x.date)>=cut)).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));}
function parseJson(raw){const t=String(raw||'').trim(),a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)throw Error('AI returned invalid JSON');return JSON.parse(t.slice(a,b+1));}
function fallbackDraft(coin){
 const move=coin.change>=0?'is ripping higher':'is getting hit';
 const emoji=coin.change>=0?'🚀':'🔴';
 return '$'+coin.ticker+' '+emoji+' '+(coin.change>=0?'+':'')+coin.change.toFixed(2)+'% in 24h. '+move+' on $'+(coin.volume/1e6).toFixed(1)+'M volume. Is this move just starting or running out of steam? #'+coin.ticker+' #Crypto';
}
async function draft(coin){
 const facts='$'+coin.ticker+' moved '+(coin.change>=0?'+':'')+coin.change.toFixed(2)+'% in 24h; volume $'+Math.round(coin.volume)+'.';
 try{
  if(!process.env.GEMINI_API_KEY)throw Error('No Gemini key');
  const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
  const res=await ai.models.generateContent({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',contents:'Write a punchy Binance Square post in English, maximum 2 short sentences plus hashtags, under 240 characters. Start with literal '+coin.ticker+' cashtag $'+coin.ticker+'. Use a playful sharp trader tone like a viral one-liner, not news article. Facts only: '+facts+' Add one question, no price target, no fabricated cause, no promise, no generic filler. Finish with #'+coin.ticker+' #Crypto. Output only the post.'});
  const t=String(res.text||'').trim();
  if(t.length>=20&&t.length<=280&&t.includes('$'+coin.ticker)&&!/(guaranteed|sure profit|100% profit)/i.test(t))return t;
 }catch(e){console.log('AI caption fallback: '+String(e.message||e).slice(0,120));}
 return fallbackDraft(coin);
}
async function postOne(s){
 const today=dayKey();s.perDay=s.perDay||{};
 if((s.perDay[today]||0)>=maxDaily)throw Error('Daily cap reached');
 const list=await symbols();if(!list.length)throw Error('No high-volume 24h breakout tokens found; nothing posted.');
 const seen=new Set(s.seen||[]),candidates=list.filter(x=>!seen.has(x.ticker)).slice(0,10);
 let last='No unused breakout candidate';
 for(const coin of candidates){
  try{
   const values=await chartPoints(coin);if(values.length<8)throw Error('Not enough real chart points');
   const text=await draft(coin),img=await card(coin,values);
   const r=await publishImage(text,img,'karolina-'+coin.ticker.toLowerCase()+'-'+Date.now()+'.png');
   const entry={at:new Date().toISOString(),ticker:coin.ticker,change:coin.change,volume:coin.volume,text,url:r.url||null,postId:r.id||null};
   s.published=(s.published||0)+1;s.perDay[today]=(s.perDay[today]||0)+1;s.seen=(s.seen||[]).concat(coin.ticker).slice(-300);s.history=(s.history||[]).concat(entry).slice(-60);s.lastError=null;
   console.log('PUBLISHED '+s.published+'/'+maxPosts+' $'+coin.ticker+' '+coin.change.toFixed(2)+'% '+(r.url||'no URL'));console.log('TEXT: '+text);return true;
  }catch(e){last=String(e.message||e);console.log('Skipped $'+coin.ticker+': '+last);}
 }
 throw Error('No breakout candidate could be published. Last issue: '+last);
}
async function main(){
 const s=await load(),event=process.env.GITHUB_EVENT_NAME||'';
 if(event!=='workflow_dispatch'){console.log('Publishing paused: only manual workflow runs can publish.');return;}
 if(!s.startedAt){s.active=true;s.startedAt=new Date().toISOString();s.endsAt=new Date(now()+72*3600000).toISOString();s.published=0;s.perDay={};s.seen=[];s.history=[];console.log('Pilot starts '+s.startedAt+' ends '+s.endsAt);}
 if(!s.active||(s.published||0)>=maxPosts||now()>=Date.parse(s.endsAt)){s.active=false;s.lastError='Pilot complete or time expired';await save(s);console.log('Finished '+s.published+'/'+maxPosts);return;}
 try{if(!process.env.BINANCE_SQUARE_OPENAPI_KEY)throw Error('Missing BINANCE_SQUARE_OPENAPI_KEY; no post sent.');await postOne(s);}catch(e){s.lastError=String(e.message||e).slice(0,500);console.error('POST FAILED: '+s.lastError);}
 if(s.published>=maxPosts||now()>=Date.parse(s.endsAt))s.active=false;await save(s);console.log('PILOT '+(s.active?'ACTIVE':'FINISHED')+' '+s.published+'/'+maxPosts+' perDay='+JSON.stringify(s.perDay)+' error='+(s.lastError||'none'));
}
main().catch(e=>{console.error('FATAL: '+String(e.message||e));process.exitCode=1;});
