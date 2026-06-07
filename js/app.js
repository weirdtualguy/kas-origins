/**
 * Kas Origins - Standalone Frontend
 * Direct Kaspa API calls (works on GitHub Pages)
 */

const API_BASE = 'https://api.kaspa.org';
let apiCallCount = 0;
let multiTraceResults = [];
let currentAbortController = null;

// ========== KNOWN ADDRESSES ==========

const KNOWN_ADDRESSES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": { name: "MEXC", type: "exchange" },
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": { name: "Gate.io", type: "exchange" },
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m": { name: "KuCoin 1", type: "exchange" },
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk": { name: "KuCoin 2", type: "exchange" },
  "kaspa:qpq94ntnvy8p9q6wrdwtn37xtspgashrydc0kuu8ctpyxulmh0wlxh2807zdh": { name: "KuCoin 3", type: "exchange" },
  "kaspa:qq3k4du6wf2g26j7ds6fqmgtgavgm3zy676wntp2e52nsuns2n4s6xkndmx0y": { name: "KuCoin 4", type: "exchange" },
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges": { name: "Bybit", type: "exchange" },
  "kaspa:qzxrs8gxjgk2q84wlt3xfd057ntws73fptalhy84g85zqfu5lcemvpu04vj3w": { name: "Uphold 1", type: "exchange" },
  "kaspa:qr7vrlhgekw9efxgfq09ca3wqcxlslgxndcpk77pguu2usaa9aa27lhuunewj": { name: "Uphold 2", type: "exchange" },
  "kaspa:qqfxn597v5c23td4asz99ky52sha8l2ypq8kmrsqxcu7skhdunncjgup0hdys": { name: "Bitvavo 1", type: "exchange" },
  "kaspa:qzxs23g7txh3wq9d0t2z0hluhsflvzpf6d0yfum830ppumgtxa5d7zqca8r67": { name: "Bitvavo 2", type: "exchange" },
  "kaspa:qz4kt3t0qzpmpcgle28mgudu6lpu0fel6rgn0y2p808l8em7gd2exnss8cr2t": { name: "Bitvavo 3", type: "exchange" },
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle": { name: "Kraken", type: "exchange" },
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j": { name: "Bitget", type: "exchange" },
  "kaspa:qyp90geyzyp56p4zqd87flxrwd64r557r2cwkuwxzuq9zxehmswcg8g54jmeu7p": { name: "PionexUS", type: "exchange" },
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": { name: "CoinEx", type: "exchange" },
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n": { name: "CoinEx Hot Wallet", type: "exchange" },
};

function lookupKnownAddress(address) {
  if (!address) return null;
  return KNOWN_ADDRESSES[address] || null;
}

function resolveAddressDisplay(address) {
  const known = lookupKnownAddress(address);
  if (known) return `🏦 ${known.name}`;
  return address ? `${address.substring(0, 18)}...` : 'Unknown';
}

function isExchangeAddress(address) {
  return lookupKnownAddress(address)?.type === 'exchange';
}

// ========== UTILS ==========

