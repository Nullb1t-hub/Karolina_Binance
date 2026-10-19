import {GoogleGenAI} from '@google/genai';
let client;
const langs={ru:'Russian',en:'English',uk:'Ukrainian',cs:'Czech',es:'Spanish',pt:'Portuguese'};
export async function createPost(c,settings){
 if(!process.env.GEMINI_API_KEY)throw new Error('GEMINI_API_KEY is missing');
 if(!client)client=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
 const x=c.coin,lang=langs[settings.language]||settings.language;
 const prompt='Write one original, lively but credible Binance Square crypto analysis post in '+lang+'. Market type: '+c.market+'. Verified 24h snapshot at '+c.snapshot.fetchedAt+'. Symbol '+x.symbol+', last reported price '+x.price+', 24h change '+x.change24h+'%, 24h quote volume '+x.quoteVolume+', 24h high/low '+x.high+'/'+x.low+', funding rate '+(x.fundingRate??'unavailable')+'. Coverage '+JSON.stringify(c.snapshot.coverage)+'. Explain what the snapshot supports and what it does not. Include conditional bullish and bearish scenarios, invalidate conditions and risk. For futures mention leverage and liquidation risk; do not suggest a leverage multiplier. Do not invent news, indicators, support/resistance, open interest, liquidation data or guaranteed returns. Use cashtag $'+x.symbol.replace(/USDT$/,'')+'. Around 100-180 words, maximum 3 relevant hashtags, end with a brief not-financial-advice disclaimer. Return only post text.';
 const r=await client.models.generateContent({model:process.env.GEMINI_MODEL||'gemini-2.5-flash',contents:prompt});
 const text=(r.text||'').trim();
 if(text.length<80)throw new Error('AI draft too short; not publishing');
 if(/guaranteed profit|guaranteed returns|100% sure|sure win/i.test(text))throw new Error('Quality guard rejected unrealistic profit claim');
 return text;
}
