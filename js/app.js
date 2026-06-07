/**
 * Kas Origins v4 - Fixed to match Python backend exactly
 */
const API_BASE = 'https://api.kaspa.org';
let apiCallCount = 0, multiTraceResults = [], currentAbortController = null;

const EXCHANGE_SET = new Set([
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz",
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m",
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m",
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk",
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges",
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle",
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j",
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2",
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n",
  "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r",
]);

const EXCHANGE_NAMES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz":"MEXC",
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m":"Gate.io",
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2":"CoinEx",
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n":"CoinEx",
  "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r":"CoinEx",
};

const isEx = a => EXCHANGE_SET.has(a);
const exName = a => EXCHANGE_NAMES[a] || null;
const disp = a => { const n=exName(a); return n?`🏦 ${n}`:(a?a.substring(0,18)+'...':'Unknown'); };
const s2k = s => { const n=typeof s==='string'?parseInt(s):s; return isNaN(n)?'0':(n/1e8).toFixed(6); };
const ft = ts => ts?new Date(parseInt(ts)).toLocaleString():'?';
const sl = ms => new Promise(r=>setTimeout(r,ms));
const isCB = tx => !tx.inputs||!tx.inputs.length||(tx.inputs.length===1&&!tx.inputs[0].previous_outpoint_hash)||tx.inputs[0]?.previous_outpoint_hash==='0000000000000000000000000000000000000000000000000000000000000000';

