/**
 * Kas Origins - Original working trace logic
 * Direct Kaspa API calls
 */
const API_BASE='https://api.kaspa.org';
let apiCallCount=0,multiTraceResults=[],currentAbortController=null;

const KNOWN_ADDRESSES={
"kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz":{name:"MEXC",type:"exchange",category:"cex"},
"kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m":{name:"Gate.io",type:"exchange",category:"cex"},
"kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m":{name:"KuCoin 1",type:"exchange",category:"cex"},
"kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk":{name:"KuCoin 2",type:"exchange",category:"cex"},
"kaspa:qpq94ntnvy8p9q6wrdwtn37xtspgashrydc0kuu8ctpyxulmh0wlxh2807zdh":{name:"KuCoin 3",type:"exchange",category:"cex"},
"kaspa:qq3k4du6wf2g26j7ds6fqmgtgavgm3zy676wntp2e52nsuns2n4s6xkndmx0y":{name:"KuCoin 4",type:"exchange",category:"cex"},
"kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges":{name:"Bybit",type:"exchange",category:"cex"},
"kaspa:qzxrs8gxjgk2q84wlt3xfd057ntws73fptalhy84g85zqfu5lcemvpu04vj3w":{name:"Uphold 1",type:"exchange",category:"cex"},
"kaspa:qr7vrlhgekw9efxgfq09ca3wqcxlslgxndcpk77pguu2usaa9aa27lhuunewj":{name:"Uphold 2",type:"exchange",category:"cex"},
"kaspa:qqfxn597v5c23td4asz99ky52sha8l2ypq8kmrsqxcu7skhdunncjgup0hdys":{name:"Bitvavo 1",type:"exchange",category:"cex"},
"kaspa:qzxs23g7txh3wq9d0t2z0hluhsflvzpf6d0yfum830ppumgtxa5d7zqca8r67":{name:"Bitvavo 2",type:"exchange",category:"cex"},
"kaspa:qz4kt3t0qzpmpcgle28mgudu6lpu0fel6rgn0y2p808l8em7gd2exnss8cr2t":{name:"Bitvavo 3",type:"exchange",category:"cex"},
"kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle":{name:"Kraken",type:"exchange",category:"cex"},
"kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j":{name:"Bitget",type:"exchange",category:"cex"},
"kaspa:qyp90geyzyp56p4zqd87flxrwd64r557r2cwkuwxzuq9zxehmswcg8g54jmeu7p":{name:"PionexUS",type:"exchange",category:"cex"},
"kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2":{name:"CoinEx",type:"exchange",category:"cex"},
"kaspa:qq3wrlkeustm5sxg2w8x5m8w2h2s8w2h2s8w2h2s8w2h2s8w2h2s8w2h2s8w":{name:"Unknown Exchange (Linked to CoinEx)",type:"exchange",category:"cex",tentative:true},
"kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n":{name:"CoinEx Hot Wallet",type:"exchange",category:"cex"},
};

function lookupKnownAddress(a){return KNOWN_ADDRESSES[a]||null;}
function resolveAddressDisplay(a){const k=lookupKnownAddress(a);return k?`${k.type==='exchange'?'🏦':'📋'} ${k.name}`:(a?a.substring(0,18)+'...':'Unknown');}
function isExchangeAddress(a){return lookupKnownAddress(a)?.type==='exchange';}
function sompiToKAS(s){const n=typeof s==='string'?parseInt(s):s;return isNaN(n)?'0':(n/1e8).toFixed(6);}
function formatTime(ts){if(!ts)return'?';return new Date(parseInt(ts)).toLocaleString();}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function isValidKaspaAddress(a){return a&&a!=='Unknown'&&/^kaspa:[a-z0-9]{61,63}$/.test(a);}
function isCoinbaseTransaction(tx){const hasNoInputs=!tx.inputs||tx.inputs.length===0;const singleEmptyInput=tx.inputs?.length===1&&!tx.inputs[0].previous_outpoint_hash&&!tx.inputs[0].signature_script;const coinbaseMarker=tx.inputs?.[0]?.previous_outpoint_hash==='0000000000000000000000000000000000000000000000000000000000000000';return hasNoInputs||singleEmptyInput||coinbaseMarker;}

