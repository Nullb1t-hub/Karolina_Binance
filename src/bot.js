import TelegramBot from 'node-telegram-bot-api';
import {getState,updateState} from './store.js';
import {startSchedule,stopSchedule,sendDailyReport} from './scheduler.js';
const help='Karolina Binance AI Agent\n\n/myid — узнать свой Telegram ID\n/settings — панель\n/period 12 — период в часах\n/posts 3 — постов за период\n/language ru — ru, en, uk, cs, es, pt\n/mode adaptive — adaptive или manual\n/schedule uniform — uniform или active\n/ratio 70/30 — доли Spot/Futures для manual\n/status — состояние\n/recent — последние посты\n/report — отчёт\n/startagent — старт\n/pause — пауза\n\nПо умолчанию DRY_RUN=true: агент присылает черновики, но не публикует.';
const isOwner=m=>String(m.from&&m.from.id)===String(process.env.TELEGRAM_OWNER_ID||'');
export function createBot(){
 const bot=new TelegramBot(process.env.TELEGRAM_BOT_TOKEN,{polling:true});
 bot.on('polling_error',e=>console.error('Telegram polling:',e.message));
 bot.on('message',async m=>{
  if((m.text||'').trim()==='/myid'&&!process.env.TELEGRAM_OWNER_ID){return bot.sendMessage(m.chat.id,'Твой Telegram ID: '+m.from.id+'\nДобавь это число в секрет TELEGRAM_OWNER_ID, затем перезапусти агента.');}
  if(!isOwner(m))return;
  const text=(m.text||'').trim(),parts=text.split(/\s+/),cmd=parts[0],arg=parts.slice(1).join(' ');
  try{
   if(cmd==='/start'||cmd==='/help')return bot.sendMessage(m.chat.id,help);
   if(cmd==='/settings')return bot.sendMessage(m.chat.id,settingsText(getState()),{reply_markup:{inline_keyboard:[
    [{text:'▶️ Старт',callback_data:'start'},{text:'⏸ Пауза',callback_data:'pause'}],
    [{text:'📊 Статус',callback_data:'status'},{text:'📈 Отчёт',callback_data:'report'}],
    [{text:'6 часов',callback_data:'period:6'},{text:'12 часов',callback_data:'period:12'},{text:'24 часа',callback_data:'period:24'}],
    [{text:'2 поста',callback_data:'posts:2'},{text:'3 поста',callback_data:'posts:3'},{text:'6 постов',callback_data:'posts:6'}],
    [{text:'Русский',callback_data:'lang:ru'},{text:'English',callback_data:'lang:en'}],
    [{text:'Spot/Futures 70/30',callback_data:'ratio:70/30'},{text:'50/50',callback_data:'ratio:50/50'}]
   ]}});
   if(cmd==='/period'){const n=Number(arg);if(!Number.isFinite(n)||n<1||n>168)return bot.sendMessage(m.chat.id,'Период должен быть от 1 до 168 часов.');await updateState(d=>{d.settings.periodHours=n;});return bot.sendMessage(m.chat.id,'Период: '+n+' ч.');}
   if(cmd==='/posts'){const n=Number(arg);if(!Number.isInteger(n)||n<1||n>48)return bot.sendMessage(m.chat.id,'Количество постов: от 1 до 48.');await updateState(d=>{d.settings.postsPerPeriod=n;});return bot.sendMessage(m.chat.id,'Постов за период: '+n);}
   if(cmd==='/language'){if(!['ru','en','uk','cs','es','pt'].includes(arg))return bot.sendMessage(m.chat.id,'Поддерживаются ru, en, uk, cs, es, pt.');await updateState(d=>{d.settings.language=arg;});return bot.sendMessage(m.chat.id,'Язык: '+arg);}
   if(cmd==='/mode'){if(!['adaptive','manual'].includes(arg))return bot.sendMessage(m.chat.id,'Используй adaptive или manual.');await updateState(d=>{d.settings.marketMode=arg;});return bot.sendMessage(m.chat.id,'Режим рынка: '+arg);}
   if(cmd==='/schedule'){if(!['uniform','active'].includes(arg))return bot.sendMessage(m.chat.id,'Используй uniform или active.');await updateState(d=>{d.settings.scheduleMode=arg;});return bot.sendMessage(m.chat.id,'Режим сохранён: '+arg+'. Адаптация к часам активности пока базовая.');}
   if(cmd==='/ratio'){const a=arg.match(/^(\d{1,3})\s*[/,:-]\s*(\d{1,3})$/);if(!a||Number(a[1])+Number(a[2])!==100)return bot.sendMessage(m.chat.id,'Пример /ratio 70/30; сумма должна быть 100.');await updateState(d=>{d.settings.spotPercent=Number(a[1]);d.settings.futuresPercent=Number(a[2]);});return bot.sendMessage(m.chat.id,'Доли сохранены.')}
   if(cmd==='/status')return bot.sendMessage(m.chat.id,settingsText(getState()));
   if(cmd==='/recent'){const p=getState().posts.slice(0,5);return bot.sendMessage(m.chat.id,p.length?p.map((x,i)=>(i+1)+'. '+x.symbol+' / '+x.market+' / '+x.publishedAt+(x.url?'\n'+x.url:'')+'\n'+x.text.slice(0,300)).join('\n\n'):'Постов пока нет.');}
   if(cmd==='/report')return sendDailyReport('manual');
   if(cmd==='/startagent'){const r=await startSchedule();return bot.sendMessage(m.chat.id,r.message);}
   if(cmd==='/pause'||cmd==='/stopagent'){await stopSchedule();return bot.sendMessage(m.chat.id,'Агент остановлен.');}
   if(text)return bot.sendMessage(m.chat.id,'Неизвестная команда. Напиши /help.');
  }catch(e){console.error(e);bot.sendMessage(m.chat.id,'Ошибка: '+String(e.message||e).slice(0,250)).catch(()=>{});}
 });
 bot.on('callback_query',async q=>{
  if(String(q.from.id)!==String(process.env.TELEGRAM_OWNER_ID||''))return bot.answerCallbackQuery(q.id,{text:'Нет доступа'});
  try{
   const d=q.data||'';
   if(d==='start'){const r=await startSchedule();await bot.answerCallbackQuery(q.id,{text:r.message});}
   else if(d==='pause'){await stopSchedule();await bot.answerCallbackQuery(q.id,{text:'Остановлено'});}
   else if(d==='status'){await bot.answerCallbackQuery(q.id);await bot.sendMessage(q.message.chat.id,settingsText(getState()));}
   else if(d==='report'){await bot.answerCallbackQuery(q.id);await sendDailyReport('manual');}
   else if(d.startsWith('period:')){const n=Number(d.split(':')[1]);await updateState(s=>{s.settings.periodHours=n;});await bot.answerCallbackQuery(q.id,{text:'Период '+n+' ч'});}
   else if(d.startsWith('posts:')){const n=Number(d.split(':')[1]);await updateState(s=>{s.settings.postsPerPeriod=n;});await bot.answerCallbackQuery(q.id,{text:'Постов: '+n});}
   else if(d.startsWith('lang:')){const v=d.split(':')[1];await updateState(s=>{s.settings.language=v;});await bot.answerCallbackQuery(q.id,{text:'Язык: '+v});}
   else if(d.startsWith('ratio:')){const v=d.split(':')[1].split('/').map(Number);await updateState(s=>{s.settings.spotPercent=v[0];s.settings.futuresPercent=v[1];});await bot.answerCallbackQuery(q.id,{text:'Доли сохранены'});}
   await bot.editMessageText(settingsText(getState()),{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:q.message.reply_markup}).catch(()=>{});
  }catch(e){await bot.answerCallbackQuery(q.id,{text:'Ошибка: '+String(e.message||e).slice(0,100)}).catch(()=>{});}
 });
 return bot;
}
function settingsText(s){const x=s.settings;return '⚙️ KAROLINA BINANCE\n\nСтатус: '+(s.running?'🟢 работает':'⚪ остановлен')+'\nПериод: '+x.periodHours+' ч\nПостов за период: '+x.postsPerPeriod+'\nИнтервал: '+Math.max(x.minGapMinutes,Math.round(x.periodHours*60/x.postsPerPeriod))+' мин\nВыбор рынка: '+x.marketMode+'\nSpot/Futures manual: '+x.spotPercent+'/'+x.futuresPercent+'\nРасписание: '+x.scheduleMode+'\nЯзык: '+x.language+'\nПостов сегодня: '+s.publishedToday.length+'\nСледующий: '+(s.nextPostAt||'не запланирован')+'\nРежим: '+(process.env.DRY_RUN==='true'?'DRY RUN — не публикует':'РЕАЛЬНАЯ ПУБЛИКАЦИЯ')+'\nПоследняя ошибка: '+(s.lastError||'нет');}
