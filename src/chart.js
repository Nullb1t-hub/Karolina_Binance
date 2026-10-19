export function makeMarketCardSvg(coin,market){
 const symbol=String(coin.symbol||'COIN').replace(/USDT$/,'');
 const change=Number(coin.change24h||0);
 const color=change>=0?'#25C685':'#FF5C70';
 const price=Number(coin.price||0).toLocaleString('en-US',{maximumSignificantDigits:8});
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" rx="32" fill="#111827"/><circle cx="1040" cy="90" r="200" fill="#F0B90B" opacity=".08"/><text x="70" y="90" fill="#F0B90B" font-size="28" font-family="Arial">KAROLINA • CRYPTO RESEARCH</text><text x="70" y="160" fill="#CBD5E1" font-size="24" font-family="Arial">'+(market==='futures'?'FUTURES MARKET WATCH':'SPOT MARKET WATCH')+'</text><text x="70" y="315" fill="#FFFFFF" font-size="116" font-weight="700" font-family="Arial">'+esc(symbol)+'</text><text x="70" y="390" fill="#CBD5E1" font-size="28" font-family="Arial">Last reported price</text><text x="70" y="475" fill="#FFFFFF" font-size="60" font-family="Arial">'+esc(price)+'</text><text x="70" y="565" fill="'+color+'" font-size="48" font-weight="700" font-family="Arial">'+(change>=0?'+':'')+change.toFixed(2)+'% / 24h</text><text x="1120" y="625" fill="#94A3B8" font-size="18" text-anchor="end" font-family="Arial">Snapshot • not a trading signal</text></svg>';
}
