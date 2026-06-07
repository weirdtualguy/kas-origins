/**
 * Kas Origins v6 - Exchange stop + continuation only for non-exchange
 */
const API_BASE='https://api.kaspa.org';
let apiCallCount=0,multiTraceResults=[],currentAbortController=null;

const EX=new Set(["kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz","kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m","kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m","kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk","kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges","kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle","kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j","kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2","kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n","kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r"]);
const EN={"kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2":"CoinEx","kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n":"CoinEx","kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r":"CoinEx","kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz":"MEXC","kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m":"Gate.io"};
const isEx=a=>EX.has(a);const exN=a=>EN[a]||null;const disp=a=>{const n=exN(a);return n?`🏦 ${n}`:(a?a.substring(0,18)+'...':'Unknown');};
const s2k=s=>{const n=typeof s==='string'?parseInt(s):s;return isNaN(n)?'0':(n/1e8).toFixed(6);};
const ft=ts=>ts?new Date(parseInt(ts)).toLocaleString():'?';const sl=ms=>new Promise(r=>setTimeout(r,ms));
const isCB=tx=>!tx.inputs||!tx.inputs.length||(tx.inputs.length===1&&!tx.inputs[0].previous_outpoint_hash)||tx.inputs[0]?.previous_outpoint_hash==='0000000000000000000000000000000000000000000000000000000000000000';
let lc=0,cl=0,ws=Date.now(),wc=0;
async function rlf(url,o={},r=0){if(o.signal?.aborted)throw new DOMException('Aborted','AbortError');const n=Date.now();if(n-ws>1000){ws=n;wc=0;}if(wc>=8){const w=1000-(n-ws);if(w>0)await sl(w);ws=Date.now();wc=0;}if(n-lc<100)await sl(100-(n-lc));if(cl>0)await sl(Math.min(100*Math.pow(2,cl),5000));lc=n;wc++;apiCallCount++;try{const res=await fetch(url,o);if(res.status===429){cl++;if(r<3){await sl(2000*(r+1));return rlf(url,o,r+1);}throw new Error('RL');}if(res.status===503){if(r<3){await sl(3000*(r+1));return rlf(url,o,r+1);}throw new Error('Svc');}if(cl>0)cl--;return res;}catch(e){if(e.name==='AbortError')throw e;if(r<3){await sl(1000*(r+1));return rlf(url,o,r+1);}throw e;}}
async function getTxs(a,sig,l=20){const r=await rlf(`${API_BASE}/addresses/${a}/full-transactions-page?limit=${l}`,{signal:sig});const t=await r.json();if(!Array.isArray(t))return[];const o=[];for(const x of t){if(x.outputs)for(let i=0;i<x.outputs.length;i++)if((x.outputs[i].script_public_key_address||'')===a&&parseInt(x.outputs[i].amount)>0){o.push({tid:x.transaction_id,oi:i,amt:parseInt(x.outputs[i].amount),bt:x.block_time});break;}}return o;}

