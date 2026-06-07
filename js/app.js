/**
 * Kas Origins - Frontend Application
 * Works standalone (direct API calls) or with Python backend
 */

// Auto-detect: use Python backend if on localhost, otherwise call API directly
const IS_LOCALHOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = 'https://api.kaspa.org';
const BACKEND_URL = IS_LOCALHOST ? '' : null;

let apiCallCount = 0;
let multiTraceResults = [];
let activeTraceIndex = 0;
let expandedSteps = new Set();
let currentAbortController = null;

// ========== KNOWN ADDRESSES ==========

const KNOWN_ADDRESSES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": { name: "MEXC", type: "exchange", category: "cex" },
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": { name: "Gate.io", type: "exchange", category: "cex" },
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m": { name: "KuCoin 1", type: "exchange", category: "cex" },
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk": { name: "KuCoin 2", type: "exchange", category: "cex" },
  "kaspa:qpq94ntnvy8p9q6wrdwtn37xtspgashrydc0kuu8ctpyxulmh0wlxh2807zdh": { name: "KuCoin 3", type: "exchange", category: "cex" },
  "kaspa:qq3k4du6wf2g26j7ds6fqmgtgavgm3zy676wntp2e52nsuns2n4s6xkndmx0y": { name: "KuCoin 4", type: "exchange", category: "cex" },
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges": { name: "Bybit", type: "exchange", category: "cex" },
  "kaspa:qzxrs8gxjgk2q84wlt3xfd057ntws73fptalhy84g85zqfu5lcemvpu04vj3w": { name: "Uphold 1", type: "exchange", category: "cex" },
  "kaspa:qr7vrlhgekw9efxgfq09ca3wqcxlslgxndcpk77pguu2usaa9aa27lhuunewj": { name: "Uphold 2", type: "exchange", category: "cex" },
  "kaspa:qqfxn597v5c23td4asz99ky52sha8l2ypq8kmrsqxcu7skhdunncjgup0hdys": { name: "Bitvavo 1", type: "exchange", category: "cex" },
  "kaspa:qzxs23g7txh3wq9d0t2z0hluhsflvzpf6d0yfum830ppumgtxa5d7zqca8r67": { name: "Bitvavo 2", type: "exchange", category: "cex" },
  "kaspa:qz4kt3t0qzpmpcgle28mgudu6lpu0fel6rgn0y2p808l8em7gd2exnss8cr2t": { name: "Bitvavo 3", type: "exchange", category: "cex" },
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle": { name: "Kraken", type: "exchange", category: "cex" },
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j": { name: "Bitget", type: "exchange", category: "cex" },
  "kaspa:qyp90geyzyp56p4zqd87flxrwd64r557r2cwkuwxzuq9zxehmswcg8g54jmeu7p": { name: "PionexUS", type: "exchange", category: "cex" },
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": { name: "CoinEx", type: "exchange", category: "cex" },
  "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n": { name: "CoinEx Hot Wallet", type: "exchange", category: "cex" },
};

function lookupKnownAddress(address) {
  if (!address) return null;
  return KNOWN_ADDRESSES[address] || null;
}

function resolveAddressDisplay(address) {
  const known = lookupKnownAddress(address);
  if (known) return `${known.type === 'exchange' ? '🏦' : '📋'} ${known.name}`;
  return address ? `${address.substring(0, 18)}...` : 'Unknown';
}

function isExchangeAddress(address) {
  const info = lookupKnownAddress(address);
  return info?.type === 'exchange';
}

// ========== UTILS ==========

