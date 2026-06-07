/**
 * Kas Origins v3 - Fixed exchange loop detection
 */
const API_BASE = 'https://api.kaspa.org';
let apiCallCount = 0, multiTraceResults = [], currentAbortController = null;

// All exchange addresses - CoinEx cluster grouped together
const EXCHANGE_ADDRESSES = new Set([
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz", // MEXC
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m", // Gate.io
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m", // KuCoin
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk", // KuCoin
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges", // Bybit
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle", // Kraken
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j", // Bitget
  // CoinEx cluster - ALL grouped as "CoinEx"
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2",
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n",
  "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r",
]);

const KNOWN_NAMES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": "MEXC",
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": "Gate.io",
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": "CoinEx",
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n": "CoinEx",
  "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r": "CoinEx",
};

function isExchangeAddress(a) { return EXCHANGE_ADDRESSES.has(a); }
function getExchangeName(a) { return KNOWN_NAMES[a] || null; }
function resolveAddressDisplay(a) {
  const n = getExchangeName(a);
  return n ? `🏦 ${n}` : (a ? a.substring(0,18)+'...' : 'Unknown');
}
function sompiToKAS(s) { const n = typeof s === 'string' ? parseInt(s) : s; return isNaN(n) ? '0' : (n / 1e8).toFixed(6); }
function formatTime(ts) { if (!ts) return '?'; return new Date(parseInt(ts)).toLocaleString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isCB(tx) {
  if (!tx.inputs||!tx.inputs.length) return true;
  if (tx.inputs.length===1 && !tx.inputs[0].previous_outpoint_hash && !tx.inputs[0].signature_script) return true;
  return tx.inputs[0]?.previous_outpoint_hash === '0000000000000000000000000000000000000000000000000000000000000000';
}

// Rate limiter
let lc=0, cl=0, ws=Date.now(), wc=0;
async function rlf(url, o={}, r=0) {
  if (o.signal?.aborted) throw new DOMException('Aborted','AbortError');
  const n=Date.now();
  if (n-ws>1000){ws=n;wc=0;}
  if (wc>=8){const w=1000-(n-ws);if(w>0)await sleep(w);ws=Date.now();wc=0;}
  if (n-lc<100)await sleep(100-(n-lc));
  if (cl>0)await sleep(Math.min(100*Math.pow(2,cl),5000));
  lc=n;wc++;apiCallCount++;
  try {
    const res=await fetch(url,o);
    if (res.status===429){cl++;if(r<3){await sleep(2000*(r+1));return rlf(url,o,r+1);}throw new Error('RL');}
    if (res.status===503){if(r<3){await sleep(3000*(r+1));return rlf(url,o,r+1);}throw new Error('Svc');}
    if (cl>0)cl--;
    return res;
  }catch(e){if(e.name==='AbortError')throw e;if(r<3){await sleep(1000*(r+1));return rlf(url,o,r+1);}throw e;}
}

async function trace(txId, oi, sig, ac) {
  const all=[], vis=new Set();
  let ctx=txId, cix=oi, hops=0, segs=0;
  const MAX_HOPS=100, MAX_SEGMENTS=10;

  while(ctx && hops<MAX_HOPS && segs<MAX_SEGMENTS) {
    if (sig.aborted) throw new DOMException('Aborted','AbortError');
    segs++;
    const seg=[], sv=new Set();
    let btx=ctx, bix=cix, found=false, at=0;

    while(!found && at<30 && hops<MAX_HOPS) {
      if (sig.aborted) throw new DOMException('Aborted','AbortError');
      at++;hops++;
      const k=`${btx}:${bix}`;
      if(sv.has(k)||vis.has(k)) break;
      sv.add(k);vis.add(k);

      const res=await rlf(`${API_BASE}/transactions/${btx}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
      if(!res.ok) break;
      const tx=await res.json();
      const outs=tx.outputs||[];

      if(bix>=outs.length) {
        seg.unshift({txId:btx,type:'dead_end',amount:0,address:'Invalid',blockTime:tx.block_time,isCoinbase:false,isExchangeAddress:false});
        found=true;break;
      }

      const inp=(tx.inputs||[])[bix];
      if(!inp||!inp.previous_outpoint_hash) {
        const cb=isCB(tx);
        const a=outs[bix]?.script_public_key_address||'Unknown';
        const step={txId:btx,type:cb?'coinbase':'dead_end',amount:outs[bix]?.amount||0,address:a,blockTime:tx.block_time,isCoinbase:cb,isExchangeAddress:isExchangeAddress(a)};
        seg.unshift(step);found=true;
        if(!cb && a!=='Unknown') step.cont=a;
        break;
      }

      const pa=inp.previous_outpoint_address||'Unknown';
      seg.unshift({txId:btx,type:'spend',amount:inp.previous_outpoint_amount||0,address:pa,blockTime:tx.block_time,isExchangeAddress:isExchangeAddress(pa)});
      btx=inp.previous_outpoint_hash;
      bix=parseInt(inp.previous_outpoint_index)||0;
      await sleep(30);
    }

    if(seg.length){if(all.length)all.push({type:'sep'});all.push(...seg);}
    if(!ac) break;

    const last=seg[0];
    if(last?.cont && !last.isCoinbase && hops<MAX_HOPS) {
      const eName=getExchangeName(last.cont);
      let nxt=null;

      // EXCHANGE FAST-PATH: skip exchange internal transfers
      if(eName) {
        const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
        const tx=await r.json();
        const inputs=(tx.inputs||[]).filter(i=>i.previous_outpoint_hash&&!vis.has(`${i.previous_outpoint_hash}:${i.previous_outpoint_index||0}`));
        
        // Prefer non-exchange inputs
        const ext=inputs.filter(i=>!isExchangeAddress(i.previous_outpoint_address||''));
        
        if(ext.length>0) {
          nxt={tx:ext[0].previous_outpoint_hash, idx:parseInt(ext[0].previous_outpoint_index)||0};
          all.push({type:'msg',text:`⚡ Fast-path: Skipped ${eName} internal transfers`});
        } else if(inputs.length>0) {
          // Check if any input goes to a DIFFERENT exchange
          const diff=inputs.find(i=>{
            const n=getExchangeName(i.previous_outpoint_address||'');
            return n && n!==eName;
          });
          if(diff) {
            nxt={tx:diff.previous_outpoint_hash, idx:parseInt(diff.previous_outpoint_index)||0};
            all.push({type:'msg',text:`→ Different exchange: ${getExchangeName(diff.previous_outpoint_address)}`});
          }
          // If ALL same exchange - STOP (nxt stays null)
        }
      }

      // STRATEGY: same address history
      if(!nxt) {
        try {
          const r=await rlf(`${API_BASE}/addresses/${last.cont}/full-transactions-page?limit=20`,{signal:sig});
          const txs=await r.json();
          if(Array.isArray(txs)) {
            const dt=parseInt(last.blockTime)||0;
            for(const ht of txs) {
              if(!nxt && ht.outputs) {
                for(let o=0;o<ht.outputs.length;o++) {
                  const oa=ht.outputs[o].script_public_key_address||'';
                  const k=`${ht.transaction_id}:${o}`;
                  const htTime=parseInt(ht.block_time)||0;
                  if(oa===last.cont && parseInt(ht.outputs[o].amount)>0 && !vis.has(k) && (htTime===0||dt===0||htTime<=dt)) {
                    nxt={tx:ht.transaction_id,idx:o};all.push({type:'msg',text:'🔗 Same address'});break;
                  }
                }
              }
            }
          }
        }catch(e){}
      }

      // STRATEGY: other outputs
      if(!nxt) {
        try {
          const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
          const tx=await r.json();
          if(tx.outputs) {
            const dt=parseInt(last.blockTime)||0;
            for(let o=0;o<tx.outputs.length&&!nxt;o++) {
              const out=tx.outputs[o];
              const oa=out.script_public_key_address||'';
              if(!oa||oa===last.cont||isExchangeAddress(oa)||parseInt(out.amount)<=0) continue;
              if(vis.has(`${last.txId}:${o}`)) continue;
              const br=await rlf(`${API_BASE}/addresses/${oa}/full-transactions-page?limit=20`,{signal:sig});
              const btxs=await br.json();
              if(Array.isArray(btxs)) {
                for(const bt of btxs) {
                  if(!nxt && bt.outputs) {
                    for(let b=0;b<bt.outputs.length;b++) {
                      const ba=bt.outputs[b].script_public_key_address||'';
                      const bk=`${bt.transaction_id}:${b}`;
                      const btTime=parseInt(bt.block_time)||0;
                      if(ba===oa && parseInt(bt.outputs[b].amount)>0 && !vis.has(bk) && (btTime===0||dt===0||btTime<=dt)) {
                        nxt={tx:bt.transaction_id,idx:b};all.push({type:'msg',text:'🔀 Other output'});break;
                      }
                    }
                  }
                }
              }
              await sleep(20);
            }
          }
        }catch(e){}
      }

      // STRATEGY: input addresses
      if(!nxt) {
        try {
          const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&resolve_previous_outpoints=light`,{signal:sig});
          const tx=await r.json();
          if(tx.inputs) {
            for(const inp of tx.inputs) {
              if(!nxt && inp.previous_outpoint_hash && !vis.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index||0}`)) {
                nxt={tx:inp.previous_outpoint_hash,idx:parseInt(inp.previous_outpoint_index)||0};all.push({type:'msg',text:'🔗 Input'});break;
              }
            }
          }
        }catch(e){}
      }

      if(nxt){ctx=nxt.tx;cix=nxt.idx;}
      else {all.push({type:'msg',text:'🔚 Exhausted'});break;}
    } else break;
    await sleep(50);
  }

  const steps=all.filter(s=>s.type!=='sep'&&s.type!=='msg');
  steps.sort((a,b)=>(parseInt(a.blockTime)||0)-(parseInt(b.blockTime)||0));
  return {steps,foundCoinbase:steps.some(s=>s.type==='coinbase'||s.isCoinbase),totalHops:hops,uniqueAddresses:new Set(steps.map(s=>s.address)).size};
}

async function traceAddr(addr, sig) {
  const r=await rlf(`${API_BASE}/addresses/${addr}/utxos`,{signal:sig});
  const u=await r.json();
  if(!Array.isArray(u)||!u.length) return [];
  const res=[];
  for(const x of u.slice(0,3)){if(sig.aborted)break;const t=await trace(x.outpoint?.transactionId||'',x.outpoint?.index||0,sig,true);t.input=`${addr} (UTXO)`;res.push(t);await sleep(100);}
  return res;
}

// UI
function up(msg,d,p){document.getElementById('resultPanel').innerHTML=`<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${msg}</div><div class="progress-detail">${d||''}</div><div class="progress-bar-container"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;}
function toast(msg){const t=document.createElement('div');t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a2535;border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2500);}
function render(res){
  if(!res.length)return;
  const r=res[0],s=r.steps||[],ls=s[s.length-1]||{};
  let h=`<div class="export-bar"><button class="btn-export-sm" onclick="exp()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount}</span></div>`;
  h+=`<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase?'✅ Origin Found':'⚠️ Partial'}</div></div>`;
  h+=`<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${s.length}</div><div class="story-stat-label">Steps</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase?'⛏️':'❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${sompiToKAS(ls.amount)}</div><div class="story-stat-label">Amount</div></div></div></div>`;
  h+='<div class="journey-timeline">';
  s.forEach(st=>{
    const b=st.type==='coinbase'||st.isCoinbase?'⛏️ Mining':st.isExchangeAddress?'🏦 Exchange':'💸 Transfer';
    h+=`<div class="journey-step ${st.type==='coinbase'?'mining':st.isExchangeAddress?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${st.type==='coinbase'?'badge-mining':st.isExchangeAddress?'badge-exchange':'badge-personal'}">${b}</span><span class="step-amount">${sompiToKAS(st.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${resolveAddressDisplay(st.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${formatTime(st.blockTime)}</span></div></div></div></div>`;
  });
  h+='</div>';
  document.getElementById('resultPanel').innerHTML=h;
}
function exp(){const d={time:new Date().toISOString(),calls:apiCallCount,traces:multiTraceResults};const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`kas-${Date.now()}.json`;a.click();toast('Exported');}

document.getElementById('btnTrace').addEventListener('click',async()=>{
  const inp=document.getElementById('mainInput').value.trim();
  if(!inp)return toast('Enter TX ID or address');
  apiCallCount=0;
  document.getElementById('btnTrace').disabled=true;
  document.getElementById('btnCancel').style.display='inline-block';
  if(currentAbortController)currentAbortController.abort();
  currentAbortController=new AbortController();
  const sig=currentAbortController.signal;
  up('Tracing...','Kaspa API',10);
  try{
    if(/^[a-f0-9]{64}$/.test(inp)){
      const r=await trace(inp,0,sig,true);r.input=inp;multiTraceResults=[r];render([r]);
    }else if(/^kaspa:[a-z0-9]{61,63}$/.test(inp)){
      const r=await traceAddr(inp,sig);
      if(!r.length)document.getElementById('resultPanel').innerHTML='<p style="color:var(--muted);">No UTXOs found.</p>';
      else{multiTraceResults=r;render(r);}
    }else{document.getElementById('resultPanel').innerHTML='<p style="color:#f87171;">Invalid input.</p>';}
  }catch(e){if(e.name!=='AbortError')document.getElementById('resultPanel').innerHTML=`<p style="color:#f87171;">${e.message}</p>`;}
  finally{document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';currentAbortController=null;}
});

document.getElementById('btnCancel').addEventListener('click',()=>{if(currentAbortController){currentAbortController.abort();currentAbortController=null;}document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';});