let lc=0,cl=0,ws=Date.now(),wc=0;
async function rlf(url,o={},r=0){
  if(o.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const n=Date.now();if(n-ws>1000){ws=n;wc=0;}
  if(wc>=8){const w=1000-(n-ws);if(w>0)await sl(w);ws=Date.now();wc=0;}
  if(n-lc<100)await sl(100-(n-lc));if(cl>0)await sl(Math.min(100*Math.pow(2,cl),5000));
  lc=n;wc++;apiCallCount++;
  try{
    const res=await fetch(url,o);
    if(res.status===429){cl++;if(r<3){await sl(2000*(r+1));return rlf(url,o,r+1);}throw new Error('RL');}
    if(res.status===503){if(r<3){await sl(3000*(r+1));return rlf(url,o,r+1);}throw new Error('Svc');}
    if(cl>0)cl--;return res;
  }catch(e){if(e.name==='AbortError')throw e;if(r<3){await sl(1000*(r+1));return rlf(url,o,r+1);}throw e;}
}

// Match Python's get_address_transactions exactly
async function getAddrTxs(addr, sig, limit=20) {
  const res = await rlf(`${API_BASE}/addresses/${addr}/full-transactions-page?limit=${limit}`, {signal:sig});
  const txs = await res.json();
  if (!Array.isArray(txs)) return [];
  // Filter: only transactions where THIS address appears in outputs with amount > 0
  const results = [];
  for (const tx of txs) {
    if (tx.outputs) {
      for (let oi = 0; oi < tx.outputs.length; oi++) {
        const oa = tx.outputs[oi].script_public_key_address || '';
        if (oa === addr && parseInt(tx.outputs[oi].amount) > 0) {
          results.push({
            transaction_id: tx.transaction_id,
            output_index: oi,
            amount: parseInt(tx.outputs[oi].amount),
            block_time: tx.block_time
          });
          break;
        }
      }
    }
  }
  return results;
}

async function trace(txId, oi, sig, ac) {
  const all=[], vis=new Set();
  let ctx=txId, cix=oi, hops=0, segs=0;

  while(ctx && hops<100 && segs<20) {
    if(sig.aborted)throw new DOMException('Aborted','AbortError');
    segs++;
    const seg=[], sv=new Set();
    let btx=ctx, bix=cix, found=false, at=0;

    while(!found && at<30 && hops<100) {
      if(sig.aborted)throw new DOMException('Aborted','AbortError');
      at++;hops++;
      const k=`${btx}:${bix}`;
      if(sv.has(k)||vis.has(k))break;
      sv.add(k);vis.add(k);

      const res=await rlf(`${API_BASE}/transactions/${btx}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
      if(!res.ok)break;
      const tx=await res.json();
      const outs=tx.outputs||[];

      if(bix>=outs.length){seg.unshift({txId:btx,type:'dead_end',amount:0,address:'Invalid',blockTime:tx.block_time,isCoinbase:false,isEx:false});found=true;break;}

      const inp=(tx.inputs||[])[bix];
      if(!inp||!inp.previous_outpoint_hash){
        const cb=isCB(tx);
        const a=outs[bix]?.script_public_key_address||'Unknown';
        const step={txId:btx,type:cb?'coinbase':'dead_end',amount:outs[bix]?.amount||0,address:a,blockTime:tx.block_time,isCoinbase:cb,isEx:isEx(a)};
        seg.unshift(step);found=true;
        if(!cb&&a!=='Unknown')step.cont=a;
        break;
      }

      const pa=inp.previous_outpoint_address||'Unknown';
      seg.unshift({txId:btx,type:'spend',amount:inp.previous_outpoint_amount||0,address:pa,blockTime:tx.block_time,isEx:isEx(pa)});
      btx=inp.previous_outpoint_hash;bix=parseInt(inp.previous_outpoint_index)||0;
      await sl(30);
    }

    if(seg.length){if(all.length)all.push({type:'sep'});all.push(...seg);}
    if(!ac)break;

    const last=seg[0];
    if(last?.cont && !last.isCoinbase && hops<100){
      const eName=exName(last.cont);
      let nxt=null;

      // Exchange fast-path (matching Python _exchange_fast_path)
      if(eName){
        const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
        const tx=await r.json();
        const inputs=[];
        for(const inp of (tx.inputs||[])){
          const ia=inp.previous_outpoint_address||'';
          const ih=inp.previous_outpoint_hash;
          if(!ih||vis.has(`${ih}:${inp.previous_outpoint_index||0}`))continue;
          inputs.push({tx:ih,idx:parseInt(inp.previous_outpoint_index)||0,addr:ia,isEx:isEx(ia)});
        }
        // Sort: non-exchange first
        inputs.sort((a,b)=>a.isEx?1:-1);
        // Prefer non-exchange
        const ext=inputs.find(i=>!i.isEx);
        if(ext){nxt={tx:ext.tx,idx:ext.idx};all.push({type:'msg',text:`⚡ Fast-path: Skipped ${eName} transfers`});}
        else if(inputs.length>0){
          // Check different exchange
          const diff=inputs.find(i=>{const n=exName(i.addr);return n&&n!==eName;});
          if(diff){nxt={tx:diff.tx,idx:diff.idx};all.push({type:'msg',text:`→ ${exName(diff.addr)||'Other'}`});}
        }
      }

      // Strategy: same address history (matching Python exactly)
      if(!nxt){
        const txs=await getAddrTxs(last.cont, sig, 20);
        const dt=parseInt(last.blockTime)||0;
        for(const ht of txs){
          const k=`${ht.transaction_id}:${ht.output_index}`;
          const htTime=parseInt(ht.block_time)||0;
          if(!vis.has(k)&&(htTime===0||dt===0||htTime<=dt)){
            nxt={tx:ht.transaction_id,idx:ht.output_index};
            all.push({type:'msg',text:'🔗 Same address'});break;
          }
        }
      }

      // Strategy: other outputs (skip exchange)
      if(!nxt){
        const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,{signal:sig});
        const tx=await r.json();
        if(tx.outputs){
          const dt=parseInt(last.blockTime)||0;
          for(let o=0;o<tx.outputs.length&&!nxt;o++){
            const out=tx.outputs[o];
            const oa=out.script_public_key_address||'';
            if(!oa||oa===last.cont||isEx(oa)||parseInt(out.amount)<=0)continue;
            if(vis.has(`${last.txId}:${o}`))continue;
            const btxs=await getAddrTxs(oa, sig, 20);
            for(const bt of btxs){
              const bk=`${bt.transaction_id}:${bt.output_index}`;
              const btTime=parseInt(bt.block_time)||0;
              if(!vis.has(bk)&&(btTime===0||dt===0||btTime<=dt)){
                nxt={tx:bt.transaction_id,idx:bt.output_index};
                all.push({type:'msg',text:'🔀 Other output'});break;
              }
            }
            await sl(20);
          }
        }
      }

      // Strategy: input addresses
      if(!nxt){
        const r=await rlf(`${API_BASE}/transactions/${last.txId}?inputs=true&resolve_previous_outpoints=light`,{signal:sig});
        const tx=await r.json();
        if(tx.inputs){
          for(const inp of tx.inputs){
            if(!nxt&&inp.previous_outpoint_hash&&!vis.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index||0}`)){
              nxt={tx:inp.previous_outpoint_hash,idx:parseInt(inp.previous_outpoint_index)||0};
              all.push({type:'msg',text:'🔗 Input'});break;
            }
          }
        }
      }

      // Deep search
      if(!nxt){
        const txs=await getAddrTxs(last.cont, sig, 50);
        txs.sort((a,b)=>(parseInt(a.block_time)||0)-(parseInt(b.block_time)||0));
        const dt=parseInt(last.blockTime)||0;
        for(const ot of txs){
          const k=`${ot.transaction_id}:${ot.output_index}`;
          const otTime=parseInt(ot.block_time)||0;
          if(!vis.has(k)&&(otTime===0||dt===0||otTime<=dt)){
            nxt={tx:ot.transaction_id,idx:ot.output_index};
            all.push({type:'msg',text:'🔍 Deep search'});break;
          }
        }
      }

      if(nxt){ctx=nxt.tx;cix=nxt.idx;}
      else{all.push({type:'msg',text:'🔚 Exhausted'});break;}
    }else break;
    await sl(50);
  }

  const steps=all.filter(s=>s.type!=='sep'&&s.type!=='msg');
  steps.sort((a,b)=>(parseInt(a.blockTime)||0)-(parseInt(b.blockTime)||0));
  return {steps,foundCoinbase:steps.some(s=>s.type==='coinbase'||s.isCoinbase),totalHops:hops};
}