function sompiToKAS(s) { const n = typeof s === 'string' ? parseInt(s) : s; return isNaN(n) ? '0' : (n / 1e8).toFixed(6); }
function formatTime(ts) { if (!ts) return '?'; return new Date(parseInt(ts)).toLocaleString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isValidKaspaAddress(a) { return a && a !== 'Unknown' && /^kaspa:[a-z0-9]{61,63}$/.test(a); }

// ========== RATE LIMITER ==========

const RATE_LIMIT = { minDelay: 100, maxDelay: 5000, backoffFactor: 2, maxRetries: 3, callsPerSecond: 8 };
let lastApiCallTime = 0;
let consecutiveRateLimits = 0;
let rateLimitWindowStart = Date.now();
let callsInCurrentWindow = 0;

async function rateLimitedFetch(url, options = {}, retryCount = 0) {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  
  const now = Date.now();
  if (now - rateLimitWindowStart > 1000) { rateLimitWindowStart = now; callsInCurrentWindow = 0; }
  if (callsInCurrentWindow >= RATE_LIMIT.callsPerSecond) {
    const waitTime = 1000 - (now - rateLimitWindowStart);
    if (waitTime > 0) await sleep(waitTime);
    rateLimitWindowStart = Date.now(); callsInCurrentWindow = 0;
  }
  
  const timeSinceLastCall = now - lastApiCallTime;
  if (timeSinceLastCall < RATE_LIMIT.minDelay) await sleep(RATE_LIMIT.minDelay - timeSinceLastCall);
  if (consecutiveRateLimits > 0) {
    const backoffDelay = Math.min(RATE_LIMIT.minDelay * Math.pow(RATE_LIMIT.backoffFactor, consecutiveRateLimits), RATE_LIMIT.maxDelay);
    await sleep(backoffDelay);
  }
  
  lastApiCallTime = Date.now(); callsInCurrentWindow++; apiCallCount++;
  
  try {
    const response = await fetch(url, options);
    if (response.status === 429) {
      consecutiveRateLimits++;
      if (retryCount < RATE_LIMIT.maxRetries) {
        await sleep(2000 * (retryCount + 1));
        return rateLimitedFetch(url, options, retryCount + 1);
      }
      throw new Error('Rate limit exceeded');
    }
    if (response.status === 503) {
      if (retryCount < RATE_LIMIT.maxRetries) {
        await sleep(3000 * (retryCount + 1));
        return rateLimitedFetch(url, options, retryCount + 1);
      }
      throw new Error('Service unavailable');
    }
    if (consecutiveRateLimits > 0) consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
    return response;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (retryCount < RATE_LIMIT.maxRetries) {
      await sleep(1000 * (retryCount + 1));
      return rateLimitedFetch(url, options, retryCount + 1);
    }
    throw error;
  }
}

// ========== TRACE LOGIC (ported from original JS) ==========

function isCoinbaseTransaction(tx) {
  const hasNoInputs = !tx.inputs || tx.inputs.length === 0;
  const singleEmptyInput = tx.inputs?.length === 1 && !tx.inputs[0].previous_outpoint_hash && !tx.inputs[0].signature_script;
  const coinbaseMarker = tx.inputs?.[0]?.previous_outpoint_hash === '0000000000000000000000000000000000000000000000000000000000000000';
  return hasNoInputs || singleEmptyInput || coinbaseMarker;
}

async function traceLifecycleForMulti(txId, outputIndex, signal, autoContinue) {
  const allLifecycle = [];
  const globalVisited = new Set();
  let currentTxId = txId;
  let currentIndex = outputIndex;
  let totalHops = 0;
  const maxTotalHops = 100;
  let segmentNumber = 0;
  let fastPathHopsSaved = 0;
  let behavioralFastPathUsed = false;

  while (currentTxId && totalHops < maxTotalHops) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    
    segmentNumber++;
    const segmentLifecycle = [];
    const segmentVisited = new Set();
    let backwardTxId = currentTxId;
    let backwardIndex = currentIndex;
    let originFound = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!originFound && attempts < maxAttempts && totalHops < maxTotalHops) {
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
        segmentLifecycle.unshift({ txId: backwardTxId, type: 'dead_end', amount: 0, address: 'Invalid_Index', blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isCoinbase: false });
        originFound = true; break;
      }

      const input = tx.inputs?.[backwardIndex];
      
      if (!input || !input.previous_outpoint_hash) {
        const isCoinbase = isCoinbaseTransaction(tx);
        const outputAddress = outputs[backwardIndex]?.script_public_key_address || 'Unknown';
        
        segmentLifecycle.unshift({ txId: backwardTxId, type: isCoinbase ? 'coinbase' : 'dead_end', amount: outputs[backwardIndex]?.amount || 0, address: outputAddress, blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isCoinbase, isExchangeAddress: isExchangeAddress(outputAddress) });
        originFound = true;
        if (!isCoinbase && outputs[backwardIndex]?.script_public_key_address) segmentLifecycle[0].continueAddress = outputs[backwardIndex].script_public_key_address;
        break;
      }

      const prevAddress = input.previous_outpoint_address || 'Unknown';
      segmentLifecycle.unshift({ txId: backwardTxId, type: 'spend', amount: input.previous_outpoint_amount || 0, address: prevAddress, blockTime: tx.block_time, blockHash: tx.block_hash?.[0] || null, isExchangeAddress: isExchangeAddress(prevAddress) });

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
    if (lastStep && lastStep.continueAddress && !lastStep.isCoinbase && totalHops < maxTotalHops) {
      let foundNext = false;
      const exchangeInfo = lookupKnownAddress(lastStep.continueAddress);
      
      if (exchangeInfo && exchangeInfo.type === 'exchange') {
        try {
          const res = await rateLimitedFetch(`${API_BASE}/transactions/${lastStep.txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`, { signal });
          const tx = await res.json();
          const externalInputs = (tx.inputs || []).filter(inp => inp.previous_outpoint_hash && inp.previous_outpoint_address && !isExchangeAddress(inp.previous_outpoint_address));
          
          if (externalInputs.length > 0) {
            currentTxId = externalInputs[0].previous_outpoint_hash;
            currentIndex = parseInt(externalInputs[0].previous_outpoint_index) || 0;
            foundNext = true;
            fastPathHopsSaved += 10;
            allLifecycle.push({ type: 'message', text: `⚡ Fast-path: Skipped ${exchangeInfo.name} internal transfers` });
          }
        } catch(e) {}
      }
      
      if (!foundNext) {
        try {
          const res = await rateLimitedFetch(`${API_BASE}/addresses/${lastStep.continueAddress}/full-transactions-page?limit=20`, { signal });
          const txs = await res.json();
          if (Array.isArray(txs)) {
            for (const histTx of txs) {
              if (histTx.outputs && !foundNext) {
                for (let oi = 0; oi < histTx.outputs.length; oi++) {
                  const out = histTx.outputs[oi];
                  const outAddr = out.script_public_key_address || '';
                  const key = `${histTx.transaction_id}:${oi}`;
                  const deadEndTime = parseInt(lastStep.blockTime) || 0;
                  const histTime = parseInt(histTx.block_time) || 0;
                  if (outAddr === lastStep.continueAddress && parseInt(out.amount) > 0 && !globalVisited.has(key) && (histTime === 0 || deadEndTime === 0 || histTime <= deadEndTime)) {
                    currentTxId = histTx.transaction_id; currentIndex = oi; foundNext = true;
                    allLifecycle.push({ type: 'message', text: '🔗 Continued via same address' }); break;
                  }
                }
              }
            }
          }
        } catch(e) {}
      }

      if (!foundNext) { allLifecycle.push({ type: 'message', text: '🔚 All strategies exhausted' }); break; }
    } else {
      break;
    }
    await sleep(50);
  }

  const realSteps = allLifecycle.filter(s => s.type !== 'separator' && s.type !== 'message');
  realSteps.sort((a, b) => (parseInt(a.blockTime) || 0) - (parseInt(b.blockTime) || 0));

  return {
    steps: realSteps, allLifecycle,
    foundCoinbase: realSteps.some(s => s.type === 'coinbase' || s.isCoinbase),
    totalHops, segments: segmentNumber,
    uniqueAddresses: new Set(realSteps.map(s => s.address)).size,
    fastPathHopsSaved, usedFastPath: fastPathHopsSaved > 0,
    behavioralFastPathUsed
  };
}

