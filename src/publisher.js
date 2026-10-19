const endpoint='https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add';
export async function publishText(text){
 const key=process.env.BINANCE_SQUARE_OPENAPI_KEY;
 if(!key)throw new Error('BINANCE_SQUARE_OPENAPI_KEY is missing');
 const r=await fetch(endpoint,{method:'POST',headers:{'X-Square-OpenAPI-Key':key,'Content-Type':'application/json','clienttype':'binanceSkill'},body:JSON.stringify({bodyTextOnly:text}),signal:AbortSignal.timeout(20000)});
 const body=await r.json().catch(()=>({}));
 if(!r.ok||body.code!=='000000')throw new Error('Binance Square publish failed: HTTP '+r.status+', code '+(body.code||'unknown')+', '+String(body.message||'').slice(0,200));
 const id=body.data&&body.data.id;
 return {id:id||null,url:id?'https://www.binance.com/square/post/'+id:null,publishedAt:new Date().toISOString()};
}
