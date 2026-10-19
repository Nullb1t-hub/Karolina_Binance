const V1='https://www.binance.com/bapi/composite/v1/public/pgc/openApi';
const V2='https://www.binance.com/bapi/composite/v2/public/pgc/openApi';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function key(){const k=process.env.BINANCE_SQUARE_OPENAPI_KEY;if(!k)throw new Error('BINANCE_SQUARE_OPENAPI_KEY is missing');return k;}
async function api(base,endpoint,apiKey,body){
 const r=await fetch(base+endpoint,{method:'POST',headers:{'X-Square-OpenAPI-Key':apiKey,'Content-Type':'application/json','clienttype':'binanceSkill'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 const raw=await r.text();
 if(endpoint==='/content/add'&&r.status===504)return {id:null,shareLink:null,successWithoutId:true};
 let data;try{data=JSON.parse(raw);}catch{throw new Error('Binance API returned non-JSON response: HTTP '+r.status);}
 if(!r.ok||data.code!=='000000')throw new Error('Binance API error HTTP '+r.status+' code '+(data.code||'unknown')+': '+String(data.message||'').slice(0,180));
 return data.data||{};
}
export async function publishText(text){
 const apiKey=key(),data=await api(V1,'/content/add',apiKey,{contentType:1,bodyTextOnly:text});
 const id=data.id||null;return {id,url:data.shareLink||(id?'https://www.binance.com/square/post/'+id:null),publishedAt:new Date().toISOString(),successWithoutId:!!data.successWithoutId};
}
export async function publishImage(text,imageBuffer,imageName='market-card.png'){
 const apiKey=key();
 const signed=await api(V2,'/image/presignedUrl',apiKey,{imageName});
 if(!signed.presignedUrl||!signed.fileTicket)throw new Error('Binance did not return image upload ticket');
 const upload=await fetch(signed.presignedUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:imageBuffer,signal:AbortSignal.timeout(30000)});
 if(!upload.ok)throw new Error('Image upload failed: HTTP '+upload.status);
 let status;
 for(let i=0;i<10;i++){
  status=await api(V2,'/image/imageStatus',apiKey,{fileTicket:signed.fileTicket});
  if(status.status===1&&status.imageUrl)break;
  if(status.status===2)throw new Error('Binance image processing failed: '+String(status.failedReason||'unknown'));
  await sleep(3000);
 }
 if(!status||status.status!==1||!status.imageUrl)throw new Error('Timed out waiting for Binance image processing');
 const data=await api(V1,'/content/add',apiKey,{contentType:1,bodyTextOnly:text,imageList:[status.imageUrl]});
 const id=data.id||null;
 return {id,url:data.shareLink||(id?'https://www.binance.com/square/post/'+id:null),publishedAt:new Date().toISOString(),successWithoutId:!!data.successWithoutId,image:true};
}