// Rate limiter
const RL={minDelay:100,maxDelay:5000,backoffFactor:2,maxRetries:3,callsPerSecond:8};
let lastCall=0,consLimits=0,winStart=Date.now(),winCalls=0;
async function rateLimitedFetch(url,options={},retryCount=0){
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const now=Date.now();
  if(now-winStart>1000){winStart=now;winCalls=0;}
  if(winCalls>=RL.callsPerSecond){const w=1000-(now-winStart);if(w>0)await sleep(w);winStart=Date.now();winCalls=0;}
  const since=now-lastCall;if(since<RL.minDelay)await sleep(RL.minDelay-since);
  if(consLimits>0){await sleep(Math.min(RL.minDelay*Math.pow(RL.backoffFactor,consLimits),RL.maxDelay));}
  lastCall=Date.now();winCalls++;apiCallCount++;
  try{
    const r=await fetch(url,options);
    if(r.status===429){consLimits++;if(retryCount<RL.maxRetries){await sleep(2000*(retryCount+1));return rateLimitedFetch(url,options,retryCount+1);}throw new Error('Rate limit');}
    if(r.status===503){if(retryCount<RL.maxRetries){await sleep(3000*(retryCount+1));return rateLimitedFetch(url,options,retryCount+1);}throw new Error('Service unavailable');}
    if(consLimits>0)consLimits=Math.max(0,consLimits-1);
    return r;
  }catch(e){if(e.name==='AbortError')throw e;if(retryCount<RL.maxRetries){await sleep(1000*(retryCount+1));return rateLimitedFetch(url,options,retryCount+1);}throw e;}
}