async function traceFromAddress(address, signal) {
  const panel = document.getElementById('resultPanel');
  updateProgress('Analyzing UTXOs...', `Looking up address: ${address}`, 20);
  
  try {
    const res = await rateLimitedFetch(`${API_BASE}/addresses/${address}/utxos`, { signal });
    const utxos = await res.json();
    
    if (!Array.isArray(utxos) || utxos.length === 0) {
      panel.innerHTML = '<p style="color:var(--muted);">No UTXOs found for this address.</p>';
      return;
    }
    
    const selected = utxos.slice(0, 3);
    updateProgress('Tracing...', `${selected.length} UTXOs selected`, 50);
    
    multiTraceResults = [];
    for (const utxo of selected) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const txId = utxo.outpoint?.transactionId || '';
      const idx = utxo.outpoint?.index || 0;
      const result = await traceLifecycleForMulti(txId, idx, signal, true);
      result.input = `${address} (UTXO)`;
      result.inputType = 'address_utxo';
      multiTraceResults.push(result);
      await sleep(100);
    }
    
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    renderMultiTraceResults(multiTraceResults);
  } catch(e) { 
    if (e.name !== 'AbortError') panel.innerHTML = `<p style="color:#f87171;">Error: ${e.message}</p>`;
  }
}

async function traceLifecycleSingle(txId, outputIndex, signal) {
  const result = await traceLifecycleForMulti(txId, outputIndex, signal, true);
  result.input = txId;
  result.inputType = 'txid';
  multiTraceResults = [result];
  renderMultiTraceResults([result]);
}

// ========== UI ==========

