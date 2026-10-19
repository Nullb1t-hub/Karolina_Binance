import fs from 'node:fs/promises';
import path from 'node:path';
const dir = process.env.DATA_DIR || './data';
const file = path.join(dir, 'state.json');
const defaults = {
 running:false, startedAt:null, nextPostAt:null, lastPostAt:null, lastError:null,
 settings:{periodHours:Number(process.env.DEFAULT_PERIOD_HOURS||12),postsPerPeriod:Number(process.env.DEFAULT_POSTS_PER_PERIOD||3),scheduleMode:'uniform',marketMode:'adaptive',spotPercent:50,futuresPercent:50,language:process.env.DEFAULT_LANGUAGE||'ru',imagesEnabled:true,maxPostsPerDay:Number(process.env.MAX_POSTS_PER_DAY||12),minGapMinutes:Number(process.env.MIN_POST_GAP_MINUTES||45)},
 posts:[],publishedToday:[],seenTopics:[],dailyReportSent:{}
};
let state = structuredClone(defaults);
let chain = Promise.resolve();
export async function loadState(){
 try { await fs.mkdir(dir,{recursive:true}); state={...structuredClone(defaults),...JSON.parse(await fs.readFile(file,'utf8'))}; state.settings={...defaults.settings,...(state.settings||{})}; }
 catch(e){if(e.code!=='ENOENT') console.error('State load:',e.message); await saveState();}
 return getState();
}
export function getState(){return structuredClone(state);}
export async function updateState(fn){const d=structuredClone(state);const r=await fn(d);state=d;await saveState();return r??getState();}
export async function saveState(){chain=chain.then(async()=>{await fs.mkdir(dir,{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(state,null,2));await fs.rename(tmp,file);});return chain;}