function sompiToKAS(s) { const n = typeof s === 'string' ? parseInt(s) : s; return isNaN(n) ? '0' : (n / 1e8).toFixed(6); }
function formatTime(ts) { if (!ts) return '?'; return new Date(parseInt(ts)).toLocaleString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== RATE LIMITER ==========

let lastApiCallTime = 0, consecutiveRateLimits = 0, windowStart = Date.now(), callsInWindow = 0;

async function rateLimitedFetch(url, options = {}, retryCount = 0) {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const now = Date.now();
  if (now - windowStart > 1000) { windowStart = now; callsInWindow = 0; }
  if (callsInWindow >= 8) { const w = 1000 - (now - windowStart); if (w > 0) await sleep(w); windowStart = Date.now(); callsInWindow = 0; }
  const since = now - lastApiCallTime;
  if (since < 100) await sleep(100 - since);
  if (consecutiveRateLimits > 0) await sleep(Math.min(100 * Math.pow(2, consecutiveRateLimits), 5000));
  lastApiCallTime = Date.now(); callsInWindow++; apiCallCount++;
  try {
    const r = await fetch(url, options);
    if (r.status === 429) { consecutiveRateLimits++; if (retryCount < 3) { await sleep(2000*(retryCount+1)); return rateLimitedFetch(url, options, retryCount+1); } throw new Error('Rate limited'); }
    if (r.status === 503) { if (retryCount < 3) { await sleep(3000*(retryCount+1)); return rateLimitedFetch(url, options, retryCount+1); } throw new Error('Service unavailable'); }
    if (consecutiveRateLimits > 0) consecutiveRateLimits--;
    return r;
  } catch(e) { if (e.name === 'AbortError') throw e; if (retryCount < 3) { await sleep(1000*(retryCount+1)); return rateLimitedFetch(url, options, retryCount+1); } throw e; }
}

function isCoinbaseTransaction(tx) {
  if (!tx.inputs || tx.inputs.length === 0) return true;
  if (tx.inputs.length === 1 && !tx.inputs[0].previous_outpoint_hash && !tx.inputs[0].signature_script) return true;
  if (tx.inputs[0]?.previous_outpoint_hash === '0000000000000000000000000000000000000000000000000000000000000000') return true;
  return false;
}

// ========== CORE TRACE LOGIC ==========

async function traceLifecycle(txId, outputIndex, signal, autoContinue) {
  const allLifecycle = [];
  const globalVisited = new Set();
  let currentTxId = txId, currentIndex = outputIndex, totalHops = 0, segmentNumber = 0;
  let fastPathHopsSaved = 0;

  while (currentTxId && totalHops < 100) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    segmentNumber++;
    const segmentLifecycle = [], segmentVisited = new Set();
    let backwardTxId = currentTxId, backwardIndex = currentIndex, originFound = false, attempts = 0;

    while (!originFound && attempts < 30 && totalHops < 100) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      attempts++; totalHops++;
      const key = `${backwardTxId}:${backwardIndex}`;
      if (segmentVisited.has(key) || globalVisited.has(key)) break;
      segmentVisited.add(key); globalVisited.add(key);

      const res = await rateLimitedFetch(`${API_BASE}/transactions/${backwardTxId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
      if (!res.ok) break;
      const tx = await res.json();
      const outputs = tx.outputs || [];

      if (backwardIndex >= outputs.length) {
        segmentLifecycle.unshift({ txId: backwardTxId, type: 'dead_end', amount: 0, address: 'Invalid', blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isCoinbase: false, isExchangeAddress: false });
        originFound = true; break;
      }

      const input = tx.inputs?.[backwardIndex];

      if (!input || !input.previous_outpoint_hash) {
        const isCoinbase = isCoinbaseTransaction(tx);
        const outAddr = outputs[backwardIndex]?.script_public_key_address || 'Unknown';
        const step = { txId: backwardTxId, type: isCoinbase ? 'coinbase' : 'dead_end', amount: outputs[backwardIndex]?.amount || 0, address: outAddr, blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isCoinbase, isExchangeAddress: isExchangeAddress(outAddr) };
        segmentLifecycle.unshift(step);
        originFound = true;
        if (!isCoinbase && outAddr !== 'Unknown') step.continueAddress = outAddr;
        break;
      }

      const prevAddr = input.previous_outpoint_address || 'Unknown';
      segmentLifecycle.unshift({ txId: backwardTxId, type: 'spend', amount: input.previous_outpoint_amount || 0, address: prevAddr, blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isExchangeAddress: isExchangeAddress(prevAddr) });
      backwardTxId = input.previous_outpoint_hash;
      backwardIndex = parseInt(input.previous_outpoint_index) || 0;
      await sleep(30);
    }

    if (segmentLifecycle.length > 0) {
      if (allLifecycle.length > 0) allLifecycle.push({ type: 'separator' });
      allLifecycle.push(...segmentLifecycle);
    }

    if (!autoContinue) break;

    const lastStep = segmentLifecycle[0];
    if (lastStep?.continueAddress && !lastStep.isCoinbase && totalHops < 100) {
      const exchangeInfo = lookupKnownAddress(lastStep.continueAddress);
      let foundNext = false;

      // Exchange fast-path: skip internal transfers
      if (exchangeInfo?.type === 'exchange') {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await r.json();
          const inputs = (tx.inputs || []).filter(inp => inp.previous_outpoint_hash);
          // Prefer non-exchange inputs
          const external = inputs.filter(inp => !isExchangeAddress(inp.previous_outpoint_address || ''));
          const chosen = external.length > 0 ? external : inputs;
          if (chosen.length > 0) {
            currentTxId = chosen[0].previous_outpoint_hash;
            currentIndex = parseInt(chosen[0].previous_outpoint_index) || 0;
            foundNext = true;
            fastPathHopsSaved += external.length > 0 ? 10 : 0;
            allLifecycle.push({ type: 'message', text: `⚡ Fast-path: Skipped ${exchangeInfo.name} internal transfers` });
          }
        } catch(e) {}
      }

      // Same address history
      if (!foundNext) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/addresses/${lastStep.continueAddress}/full-transactions-page?limit=20`, { signal });
          const txs = await r.json();
          if (Array.isArray(txs)) {
            const deadTime = parseInt(lastStep.blockTime) || 0;
            for (const ht of txs) {
              if (ht.outputs && !foundNext) {
                for (let oi = 0; oi < ht.outputs.length; oi++) {
                  const out = ht.outputs[oi];
                  const outAddr = out.script_public_key_address || '';
                  const key = `${ht.transaction_id}:${oi}`;
                  const htTime = parseInt(ht.block_time) || 0;
                  if (outAddr === lastStep.continueAddress && parseInt(out.amount) > 0 && !globalVisited.has(key) && (htTime === 0 || deadTime === 0 || htTime <= deadTime)) {
                    currentTxId = ht.transaction_id; currentIndex = oi; foundNext = true;
                    allLifecycle.push({ type: 'message', text: '🔗 Continued via same address' });
                    break;
                  }
                }
              }
            }
          }
        } catch(e) {}
      }

      // Other outputs
      if (!foundNext) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await r.json();
          if (tx.outputs) {
            const outputs = [...tx.outputs].sort((a, b) => (isExchangeAddress(a.script_public_key_address || '') ? 1 : 0) - (isExchangeAddress(b.script_public_key_address || '') ? 1 : 0));
            for (let oi = 0; oi < outputs.length && !foundNext; oi++) {
              const outAddr = outputs[oi].script_public_key_address || '';
              if (!outAddr || outAddr === lastStep.continueAddress || isExchangeAddress(outAddr) || parseInt(outputs[oi].amount) <= 0) continue;
              const key = `${lastStep.txId}:${oi}`;
              if (globalVisited.has(key)) continue;
              const br = await rateLimitedFetch(`${API_BASE}/addresses/${outAddr}/full-transactions-page?limit=20`, { signal });
              const branchTxs = await br.json();
              if (Array.isArray(branchTxs)) {
                const deadTime = parseInt(lastStep.blockTime) || 0;
                for (const bt of branchTxs) {
                  if (bt.outputs && !foundNext) {
                    for (let bi = 0; bi < bt.outputs.length; bi++) {
                      const bAddr = bt.outputs[bi].script_public_key_address || '';
                      const bKey = `${bt.transaction_id}:${bi}`;
                      const bTime = parseInt(bt.block_time) || 0;
                      if (bAddr === outAddr && parseInt(bt.outputs[bi].amount) > 0 && !globalVisited.has(bKey) && (bTime === 0 || deadTime === 0 || bTime <= deadTime)) {
                        currentTxId = bt.transaction_id; currentIndex = bi; foundNext = true;
                        allLifecycle.push({ type: 'message', text: '🔀 Switched to non-exchange branch' });
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

      // Input addresses
      if (!foundNext) {
        try {
          const r = await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await r.json();
          if (tx.inputs) {
            const inputs = [...tx.inputs].sort((a, b) => (isExchangeAddress(a.previous_outpoint_address || '') ? 1 : 0) - (isExchangeAddress(b.previous_outpoint_address || '') ? 1 : 0));
            for (const inp of inputs) {
              if (inp.previous_outpoint_hash && !globalVisited.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index}`)) {
                currentTxId = inp.previous_outpoint_hash; currentIndex = parseInt(inp.previous_outpoint_index) || 0; foundNext = true;
                allLifecycle.push({ type: 'message', text: '🔗 Traced through input address' });
                break;
              }
            }
          }
        } catch(e) {}
      }

      if (!foundNext) { allLifecycle.push({ type: 'message', text: '🔚 All strategies exhausted' }); break; }
    } else { break; }
    await sleep(50);
  }

  const realSteps = allLifecycle.filter(s => s.type !== 'separator' && s.type !== 'message');
  realSteps.sort((a, b) => (parseInt(a.blockTime) || 0) - (parseInt(b.blockTime) || 0));

  return { steps: realSteps, allLifecycle, foundCoinbase: realSteps.some(s => s.type === 'coinbase' || s.isCoinbase), totalHops, uniqueAddresses: new Set(realSteps.map(s => s.address)).size, fastPathHopsSaved, usedFastPath: fastPathHopsSaved > 0 };
}

async function traceFromAddress(address, signal) {
  const r = await rateLimitedFetch(`${API_BASE}/addresses/${address}/utxos`, { signal });
  const utxos = await r.json();
  if (!Array.isArray(utxos) || utxos.length === 0) return [];
  const selected = utxos.slice(0, 3);
  multiTraceResults = [];
  for (const utxo of selected) {
    if (signal.aborted) break;
    const r = await traceLifecycle(utxo.outpoint?.transactionId || '', utxo.outpoint?.index || 0, signal, true);
    r.input = `${address} (UTXO)`; multiTraceResults.push(r);
    await sleep(100);
  }
  return multiTraceResults;
}

// ========== UI ==========

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
  const r = results[0], steps = r.steps || [];
  const lastStep = steps[steps.length-1] || {};
  
  let html = `<div class="export-bar"><button class="btn-export-sm" onclick="exportJSON()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount} calls</span></div>`;
  
  html += `<div class="coin-story"><div class="story-header"><span class="story-title">🧬 Coin Story</span><div class="confidence-badge">${r.foundCoinbase ? '✅ Origin Found' : '⚠️ Partial'}</div></div>`;
  html += `<div class="story-stats"><div class="story-stat"><div class="story-stat-value">${steps.length}</div><div class="story-stat-label">Transfers</div></div><div class="story-stat"><div class="story-stat-value">${r.foundCoinbase ? '⛏️' : '❌'}</div><div class="story-stat-label">Coinbase</div></div><div class="story-stat"><div class="story-stat-value">${sompiToKAS(lastStep.amount)}</div><div class="story-stat-label">Amount</div></div>${r.usedFastPath ? '<div class="story-stat"><div class="story-stat-value">⚡</div><div class="story-stat-label">Fast-Path</div></div>' : ''}</div></div>`;
  
  html += '<div class="journey-timeline">';
  steps.forEach((s, i) => {
    const badge = s.type === 'coinbase' || s.isCoinbase ? '⛏️ Mining' : s.isExchangeAddress ? '🏦 Exchange' : '💸 Transfer';
    html += `<div class="journey-step ${s.type==='coinbase'?'mining':s.isExchangeAddress?'exchange':'personal'}"><div class="step-card"><div class="step-card-header"><span class="step-type-badge ${s.type==='coinbase'?'badge-mining':s.isExchangeAddress?'badge-exchange':'badge-personal'}">${badge}</span><span class="step-amount">${sompiToKAS(s.amount)} KAS</span></div><div class="step-details"><div class="step-detail-row"><span class="step-detail-label">Address</span><span class="step-detail-value">${resolveAddressDisplay(s.address)}</span></div><div class="step-detail-row"><span class="step-detail-label">Time</span><span class="step-detail-value">${formatTime(s.blockTime)}</span></div></div></div></div>`;
  });
  html += '</div>';
  
  document.getElementById('resultPanel').innerHTML = html;
}

function exportJSON() {
  const data = { export_time: new Date().toISOString(), api_calls: apiCallCount, traces: multiTraceResults };
  const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `kas-origins-${Date.now()}.json`; a.click();
  showToast('JSON exported');
}

// ========== MAIN ==========

document.getElementById('btnTrace').addEventListener('click', async () => {
  const input = document.getElementById('mainInput').value.trim();
  if (!input) return showToast('Enter a TX ID or address');
  
  apiCallCount = 0;
  document.getElementById('btnTrace').disabled = true;
  document.getElementById('btnCancel').style.display = 'inline-block';
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  
  updateProgress('Tracing...', 'Connecting to Kaspa API', 10);
  
  try {
    if (/^[a-f0-9]{64}$/.test(input)) {
      const r = await traceLifecycle(input, 0, signal, true);
      r.input = input; r.inputType = 'txid';
      multiTraceResults = [r];
      renderResults([r]);
    } else if (/^kaspa:[a-z0-9]{61,63}$/.test(input)) {
      const results = await traceFromAddress(input, signal);
      if (results.length === 0) {
        document.getElementById('resultPanel').innerHTML = '<p style="color:var(--muted);">No UTXOs found.</p>';
      } else {
        renderResults(results);
      }
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