// ========== ORIGINAL WORKING TRACE LOGIC ==========
async function traceLifecycleForMulti(txId,outputIndex,signal,autoContinue){
  const allLifecycle=[],globalVisited=new Set();
  let currentTxId=txId,currentIndex=outputIndex,totalHops=0,maxTotalHops=100,segmentNumber=0;
  const validationWarnings=[];
  let fastPathHopsSaved=0,behavioralFastPathUsed=false;

  while(currentTxId&&totalHops<maxTotalHops){
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    segmentNumber++;
    const segmentLifecycle=[],segmentVisited=new Set();
    let backwardTxId=currentTxId,backwardIndex=currentIndex,originFound=false,attempts=0,maxAttempts=30;

    while(!originFound&&attempts<maxAttempts&&totalHops<maxTotalHops){
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      attempts++;totalHops++;
      const key=`${backwardTxId}:${backwardIndex}`;
      if(segmentVisited.has(key)||globalVisited.has(key))break;
      segmentVisited.add(key);globalVisited.add(key);

      const res=await rateLimitedFetch(`${API_BASE}/transactions/${backwardTxId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal});
      if(!res.ok)break;
      const tx=await res.json();
      const outputs=tx.outputs||[];

      if(backwardIndex<0||backwardIndex>=outputs.length){
        segmentLifecycle.unshift({txId:backwardTxId,type:'dead_end',amount:0,address:'Invalid_Output_Index',blockTime:tx.block_time,blockHash:tx.block_hash?.[0]||null,isCoinbase:false,isExchangeAddress:false,isBehavioralExchange:false});
        originFound=true;break;
      }

      const input=tx.inputs?.[backwardIndex];
      if(!input||!input.previous_outpoint_hash){
        const isCoinbase=isCoinbaseTransaction(tx);
        const outputAddress=outputs[backwardIndex]?.script_public_key_address||'Unknown';
        const addressValid=isValidKaspaAddress(outputAddress);
        segmentLifecycle.unshift({txId:backwardTxId,type:isCoinbase?'coinbase':'dead_end',amount:outputs[backwardIndex]?.amount||0,address:outputAddress,blockTime:tx.block_time,blockHash:tx.block_hash?.[0]||null,isCoinbase,invalidAddress:!addressValid&&outputAddress!=='Unknown',isExchangeAddress:isExchangeAddress(outputAddress),isBehavioralExchange:false});
        originFound=true;
        if(!isCoinbase&&outputs[backwardIndex]?.script_public_key_address)segmentLifecycle[0].continueAddress=outputs[backwardIndex].script_public_key_address;
        break;
      }

      const prevAddress=input.previous_outpoint_address||'Unknown';
      const prevAddressValid=isValidKaspaAddress(prevAddress);
      segmentLifecycle.unshift({txId:backwardTxId,type:'spend',amount:input.previous_outpoint_amount||0,address:prevAddress,blockTime:tx.block_time,blockHash:tx.block_hash?.[0]||null,invalidAddress:!prevAddressValid&&prevAddress!=='Unknown',isExchangeAddress:isExchangeAddress(prevAddress),isBehavioralExchange:false});
      backwardTxId=input.previous_outpoint_hash;
      backwardIndex=parseInt(input.previous_outpoint_index)||0;
      await sleep(30);
    }

    if(segmentLifecycle.length>0){if(allLifecycle.length>0)allLifecycle.push({type:'separator'});allLifecycle.push(...segmentLifecycle);}
    if(!autoContinue)break;

    const lastStep=segmentLifecycle[0];
    if(lastStep&&lastStep.continueAddress&&!(lastStep.isCoinbase===true)&&totalHops<maxTotalHops){
      let foundNext=false;
      const exchangeInfo=lookupKnownAddress(lastStep.continueAddress);
      const recentSteps=allLifecycle.filter(s=>s.type==='spend'||s.type==='coinbase'||s.type==='dead_end');

      // Behavioral exchange detection
      if(!exchangeInfo&&!foundNext){
        const addressSteps=recentSteps.filter(s=>s.address===lastStep.continueAddress);
        if(addressSteps.length>=5){
          const hasVeryLarge=addressSteps.some(s=>parseFloat(sompiToKAS(s.amount||0))>=1000000);
          const timestamps=addressSteps.filter(s=>s.blockTime).map(s=>parseInt(s.blockTime));
          let rapid=0;for(let i=1;i<timestamps.length;i++){if(Math.abs(timestamps[i]-timestamps[i-1])/1000<30)rapid++;}
          const hasRapid=rapid>=3;
          const amounts=addressSteps.map(s=>parseFloat(sompiToKAS(s.amount||0)));
          let alts=0;for(let i=2;i<amounts.length;i++){const d1=Math.abs(amounts[i]-amounts[i-2]),d2=Math.abs(amounts[i-1]-(amounts[i-3]||0)),t=Math.max(amounts[i],amounts[i-2])*0.001;if(d1<t&&d2<t&&Math.abs(amounts[i]-amounts[i-1])>t*10)alts++;}
          const hasAlt=alts>=3;
          if([hasVeryLarge,hasRapid,hasAlt].filter(Boolean).length>=2){
            behavioralFastPathUsed=true;
            allLifecycle.push({type:'message',text:'🏦 Detected unknown exchange activity - applying fast-path...'});
            try{
              const r=await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal});
              const tx=await r.json();
              const extInputs=(tx.inputs||[]).filter(inp=>{
                const a=inp.previous_outpoint_address||'';
                const amt=parseFloat(sompiToKAS(inp.previous_outpoint_amount||0));
                const addrSteps=recentSteps.filter(s=>s.address===a);
                if(addrSteps.length>=5){
                  const vl=addrSteps.some(s=>parseFloat(sompiToKAS(s.amount||0))>=1000000);
                  const ts=addrSteps.filter(s=>s.blockTime).map(s=>parseInt(s.blockTime));
                  let rp=0;for(let i=1;i<ts.length;i++){if(Math.abs(ts[i]-ts[i-1])/1000<30)rp++;}
                  if(vl&&rp>=3)return false;
                }
                return amt<1000000;
              });
              if(extInputs.length>0){currentTxId=extInputs[0].previous_outpoint_hash;currentIndex=parseInt(extInputs[0].previous_outpoint_index)||0;foundNext=true;fastPathHopsSaved+=15;allLifecycle.push({type:'message',text:'⚡ Behavioral fast-path'});}
            }catch(e){}
          }
        }
      }

      // Known exchange fast-path
      if(!foundNext&&exchangeInfo&&exchangeInfo.type==='exchange'){
        allLifecycle.push({type:'message',text:`🏦 Detected ${exchangeInfo.name} - using fast-path...`});
        try{
          const r=await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal});
          const tx=await r.json();
          const extInputs=(tx.inputs||[]).filter(inp=>inp.previous_outpoint_hash&&inp.previous_outpoint_address&&!isExchangeAddress(inp.previous_outpoint_address));
          if(extInputs.length>0){currentTxId=extInputs[0].previous_outpoint_hash;currentIndex=parseInt(extInputs[0].previous_outpoint_index)||0;foundNext=true;fastPathHopsSaved+=10;allLifecycle.push({type:'message',text:`⚡ Fast-path: Skipped ${exchangeInfo.name} internal transfers`});}
          else{const first=tx.inputs?.[0];if(first?.previous_outpoint_hash){currentTxId=first.previous_outpoint_hash;currentIndex=parseInt(first.previous_outpoint_index)||0;foundNext=true;allLifecycle.push({type:'message',text:`🏦 Tracing through ${exchangeInfo.name} internal transfer`});}}
        }catch(e){}
      }

      // Strategy 1: Same address history
      if(!foundNext){
        try{
          const r=await rateLimitedFetch(`${API_BASE}/addresses/${lastStep.continueAddress}/full-transactions-page?limit=20`,{signal});
          const txs=await r.json();
          if(Array.isArray(txs)){
            for(const histTx of txs){if(histTx.outputs&&!foundNext){for(let oi=0;oi<histTx.outputs.length;oi++){const out=histTx.outputs[oi];const outAddr=out.script_public_key_address||out.verboseData?.scriptPublicKeyAddress||'';const key=`${histTx.transaction_id}:${oi}`;const deadTime=parseInt(lastStep.blockTime)||0;const histTime=parseInt(histTx.block_time)||0;if(isExchangeAddress(outAddr)&&outAddr!==lastStep.continueAddress)continue;if(outAddr===lastStep.continueAddress&&parseInt(out.amount)>0&&!globalVisited.has(key)&&(histTime===0||deadTime===0||histTime<=deadTime)){currentTxId=histTx.transaction_id;currentIndex=oi;foundNext=true;allLifecycle.push({type:'message',text:'🔗 Continued via same address'});break;}}}}
          }
        }catch(e){}
      }

      // Strategy 2: Other outputs
      if(!foundNext&&!signal.aborted){
        try{
          const r=await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal});
          const deadEndData=await r.json();
          if(deadEndData.outputs){
            const outputs=deadEndData.outputs.sort((a,b)=>{const aEx=isExchangeAddress(a.script_public_key_address||a.verboseData?.scriptPublicKeyAddress||'');const bEx=isExchangeAddress(b.script_public_key_address||b.verboseData?.scriptPublicKeyAddress||'');if(aEx&&!bEx)return 1;if(!aEx&&bEx)return-1;return 0;});
            for(let oi=0;oi<outputs.length&&!foundNext;oi++){if(signal.aborted)break;const out=outputs[oi];const outAddr=out.script_public_key_address||out.verboseData?.scriptPublicKeyAddress||'';const key=`${lastStep.txId}:${oi}`;if(globalVisited.has(key)||!outAddr||parseInt(out.amount)<=0)continue;if(isExchangeAddress(outAddr))continue;const branchRes=await rateLimitedFetch(`${API_BASE}/addresses/${outAddr}/full-transactions-page?limit=20`,{signal});const branchTxs=await branchRes.json();if(Array.isArray(branchTxs)){for(const branchTx of branchTxs){if(branchTx.outputs&&!foundNext){for(let bi=0;bi<branchTx.outputs.length;bi++){const bOut=branchTx.outputs[bi];const bAddr=bOut.script_public_key_address||bOut.verboseData?.scriptPublicKeyAddress||'';const bKey=`${branchTx.transaction_id}:${bi}`;const deadTime=parseInt(lastStep.blockTime)||0;const bTime=parseInt(branchTx.block_time)||0;if(bAddr===outAddr&&parseInt(bOut.amount)>0&&!globalVisited.has(bKey)&&(bTime===0||deadTime===0||bTime<=deadTime)){currentTxId=branchTx.transaction_id;currentIndex=bi;foundNext=true;allLifecycle.push({type:'message',text:'🔀 Switched to non-exchange branch'});break;}}}}}if(foundNext)break;await sleep(20);}
          }
        }catch(e){}
      }

      // Strategy 3: Input addresses
      if(!foundNext&&!signal.aborted){
        try{
          const r=await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&resolve_previous_outpoints=light`,{signal});
          const deadEndData=await r.json();
          if(deadEndData.inputs){
            const inputs=deadEndData.inputs.sort((a,b)=>{const aEx=isExchangeAddress(a.previous_outpoint_address||'');const bEx=isExchangeAddress(b.previous_outpoint_address||'');if(aEx&&!bEx)return 1;if(!aEx&&bEx)return-1;return 0;});
            for(let ii=0;ii<inputs.length&&!foundNext;ii++){const inp=inputs[ii];if(inp.previous_outpoint_address&&inp.previous_outpoint_hash&&!globalVisited.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index}`)){currentTxId=inp.previous_outpoint_hash;currentIndex=parseInt(inp.previous_outpoint_index)||0;foundNext=true;const addrLabel=isExchangeAddress(inp.previous_outpoint_address)?` (${lookupKnownAddress(inp.previous_outpoint_address)?.name})`:'';allLifecycle.push({type:'message',text:`🔗 Traced through input address${addrLabel}`});break;}}
          }
        }catch(e){}
      }

      // Strategy 4: Deep search
      if(!foundNext&&!signal.aborted){
        try{
          const searchRes=await rateLimitedFetch(`${API_BASE}/addresses/${lastStep.continueAddress}/full-transactions-page?limit=50`,{signal});
          const allTxs=await searchRes.json();
          if(Array.isArray(allTxs)&&allTxs.length>0){allTxs.sort((a,b)=>(a.block_time||0)-(b.block_time||0));for(const oldTx of allTxs){if(oldTx.outputs&&!foundNext){for(let oi=0;oi<oldTx.outputs.length;oi++){const out=oldTx.outputs[oi];const outAddr=out.script_public_key_address||out.verboseData?.scriptPublicKeyAddress||'';const key=`${oldTx.transaction_id}:${oi}`;const deadTime=parseInt(lastStep.blockTime)||0;const oldTime=parseInt(oldTx.block_time)||0;if(outAddr===lastStep.continueAddress&&parseInt(out.amount)>0&&!globalVisited.has(key)&&(oldTime===0||deadTime===0||oldTime<=deadTime)){currentTxId=oldTx.transaction_id;currentIndex=oi;foundNext=true;allLifecycle.push({type:'message',text:'🔍 Found via deep search'});break;}}}}}
        }catch(e){}
      }

      if(!foundNext){allLifecycle.push({type:'message',text:'🔚 All strategies exhausted'});break;}
    }else{break;}
    await sleep(50);
  }

  const realSteps=allLifecycle.filter(s=>s.type!=='separator'&&s.type!=='message');
  realSteps.sort((a,b)=>(parseInt(a.blockTime)||0)-(parseInt(b.blockTime)||0));
  return{steps:realSteps,allLifecycle,foundCoinbase:realSteps.some(s=>s.type==='coinbase'||s.isCoinbase),totalHops,segments:segmentNumber,uniqueAddresses:new Set(realSteps.map(s=>s.address)).size,validationWarnings,fastPathHopsSaved,usedFastPath:fastPathHopsSaved>0,behavioralFastPathUsed};
}

async function traceFromAddress(address,signal){
  try{
    const r=await rateLimitedFetch(`${API_BASE}/addresses/${address}/utxos`,{signal});const utxos=await r.json();
    if(!Array.isArray(utxos)||!utxos.length){return[];}
    const selected=utxos.slice(0,5);multiTraceResults=[];
    for(const utxo of selected){if(signal.aborted)break;const result=await traceLifecycleForMulti(utxo.outpoint?.transactionId||'',utxo.outpoint?.index||0,signal,true);result.input=`${address} (UTXO)`;result.inputType='address_utxo';multiTraceResults.push(result);await sleep(100);}
    return multiTraceResults;
  }catch(e){return[];}
}

// UI
function up(m,d,p){document.getElementById('resultPanel').innerHTML=`<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${m}</div><div class="progress-detail">${d||''}</div><div class="progress-bar-container"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;}
function toast(m){const t=document.createElement('div');t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a2535;border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2500);}
function render(res){if(!res.length)return;const r=res[0],s=r.steps||[],ls=s[s.length-1]||{};let h=`<div class="export-bar"><button class="btn-export-sm" onclick="exp()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount}</span></div>`;h+=`<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase?'✅ Origin Found':'⚠️ Partial'}</div></div>`;h+=`<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${s.length}</div><div class="story-stat-label">Steps</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase?'⛏️':'❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${sompiToKAS(ls.amount)}</div><div class="story-stat-label">Amount</div></div></div></div>`;h+='<div class="journey-timeline">';s.forEach(st=>{const b=st.type==='coinbase'||st.isCoinbase?'⛏️ Mining':st.isExchangeAddress?'🏦 Exchange':'💸 Transfer';h+=`<div class="journey-step ${st.type==='coinbase'?'mining':st.isExchangeAddress?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${st.type==='coinbase'?'badge-mining':st.isExchangeAddress?'badge-exchange':'badge-personal'}">${b}</span><span class="step-amount">${sompiToKAS(st.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${resolveAddressDisplay(st.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${formatTime(st.blockTime)}</span></div></div></div></div>`;});h+='</div>';document.getElementById('resultPanel').innerHTML=h;}
function exp(){const d={time:new Date().toISOString(),calls:apiCallCount,traces:multiTraceResults};const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`kas-${Date.now()}.json`;a.click();toast('Exported');}

document.getElementById('btnTrace').addEventListener('click',async()=>{const inp=document.getElementById('mainInput').value.trim();if(!inp)return toast('Enter TX ID or address');apiCallCount=0;document.getElementById('btnTrace').disabled=true;document.getElementById('btnCancel').style.display='inline-block';if(currentAbortController)currentAbortController.abort();currentAbortController=new AbortController();const sig=currentAbortController.signal;up('Tracing...','Kaspa API',10);try{if(/^[a-f0-9]{64}$/.test(inp)){const r=await traceLifecycleForMulti(inp,0,sig,true);r.input=inp;r.inputType='txid';multiTraceResults=[r];render([r]);}else if(/^kaspa:[a-z0-9]{61,63}$/.test(inp)){const r=await traceFromAddress(inp,sig);if(!r.length)document.getElementById('resultPanel').innerHTML='<p style="color:var(--muted);">No UTXOs.</p>';else{multiTraceResults=r;render(r);}}else document.getElementById('resultPanel').innerHTML='<p style="color:#f87171;">Invalid input.</p>';}catch(e){if(e.name!=='AbortError')document.getElementById('resultPanel').innerHTML=`<p style="color:#f87171;">${e.message}</p>`;}finally{document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';currentAbortController=null;}});
document.getElementById('btnCancel').addEventListener('click',()=>{if(currentAbortController){currentAbortController.abort();currentAbortController=null;}document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';});