async function findCont(last,vis,sig){
  const a=last.cont,tid=last.txId,dt=parseInt(last.blockTime)||0;
  // Strategy 1
  const txs=await getTxs(a,sig,20);
  for(const h of txs){const k=`${h.tid}:${h.oi}`,ht=parseInt(h.bt)||0;if(!vis.has(k)&&(ht===0||dt===0||ht<=dt))return{tx:h.tid,idx:h.oi};}
  // Strategy 2
  const r=await rlf(`${API_BASE}/transactions/${tid}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
  const tx=await r.json();
  if(tx.outputs)for(let o=0;o<tx.outputs.length;o++){const out=tx.outputs[o],oa=out.script_public_key_address||'';if(!oa||oa===a||isEx(oa)||parseInt(out.amount)<=0||vis.has(`${tid}:${o}`))continue;const b=await getTxs(oa,sig,20);for(const bt of b){const bk=`${bt.tid}:${bt.oi}`,btt=parseInt(bt.bt)||0;if(!vis.has(bk)&&(btt===0||dt===0||btt<=dt))return{tx:bt.tid,idx:bt.oi};}await sl(20);}
  // Strategy 3
  const r2=await rlf(`${API_BASE}/transactions/${tid}?inputs=true&resolve_previous_outpoints=light`,{signal:sig});
  const tx2=await r2.json();
  if(tx2.inputs)for(const i of tx2.inputs)if(i.previous_outpoint_hash&&!vis.has(`${i.previous_outpoint_hash}:${i.previous_outpoint_index||0}`))return{tx:i.previous_outpoint_hash,idx:parseInt(i.previous_outpoint_index)||0};
  // Strategy 4
  const at=await getTxs(a,sig,50);at.sort((x,y)=>(parseInt(x.bt)||0)-(parseInt(y.bt)||0));
  for(const ot of at){const k=`${ot.tid}:${ot.oi}`,ott=parseInt(ot.bt)||0;if(!vis.has(k)&&(ott===0||dt===0||ott<=dt))return{tx:ot.tid,idx:ot.oi};}
  return null;
}

async function trace(txId,oi,sig,ac){
  const all=[],vis=new Set();let ctx=txId,cix=oi,hops=0;
  while(ctx&&hops<200){if(sig.aborted)throw new DOMException('Aborted','AbortError');
    const seg=[],sv=new Set();let btx=ctx,bix=cix,found=false,at=0;
    while(!found&&at<30&&hops<200){if(sig.aborted)throw new DOMException('Aborted','AbortError');at++;hops++;const k=`${btx}:${bix}`;if(sv.has(k)||vis.has(k))break;sv.add(k);vis.add(k);
      const res=await rlf(`${API_BASE}/transactions/${btx}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});if(!res.ok)break;const tx=await res.json();const outs=tx.outputs||[];
      if(bix>=outs.length){seg.unshift({txId:btx,type:'dead_end',amount:0,address:'Invalid',blockTime:tx.block_time,isCoinbase:false,isEx:false});found=true;break;}
      const inp=(tx.inputs||[])[bix];
      if(!inp||!inp.previous_outpoint_hash){const cb=isCB(tx);const a=outs[bix]?.script_public_key_address||'Unknown';const step={txId:btx,type:cb?'coinbase':'dead_end',amount:outs[bix]?.amount||0,address:a,blockTime:tx.block_time,isCoinbase:cb,isEx:isEx(a)};seg.unshift(step);found=true;if(!cb&&a!=='Unknown')step.cont=a;break;}
      const pa=inp.previous_outpoint_address||'Unknown';seg.unshift({txId:btx,type:'spend',amount:inp.previous_outpoint_amount||0,address:pa,blockTime:tx.block_time,isEx:isEx(pa)});btx=inp.previous_outpoint_hash;bix=parseInt(inp.previous_outpoint_index)||0;await sl(30);}
    if(seg.length){if(all.length)all.push({type:'sep'});all.push(...seg);}if(!ac)break;
    const last=seg[0];
    if(last?.cont && !last.isCoinbase && hops<200){
      let nxt=null;
      if(isEx(last.cont)){
        const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
        const tx=await r.json();const inputs=[];
        for(const inp of(tx.inputs||[])){if(!inp.previous_outpoint_hash||vis.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index||0}`))continue;inputs.push({tx:inp.previous_outpoint_hash,idx:parseInt(inp.previous_outpoint_index)||0,addr:inp.previous_outpoint_address||'',isEx:isEx(inp.previous_outpoint_address||'')});}
        inputs.sort((a,b)=>a.isEx?1:-1);
        const ext=inputs.find(i=>!i.isEx);
        if(ext){nxt=ext;all.push({type:'msg',text:'⚡ Fast-path'});}
        else if(inputs.length>0){
          const diff=inputs.find(i=>exN(i.addr)!==exN(last.cont));
          if(diff){nxt=diff;all.push({type:'msg',text:'→ Other exchange'});}
        }
        // If same exchange and no external: STOP (don't try continuation)
      } else {
        // Non-exchange: try continuation
        nxt=await findCont(last,vis,sig);
      }
      if(nxt){ctx=nxt.tx;cix=nxt.idx;}
      else{all.push({type:'msg',text:'🔚 Stopped'});break;}
    }else break;
    await sl(50);
  }
  const steps=all.filter(s=>s.type!=='sep'&&s.type!=='msg');steps.sort((a,b)=>(parseInt(a.blockTime)||0)-(parseInt(b.blockTime)||0));
  return{steps,foundCoinbase:steps.some(s=>s.type==='coinbase'||s.isCoinbase),totalHops:hops};
}

async function traceAddr(addr,sig){const r=await rlf(`${API_BASE}/addresses/${addr}/utxos`,{signal:sig});const u=await r.json();if(!Array.isArray(u)||!u.length)return[];const res=[];for(const x of u.slice(0,3)){if(sig.aborted)break;const t=await trace(x.outpoint?.transactionId||'',x.outpoint?.index||0,sig,true);t.input=addr;res.push(t);await sl(100);}return res;}
function up(m,d,p){document.getElementById('resultPanel').innerHTML=`<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${m}</div><div class="progress-detail">${d||''}</div><div class="progress-bar-container"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;}
function toast(m){const t=document.createElement('div');t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a2535;border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2500);}
function render(res){if(!res.length)return;const r=res[0],s=r.steps||[],ls=s[s.length-1]||{};let h=`<div class="export-bar"><button class="btn-export-sm" onclick="exp()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount}</span></div>`;h+=`<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase?'✅ Origin Found':'⚠️ Partial'}</div></div>`;h+=`<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${s.length}</div><div class="story-stat-label">Steps</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase?'⛏️':'❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${s2k(ls.amount)}</div><div class="story-stat-label">Amount</div></div></div></div>`;h+='<div class="journey-timeline">';s.forEach(st=>{const b=st.type==='coinbase'||st.isCoinbase?'⛏️ Mining':st.isEx?'🏦 Exchange':'💸 Transfer';h+=`<div class="journey-step ${st.type==='coinbase'?'mining':st.isEx?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${st.type==='coinbase'?'badge-mining':st.isEx?'badge-exchange':'badge-personal'}">${b}</span><span class="step-amount">${s2k(st.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${disp(st.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${ft(st.blockTime)}</span></div></div></div></div>`;});h+='</div>';document.getElementById('resultPanel').innerHTML=h;}
function exp(){const d={time:new Date().toISOString(),calls:apiCallCount,traces:multiTraceResults};const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`kas-${Date.now()}.json`;a.click();toast('Exported');}
document.getElementById('btnTrace').addEventListener('click',async()=>{const inp=document.getElementById('mainInput').value.trim();if(!inp)return toast('Enter TX ID or address');apiCallCount=0;document.getElementById('btnTrace').disabled=true;document.getElementById('btnCancel').style.display='inline-block';if(currentAbortController)currentAbortController.abort();currentAbortController=new AbortController();const sig=currentAbortController.signal;up('Tracing...','Kaspa API',10);try{if(/^[a-f0-9]{64}$/.test(inp)){const r=await trace(inp,0,sig,true);r.input=inp;multiTraceResults=[r];render([r]);}else if(/^kaspa:[a-z0-9]{61,63}$/.test(inp)){const r=await traceAddr(inp,sig);if(!r.length)document.getElementById('resultPanel').innerHTML='<p style="color:var(--muted);">No UTXOs.</p>';else{multiTraceResults=r;render(r);}}else document.getElementById('resultPanel').innerHTML='<p style="color:#f87171;">Invalid input.</p>';}catch(e){if(e.name!=='AbortError')document.getElementById('resultPanel').innerHTML=`<p style="color:#f87171;">${e.message}</p>`;}finally{document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';currentAbortController=null;}});
document.getElementById('btnCancel').addEventListener('click',()=>{if(currentAbortController){currentAbortController.abort();currentAbortController=null;}document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';});