async function traceAddr(addr,sig){
  const r=await rlf(`${API_BASE}/addresses/${addr}/utxos`,{signal:sig});
  const u=await r.json();
  if(!Array.isArray(u)||!u.length)return[];
  const res=[];
  for(const x of u.slice(0,3)){if(sig.aborted)break;const t=await trace(x.outpoint?.transactionId||'',x.outpoint?.index||0,sig,true);t.input=addr;res.push(t);await sl(100);}
  return res;
}

function up(m,d,p){document.getElementById('resultPanel').innerHTML=`<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${m}</div><div class="progress-detail">${d||''}</div><div class="progress-bar-container"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;}
function toast(m){const t=document.createElement('div');t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a2535;border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2500);}
function render(res){
  if(!res.length)return;
  const r=res[0],s=r.steps||[],ls=s[s.length-1]||{};
  let h=`<div class="export-bar"><button class="btn-export-sm" onclick="exp()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount}</span></div>`;
  h+=`<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase?'✅ Origin Found':'⚠️ Partial'}</div></div>`;
  h+=`<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${s.length}</div><div class="story-stat-label">Steps</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase?'⛏️':'❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${s2k(ls.amount)}</div><div class="story-stat-label">Amount</div></div></div></div>`;
  h+='<div class="journey-timeline">';
  s.forEach(st=>{const b=st.type==='coinbase'||st.isCoinbase?'⛏️ Mining':st.isEx?'🏦 Exchange':'💸 Transfer';h+=`<div class="journey-step ${st.type==='coinbase'?'mining':st.isEx?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${st.type==='coinbase'?'badge-mining':st.isEx?'badge-exchange':'badge-personal'}">${b}</span><span class="step-amount">${s2k(st.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${disp(st.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${ft(st.blockTime)}</span></div></div></div></div>`;});
  h+='</div>';document.getElementById('resultPanel').innerHTML=h;
}
function exp(){const d={time:new Date().toISOString(),calls:apiCallCount,traces:multiTraceResults};const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`kas-${Date.now()}.json`;a.click();toast('Exported');}

document.getElementById('btnTrace').addEventListener('click',async()=>{
  const inp=document.getElementById('mainInput').value.trim();
  if(!inp)return toast('Enter TX ID or address');
  apiCallCount=0;
  document.getElementById('btnTrace').disabled=true;
  document.getElementById('btnCancel').style.display='inline-block';
  if(currentAbortController)currentAbortController.abort();
  currentAbortController=new AbortController();const sig=currentAbortController.signal;
  up('Tracing...','Kaspa API',10);
  try{
    if(/^[a-f0-9]{64}$/.test(inp)){const r=await trace(inp,0,sig,true);r.input=inp;multiTraceResults=[r];render([r]);}
    else if(/^kaspa:[a-z0-9]{61,63}$/.test(inp)){const r=await traceAddr(inp,sig);if(!r.length)document.getElementById('resultPanel').innerHTML='<p style="color:var(--muted);">No UTXOs.</p>';else{multiTraceResults=r;render(r);}}
    else document.getElementById('resultPanel').innerHTML='<p style="color:#f87171;">Invalid input.</p>';
  }catch(e){if(e.name!=='AbortError')document.getElementById('resultPanel').innerHTML=`<p style="color:#f87171;">${e.message}</p>`;}
  finally{document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';currentAbortController=null;}
});
document.getElementById('btnCancel').addEventListener('click',()=>{if(currentAbortController){currentAbortController.abort();currentAbortController=null;}document.getElementById('btnTrace').disabled=false;document.getElementById('btnCancel').style.display='none';});
