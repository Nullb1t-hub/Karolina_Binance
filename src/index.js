import 'dotenv/config';
import http from 'node:http';
import {loadState} from './store.js';
import {createBot} from './bot.js';
import {attachBot,runTick,sendDailyReport} from './scheduler.js';
const missing=['TELEGRAM_BOT_TOKEN','TELEGRAM_OWNER_ID'].filter(k=>!process.env[k]);
if(missing.length){console.error('Missing env vars:',missing.join(', '));process.exit(1);}
await loadState();
const bot=createBot();attachBot(bot);
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,time:new Date().toISOString()}));}res.writeHead(404);res.end('not found');});
server.listen(Number(process.env.PORT||3000),()=>console.log('Health endpoint ready.'));
let reportKey='';
setInterval(async()=>{try{
 await runTick();
 const now=new Date(),tz=process.env.TZ||'Europe/Prague';
 const hm=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(hm==='00:00'||hm==='12:00'){const k=date+' '+hm;if(k!==reportKey){reportKey=k;await sendDailyReport(hm==='00:00'?'00:00 daily':'12:00 midday');}}
}catch(e){console.error('Worker tick:',e.message);}},15000);
const shutdown=()=>{bot.stopPolling().finally(()=>server.close(()=>process.exit(0)));};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
console.log('Karolina Binance AI agent started. DRY_RUN='+(process.env.DRY_RUN||'true'));