function updateProgress(message, detail, percentage) {
  const panel = document.getElementById('resultPanel');
  panel.innerHTML = `<div class="progress-container"><div class="progress-spinner"></div><div class="progress-message">${message}</div>${detail ? `<div class="progress-detail">${detail}</div>` : ''}<div class="progress-bar-container"><div class="progress-bar" style="width:${percentage}%"></div></div><div class="progress-stats"><div class="progress-stat"><div class="progress-stat-value">${apiCallCount}</div><div>API Calls</div></div></div></div>`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--accent);color:var(--text);padding:0.5rem 1rem;border-radius:12px;font-size:0.8rem;z-index:2000;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function renderMultiTraceResults(results) {
  const panel = document.getElementById('resultPanel');
  if (!results.length) return;
  
  const result = results[0];
  const steps = result.steps || [];
  const coinbaseStep = steps.find(s => s.type === 'coinbase' || s.isCoinbase);
  const firstStep = steps[0] || {};
  const lastStep = steps[steps.length - 1] || {};
  
  let html = `<div class="export-bar"><button class="btn-export-sm" onclick="exportJSON()">📋 JSON</button><span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount}</span></div>`;
  
  html += `<div class="coin-story">
    <div class="story-header"><span class="story-title">🧬 Coin Story</span>
      <div class="confidence-badge">${result.foundCoinbase ? '✅' : '⚠️'} ${result.foundCoinbase ? 'Coinbase Found' : 'Partial Trace'}</div>
    </div>
    <div class="story-stats">
      <div class="story-stat"><div class="story-stat-value">${steps.length}</div><div class="story-stat-label">Transfers</div></div>
      <div class="story-stat"><div class="story-stat-value" style="color:${result.foundCoinbase ? '#22c55e' : '#f59e0b'};">${result.foundCoinbase ? '✅' : '❌'}</div><div class="story-stat-label">Coinbase</div></div>
      <div class="story-stat"><div class="story-stat-value">${sompiToKAS(lastStep.amount)}</div><div class="story-stat-label">Amount (KAS)</div></div>
    </div>
  </div>`;
  
  html += '<div class="journey-timeline">';
  steps.forEach((step, i) => {
    const badge = step.type === 'coinbase' || step.isCoinbase ? '⛏️ Mining' : step.isExchangeAddress ? '🏦 Exchange' : '💸 Transfer';
    const badgeClass = step.type === 'coinbase' || step.isCoinbase ? 'badge-mining' : step.isExchangeAddress ? 'badge-exchange' : 'badge-personal';
    
    html += `<div class="journey-step ${step.type === 'coinbase' ? 'mining' : step.isExchangeAddress ? 'exchange' : 'personal'}">
      <div class="step-card">
        <div class="step-card-header">
          <span class="step-type-badge ${badgeClass}">${badge}</span>
          <span class="step-amount">${sompiToKAS(step.amount)} KAS</span>
        </div>
        <div class="step-details">
          <div class="step-detail-row">
            <span class="step-detail-label">Address</span>
            <span class="step-detail-value">${resolveAddressDisplay(step.address)}</span>
          </div>
          <div class="step-detail-row">
            <span class="step-detail-label">Time</span>
            <span class="step-detail-value">${formatTime(step.blockTime)}</span>
          </div>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  
  panel.innerHTML = html;
}

function exportJSON() {
  const data = { export_time: new Date().toISOString(), api_calls: apiCallCount, traces: multiTraceResults };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kas-origins-${Date.now()}.json`; a.click();
  showToast('JSON exported');
}

// ========== MAIN ==========

document.getElementById('btnTrace').addEventListener('click', async () => {
  const input = document.getElementById('mainInput').value.trim();
  if (!input) { showToast('Please enter a TX ID or address'); return; }
  
  apiCallCount = 0;
  document.getElementById('btnTrace').disabled = true;
  document.getElementById('btnCancel').style.display = 'inline-block';
  
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  
  updateProgress('Tracing...', 'Connecting to Kaspa API', 10);
  
  try {
    if (/^[a-f0-9]{64}$/.test(input)) {
      await traceLifecycleSingle(input, 0, signal);
    } else if (/^kaspa:[a-z0-9]{61,63}$/.test(input)) {
      await traceFromAddress(input, signal);
    } else {
      document.getElementById('resultPanel').innerHTML = '<p style="color:#f87171;">Invalid input. Enter a TX ID or Kaspa address.</p>';
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      document.getElementById('resultPanel').innerHTML = `<p style="color:#f87171;">Error: ${e.message}</p>`;
    }
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
