/**
 * Kas Origins - Standalone Frontend v2
 * Direct Kaspa API calls with working exchange fast-path
 */

const API_BASE = 'https://api.kaspa.org';
let apiCallCount = 0;
let multiTraceResults = [];
let currentAbortController = null;

const KNOWN_ADDRESSES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": { name: "MEXC", type: "exchange" },
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": { name: "Gate.io", type: "exchange" },
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m": { name: "KuCoin 1", type: "exchange" },
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk": { name: "KuCoin 2", type: "exchange" },
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges": { name: "Bybit", type: "exchange" },
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle": { name: "Kraken", type: "exchange" },
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j": { name: "Bitget", type: "exchange" },
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": { name: "CoinEx", type: "exchange" },
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n": { name: "CoinEx Hot Wallet", type: "exchange" },
  "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r": { name: "CoinEx Cluster", type: "exchange" },
};

function lookupKnownAddress(a) { return KNOWN_ADDRESSES[a] || null; }
function resolveAddressDisplay(a) { const k = lookupKnownAddress(a); return k ? `🏦 ${k.name}` : (a ? a.substring(0,18)+'...' : 'Unknown'); }
function isExchangeAddress(a) { return lookupKnownAddress(a)?.type === 'exchange'; }
function sompiToKAS(s) { const n = typeof s === 'string' ? parseInt(s) : s; return isNaN(n) ? '0' : (n / 1e8).toFixed(6); }
function formatTime(ts) { if (!ts) return '?'; return new Date(parseInt(ts)).toLocaleString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isCoinbaseTransaction(tx) {
  if (!tx.inputs || tx.inputs.length === 0) return true;
  if (tx.inputs.length === 1 && !tx.inputs[0].previous_outpoint_hash && !tx.inputs[0].signature_script) return true;
  if (tx.inputs[0]?.previous_outpoint_hash === '0000000000000000000000000000000000000000000000000000000000000000') return true;
  return false;
}

// Rate limiter
let lastCall = 0, consLimits = 0, winStart = Date.now(), winCalls = 0;
async function rateLimitedFetch(url, opts = {}, retry = 0) {
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const now = Date.now();
  if (now - winStart > 1000) { winStart = now; winCalls = 0; }
  if (winCalls >= 8) { const w = 1000 - (now - winStart); if (w > 0) await sleep(w); winStart = Date.now(); winCalls = 0; }
  if (now - lastCall < 100) await sleep(100 - (now - lastCall));
  if (consLimits > 0) await sleep(Math.min(100 * Math.pow(2, consLimits), 5000));
  lastCall = Date.now(); winCalls++; apiCallCount++;
  try {
    const r = await fetch(url, opts);
    if (r.status === 429) { consLimits++; if (retry < 3) { await sleep(2000*(retry+1)); return rateLimitedFetch(url, opts, retry+1); } throw new Error('Rate limited'); }
    if (r.status === 503) { if (retry < 3) { await sleep(3000*(retry+1)); return rateLimitedFetch(url, opts, retry+1); } throw new Error('Service unavailable'); }
    if (consLimits > 0) consLimits--;
    return r;
  } catch(e) { if (e.name === 'AbortError') throw e; if (retry < 3) { await sleep(1000*(retry+1)); return rateLimitedFetch(url, opts, retry+1); } throw e; }
}

async function traceLifecycle(txId, outputIndex, signal, autoContinue) {
  const all = [], visited = new Set();
  let curTx = txId, curIdx = outputIndex, hops = 0, segNum = 0, fastSaved = 0;

  while (curTx && hops < 100) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    segNum++;
    const seg = [], segVis = new Set();
    let backTx = curTx, backIdx = curIdx, found = false, att = 0;

    while (!found && att < 30 && hops < 100) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      att++; hops++;
      const key = `${backTx}:${backIdx}`;
      if (segVis.has(key) || visited.has(key)) break;
      segVis.add(key); visited.add(key);

      const res = await rateLimitedFetch(`${API_BASE}/transactions/${backTx}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
      if (!res.ok) break;
      const tx = await res.json();
      const outs = tx.outputs || [];

      if (backIdx >= outs.length) {
        seg.unshift({ txId: backTx, type: 'dead_end', amount: 0, address: 'Invalid', blockTime: tx.block_time, blockHash: (tx.block_hash||[])[0]||null, isCoinbase: false, isExchangeAddress: false });
        found = true; break;
      }

      const inp = (tx.inputs||[])[backIdx];

      if (!inp || !inp.previous_outpoint_hash) {
        const isCB = isCoinbaseTransaction(tx);
        const addr = outs[backIdx]?.script_public_key_address || 'Unknown';
        const step = { txId: backTx, type: isCB?'coinbase':'dead_end', amount: outs[backIdx]?.amount||0, address: addr, blockTime: tx.block_time, blockHash: (tx.block_hash||[])[0]||null, isCoinbase: isCB, isExchangeAddress: isExchangeAddress(addr) };
        seg.unshift(step);
        found = true;
        if (!isCB && addr !== 'Unknown') step.continueAddress = addr;
        break;
      }

      const pAddr = inp.previous_outpoint_address || 'Unknown';
      seg.unshift({ txId: backTx, type: 'spend', amount: inp.previous_outpoint_amount||0, address: pAddr, blockTime: tx.block_time, blockHash: (tx.block_hash||[])[0]||null, isExchangeAddress: isExchangeAddress(pAddr) });
      backTx = inp.previous_outpoint_hash;
      backIdx = parseInt(inp.previous_outpoint_index) || 0;
      await sleep(30);
    }

    if (seg.length) {
      if (all.length) all.push({ type: 'separator' });
      all.push(...seg);
    }

    if (!autoContinue) break;

    const last = seg[0];
    if (last?.continueAddress && !last.isCoinbase && hops < 100) {
      const exchInfo = lookupKnownAddress(last.continueAddress);
      let next = null;

      // === EXCHANGE FAST-PATH ===
      if (exchInfo?.type === 'exchange') {
        const r = await rateLimitedFetch(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
        const tx = await r.json();
        const inputs = (tx.inputs||[]).filter(i => i.previous_outpoint_hash && !visited.has(`${i.previous_outpoint_hash}:${i.previous_outpoint_index||0}`));
        
        // Separate external (non-exchange) from internal (same exchange)
        const external = inputs.filter(i => !isExchangeAddress(i.previous_outpoint_address||''));
        
        if (external.length > 0) {
          next = { tx: external[0].previous_outpoint_hash, idx: parseInt(external[0].previous_outpoint_index)||0, saved: 10 };
          all.push({ type: 'message', text: `⚡ Fast-path: Skipped ${exchInfo.name} internal transfers` });
        } else if (inputs.length > 0) {
          // All inputs are exchange addresses - check if different exchange
          const firstInputAddr = inputs[0].previous_outpoint_address || '';
          const firstInfo = lookupKnownAddress(firstInputAddr);
          if (firstInfo && firstInfo.name !== exchInfo.name) {
            // Different exchange - follow it
            next = { tx: inputs[0].previous_outpoint_hash, idx: parseInt(inputs[0].previous_outpoint_index)||0, saved: 0 };
            all.push({ type: 'message', text: `→ Different exchange: ${firstInfo.name}` });
          }
          // If same exchange, DON'T follow (next stays null = stops here)
        }
      }

      // === STRATEGY: Same address history ===
      if (!next) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/addresses/${last.continueAddress}/full-transactions-page?limit=20`, { signal });
          const txs = await r.json();
          if (Array.isArray(txs)) {
            const dTime = parseInt(last.blockTime)||0;
            for (const ht of txs) {
              if (ht.outputs && !next) {
                for (let oi = 0; oi < ht.outputs.length; oi++) {
                  const o = ht.outputs[oi];
                  const oa = o.script_public_key_address || '';
                  const k = `${ht.transaction_id}:${oi}`;
                  const htTime = parseInt(ht.block_time)||0;
                  if (oa === last.continueAddress && parseInt(o.amount) > 0 && !visited.has(k) && (htTime===0 || dTime===0 || htTime <= dTime)) {
                    next = { tx: ht.transaction_id, idx: oi, saved: 0 };
                    all.push({ type: 'message', text: '🔗 Same address' });
                    break;
                  }
                }
              }
            }
          }
        } catch(e) {}
      }

      // === STRATEGY: Other outputs ===
      if (!next) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/transactions/${last.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await r.json();
          if (tx.outputs) {
            const dTime = parseInt(last.blockTime)||0;
            for (let oi = 0; oi < tx.outputs.length && !next; oi++) {
              const out = tx.outputs[oi];
              const oa = out.script_public_key_address || '';
              if (!oa || oa === last.continueAddress || isExchangeAddress(oa) || parseInt(out.amount) <= 0) continue;
              const k = `${last.txId}:${oi}`;
              if (visited.has(k)) continue;
              
              const br = await rateLimitedFetch(`${API_BASE}/addresses/${oa}/full-transactions-page?limit=20`, { signal });
              const btxs = await br.json();
              if (Array.isArray(btxs)) {
                for (const bt of btxs) {
                  if (bt.outputs && !next) {
                    for (let bi = 0; bi < bt.outputs.length; bi++) {
                      const ba = bt.outputs[bi].script_public_key_address || '';
                      const bk = `${bt.transaction_id}:${bi}`;
                      const bTime = parseInt(bt.block_time)||0;
                      if (ba === oa && parseInt(bt.outputs[bi].amount) > 0 && !visited.has(bk) && (bTime===0 || dTime===0 || bTime <= dTime)) {
                        next = { tx: bt.transaction_id, idx: bi, saved: 0 };
                        all.push({ type: 'message', text: '🔀 Other output' });
                        break;
                      }
                    }
                  }
                }
              }
              await sleep(20);
            }
          }
        } catch(e) {}
      }

      // === STRATEGY: Input addresses ===
      if (!next) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/transactions/${last.txId}?inputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await r.json();
          if (tx.inputs) {
            for (const inp of tx.inputs) {
              if (!next && inp.previous_outpoint_hash && !visited.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index||0}`)) {
                next = { tx: inp.previous_outpoint_hash, idx: parseInt(inp.previous_outpoint_index)||0, saved: 0 };
                all.push({ type: 'message', text: '🔗 Input address' });
                break;
              }
            }
          }
        } catch(e) {}
      }

      if (next) {
        curTx = next.tx;
        curIdx = next.idx;
        fastSaved += next.saved || 0;
      } else {
        all.push({ type: 'message', text: '🔚 All strategies exhausted' });
        break;
      }
    } else { break; }
    await sleep(50);
  }

  const steps = all.filter(s => s.type !== 'separator' && s.type !== 'message');
  steps.sort((a, b) => (parseInt(a.blockTime)||0) - (parseInt(b.blockTime)||0));
  return { steps, allLifecycle: all, foundCoinbase: steps.some(s => s.type==='coinbase'||s.isCoinbase), totalHops: hops, uniqueAddresses: new Set(steps.map(s=>s.address)).size, fastPathHopsSaved: fastSaved, usedFastPath: fastSaved > 0 };
}

async function traceFromAddress(address, signal) {
  const r = await rateLimitedFetch(`${API_BASE}/addresses/${address}/utxos`, { signal });
  const utxos = await r.json();
  if (!Array.isArray(utxos) || !utxos.length) return [];
  const results = [];
  for (const u of utxos.slice(0, 3)) {
    if (signal.aborted) break;
    const tr = await traceLifecycle(u.outpoint?.transactionId||'', u.outpoint?.index||0, signal, true);
    tr.input = `${address} (UTXO)`; results.push(tr);
    await sleep(100);
  }
  return results;
}

// UI
function updateProgress(msg, detail, pct) {
  document.getElementById('resultPanel').innerHTML = `<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${msg}</div><div class="progress-detail">${detail||''}</div><div class="progress-bar-container"><div class="progress-bar" style="width:${pct}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a2535;border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';
  t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}

function renderResults(results) {
  if (!results.length) return;
  const r = results[0], steps = r.steps||[], ls = steps[steps.length-1]||{};
  let html = `<div class="export-bar"><button class="btn-export-sm" onclick="exportJSON()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount} calls</span></div>`;
  html += `<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase ? '✅ Origin Found' : '⚠️ Partial'}</div></div>`;
  html += `<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${steps.length}</div><div class="story-stat-label">Steps</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase?'⛏️':'❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${sompiToKAS(ls.amount)}</div><div class="story-stat-label">Amount</div></div>${r.usedFastPath?'<div class="story-stat"><div class="story-stat-value">⚡</div><div class="story-stat-label">Fast-Path</div></div>':''}</div></div>`;
  html += '<div class="journey-timeline">';
  steps.forEach(s => {
    const badge = s.type==='coinbase'||s.isCoinbase ? '⛏️ Mining' : s.isExchangeAddress ? '🏦 Exchange' : '💸 Transfer';
    html += `<div class="journey-step ${s.type==='coinbase'?'mining':s.isExchangeAddress?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${s.type==='coinbase'?'badge-mining':s.isExchangeAddress?'badge-exchange':'badge-personal'}">${badge}</span><span class="step-amount">${sompiToKAS(s.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${resolveAddressDisplay(s.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${formatTime(s.blockTime)}</span></div></div></div></div>`;
  });
  html += '</div>';
  document.getElementById('resultPanel').innerHTML = html;
}

function exportJSON() {
  const d = { export_time: new Date().toISOString(), api_calls: apiCallCount, traces: multiTraceResults };
  const b = new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`kas-origins-${Date.now()}.json`; a.click();
  showToast('JSON exported');
}

document.getElementById('btnTrace').addEventListener('click', async () => {
  const input = document.getElementById('mainInput').value.trim();
  if (!input) return showToast('Enter a TX ID or address');
  apiCallCount = 0;
  document.getElementById('btnTrace').disabled = true;
  document.getElementById('btnCancel').style.display = 'inline-block';
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const sig = currentAbortController.signal;
  updateProgress('Tracing...', 'Kaspa API', 10);
  try {
    if (/^[a-f0-9]{64}$/.test(input)) {
      const r = await traceLifecycle(input, 0, sig, true);
      r.input = input; multiTraceResults = [r]; renderResults([r]);
    } else if (/^kaspa:[a-z0-9]{61,63}$/.test(input)) {
      const results = await traceFromAddress(input, sig);
      if (!results.length) document.getElementById('resultPanel').innerHTML = '<p style="color:var(--muted);">No UTXOs found.</p>';
      else { multiTraceResults = results; renderResults(results); }
    } else {
      document.getElementById('resultPanel').innerHTML = '<p style="color:#f87171;">Invalid input.</p>';
    }
  } catch(e) {
    if (e.name !== 'AbortError') document.getElementById('resultPanel').innerHTML = `<p style="color:#f87171;">Error: ${e.message}</p>`;
  } finally {
    document.getElementById('btnTrace').disabled = false;
    document.getElementById('btnCancel').style.display = 'none';
    currentAbortController = null;
  }
});

document.getElementById('btnCancel').addEventListener('click', () => {
  if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
  document.getElementById('btnTrace').disabled = false;
  document.getElementById('btnCancel').style.display = 'none';
});
