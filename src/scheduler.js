import {getMarketSnapshot,chooseCandidate} from './market.js';
import {createPost} from './writer.js';
import {publishImage} from './publisher.js';
import {makeMarketCardSvg} from './chart.js';
import sharp from 'sharp';
import {getState,updateState} from './store.js';
let busy=false,bot;
export function attachBot(b){bot=b;}
const now=()=>Date.now();
const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:process.env.TZ||'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function interval(s,snapshot){const base=s.settings.periodHours*3600000/Math.max(1,s.settings.postsPerPeriod);const vol=Math.max(snapshot?.summary?.avgAbsSpot24hPct||0,snapshot?.summary?.avgAbsFutures24hPct||0);const multiplier=s.settings.scheduleMode==='active'?(vol>=3?0.75:1.25):1;return Math.max(s.settings.minGapMinutes*60000,base*multiplier);}
async function notify(text){if(bot&&process.env.TELEGRAM_OWNER_ID)try{await bot.sendMessage(process.env.TELEGRAM_OWNER_ID,text,{disable_web_page_preview:true});}catch(e){console.error('Telegram notify:',e.message);}}
export async function startSchedule(){
 const s=getState();
 if(s.running)return {ok:false,message:'Агент уже запущен.'};
 if(!process.env.GEMINI_API_KEY)return {ok:false,message:'Добавь GEMINI_API_KEY.'};
 if(process.env.DRY_RUN!=='true'&&!process.env.BINANCE_SQUARE_OPENAPI_KEY)return {ok:false,message:'Добавь Binance Square OpenAPI key.'};
 await updateState(d=>{d.running=true;d.startedAt=new Date().toISOString();d.nextPostAt=new Date(now()+15000).toISOString();d.lastError=null;});
 return {ok:true,message:'Запуск принят. Первая проверка примерно через 15 секунд.'};
}
export async function stopSchedule(){await updateState(d=>{d.running=false;d.nextPostAt=null;});return 'Агент остановлен.';}
export async function runTick(){
 if(busy)return;busy=true;
 try{
  let s=getState();if(!s.running||!s.nextPostAt||now()<Date.parse(s.nextPostAt))return;
  const today=dayKey();await updateState(d=>{d.publishedToday=(d.publishedToday||[]).filter(x=>x.day===today);});s=getState();
  if(s.publishedToday.length>=s.settings.maxPostsPerDay){await updateState(d=>{d.running=false;d.lastError='Достигнут дневной лимит.';});await notify('⏸ Агент остановлен: достигнут дневной лимит.');return;}
  if(s.lastPostAt&&now()-Date.parse(s.lastPostAt)<s.settings.minGapMinutes*60000){await updateState(d=>{d.nextPostAt=new Date(Date.parse(d.lastPostAt)+d.settings.minGapMinutes*60000).toISOString();});return;}
  const snapshot=await getMarketSnapshot(),candidate=chooseCandidate(snapshot,s),text=await createPost(candidate,s.settings);
  const dry=process.env.DRY_RUN==='true';
  let result;
  if(dry)result={id:null,url:null,publishedAt:new Date().toISOString(),dryRun:true};
  else{
   const svg=makeMarketCardSvg(candidate.coin,candidate.market);
   const png=await sharp(Buffer.from(svg)).png().toBuffer();
   result=await publishImage(text,png,'market-'+candidate.coin.symbol.toLowerCase()+'.png');
  }
  await updateState(d=>{
   const p={...result,text,market:candidate.market,symbol:candidate.coin.symbol,price:candidate.coin.price,change24h:candidate.coin.change24h,day:today,snapshotAt:snapshot.fetchedAt};
   d.posts.unshift(p);d.posts=d.posts.slice(0,300);d.publishedToday.push({day:today,at:p.publishedAt});d.lastPostAt=p.publishedAt;d.seenTopics.push(candidate.coin.symbol);d.seenTopics=d.seenTopics.slice(-100);d.nextPostAt=new Date(Date.parse(p.publishedAt)+interval(d,snapshot)).toISOString();d.lastError=null;
  });
  await notify((dry?'🧪 ЧЕРНОВИК — НЕ ОПУБЛИКОВАН':'✅ ПОСТ ОПУБЛИКОВАН')+'\n\nРынок: '+candidate.market.toUpperCase()+'\nМонета: '+candidate.coin.symbol+'\nИзменение 24ч: '+candidate.coin.change24h+'%\n\n'+text+(result.url?'\n\n'+result.url:'')+(result.successWithoutId?'\nBinance подтвердил отправку, но не вернул ID. Не повторяй вручную сразу.':''));
 }catch(e){const m=String(e.message||e).slice(0,400);await updateState(d=>{d.lastError=m;d.nextPostAt=new Date(now()+600000).toISOString();});await notify('⚠️ Пост не опубликован. Повторная попытка не раньше чем через 10 минут. Ошибка: '+m);}
 finally{busy=false;}
}
export async function sendDailyReport(kind='manual'){
 const s=getState(),today=dayKey(),ps=(s.posts||[]).filter(p=>p.day===today);
 const list=ps.slice(0,8).map(p=>'• '+p.symbol+' ('+p.market+') '+p.change24h+'% '+(p.url||'(dry-run)')).join('\n')||'Публикаций пока нет.';
 const report='📊 BINANCE SQUARE — '+kind+'\n\nПостов сегодня: '+ps.length+'\nВсего записей: '+s.posts.length+'\nСтатус: '+(s.running?'работает':'остановлен')+'\nСледующий пост: '+(s.nextPostAt||'не запланирован')+'\n\n'+list+'\n\nПросмотры и переходы пока не подключены к подтверждённому источнику. Доход не измеряется этим модулем.';
 await notify(report);return report;
}
export function schedulerStatus(){const s=getState();return {running:s.running,nextPostAt:s.nextPostAt,lastPostAt:s.lastPostAt,lastError:s.lastError,settings:s.settings,postsToday:(s.publishedToday||[]).length};}
