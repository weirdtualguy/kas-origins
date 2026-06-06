// Utility Functions

function sompiToKAS(s) {
  const n = typeof s === 'string' ? parseInt(s) : s;
  return isNaN(n) ? '0' : (n / 1e8).toFixed(6);
}

function formatTime(ts) {
  if (!ts) return '?';
  return new Date(parseInt(ts)).toLocaleString();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isValidKaspaAddress(address) {
  if (!address || address === 'Unknown') return false;
  return /^kaspa:[a-z0-9]{61,63}$/.test(address);
}

function isCoinbaseTransaction(tx) {
  const hasNoInputs = !tx.inputs || tx.inputs.length === 0;
  const singleEmptyInput = tx.inputs?.length === 1 && !tx.inputs[0].previous_outpoint_hash && !tx.inputs[0].signature_script;
  const coinbaseMarker = tx.inputs?.[0]?.previous_outpoint_hash === '0000000000000000000000000000000000000000000000000000000000000000';
  return hasNoInputs || singleEmptyInput || coinbaseMarker;
}

function validateOutputIndex(tx, outputIndex) {
  const outputs = tx.outputs || [];
  const maxIndex = outputs.length - 1;
  if (outputIndex < 0) return { valid: false, maxIndex, message: `Negative output index: ${outputIndex}` };
  if (outputIndex > maxIndex) return { valid: false, maxIndex, message: `Output index ${outputIndex} out of bounds` };
  return { valid: true, maxIndex, message: '' };
}

function sanitizeSteps(steps) {
  const invalidAddresses = [];
  const sanitized = steps.map((step, i) => {
    if (step.address && step.address !== 'Unknown') {
      if (!isValidKaspaAddress(step.address)) {
        invalidAddresses.push({ stepIndex: i, address: step.address, txId: step.txId });
        step.invalidAddress = true;
      }
    }
    return step;
  });
  return { steps: sanitized, invalidAddresses };
}

function classifyUTXOs(utxos) {
  const EXCHANGE_THRESHOLD = TRACE_CONFIG.exchangeThreshold;
  const DUST_THRESHOLD = TRACE_CONFIG.dustThreshold;
  
  return utxos.map(utxo => {
    const amount = parseInt(utxo.utxoEntry?.amount || 0);
    const isCoinbase = utxo.utxoEntry?.isCoinbase || false;
    const blockDaaScore = parseInt(utxo.utxoEntry?.blockDaaScore || 0);
    const address = utxo.address || '';
    let category;
    
    if (isCoinbase) category = 'mining_reward';
    else if (amount >= EXCHANGE_THRESHOLD || isExchangeAddress(address)) category = 'exchange_custodial';
    else if (amount <= DUST_THRESHOLD) category = 'dust';
    else if (amount >= 1000 * 1e8) category = 'large_personal';
    else if (amount >= 10 * 1e8) category = 'medium_personal';
    else category = 'small_personal';
    
    return { ...utxo, amount, category, blockDaaScore, isCoinbase };
  });
}

function selectPersonalUTXOs(classified, maxCount = 5) {
  const miningRewards = classified.filter(u => u.category === 'mining_reward');
  const mediumPersonal = classified.filter(u => u.category === 'medium_personal');
  const smallPersonal = classified.filter(u => u.category === 'small_personal');
  const largePersonal = classified.filter(u => u.category === 'large_personal');
  const selected = [];
  
  if (miningRewards.length > 0) {
    miningRewards.sort((a, b) => b.blockDaaScore - a.blockDaaScore);
    selected.push(...miningRewards.slice(0, Math.min(3, maxCount)));
  }
  if (selected.length < maxCount && mediumPersonal.length > 0) {
    mediumPersonal.sort((a, b) => b.blockDaaScore - a.blockDaaScore);
    selected.push(...mediumPersonal.slice(0, maxCount - selected.length));
  }
  if (selected.length < maxCount && smallPersonal.length > 0) {
    smallPersonal.sort((a, b) => a.amount - b.amount);
    selected.push(...smallPersonal.slice(0, maxCount - selected.length));
  }
  if (selected.length < 3 && largePersonal.length > 0) {
    largePersonal.sort((a, b) => a.amount - b.amount);
    selected.push(...largePersonal.slice(0, 3 - selected.length));
  }
  if (selected.length === 0) {
    const validUTXOs = classified.filter(u => u.category !== 'exchange_custodial' && u.category !== 'dust').sort((a, b) => a.amount - b.amount);
    if (validUTXOs.length > 0) selected.push(validUTXOs[0]);
  }
  
  return selected.slice(0, maxCount);
}

function getUTXOClassificationSummary(classified) {
  const counts = {};
  classified.forEach(u => { counts[u.category] = (counts[u.category] || 0) + 1; });
  const labels = {
    'mining_reward': '⛏️ Mining',
    'exchange_custodial': '🏦 Exchange',
    'large_personal': '💰 Large',
    'medium_personal': '💵 Medium',
    'small_personal': '🪙 Small',
    'dust': '🌫️ Dust'
  };
  return Object.entries(counts).map(([cat, count]) => `${count} ${labels[cat] || cat}`).join(' | ');
}