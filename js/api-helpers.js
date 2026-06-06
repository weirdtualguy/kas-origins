// API Helper Functions

async function fetchAddressUTXOs(address, maxCount, signal) {
  try {
    const res = await rateLimitedFetch(`${API_BASE}/addresses/${address}/utxos`, { signal });
    const utxos = await res.json();
    
    if (!Array.isArray(utxos)) return [];
    if (maxCount === 'all') return utxos;
    return utxos.slice(0, parseInt(maxCount));
  } catch(e) {
    return [];
  }
}

async function fetchAddressTransactions(address, signal) {
  try {
    const res = await rateLimitedFetch(
      `${API_BASE}/addresses/${address}/full-transactions-page?limit=${TRACE_CONFIG.addressTransactionLimit}`, 
      { signal }
    );
    const txs = await res.json();
    
    if (!Array.isArray(txs)) return [];
    
    const results = [];
    for (const tx of txs) {
      if (tx.outputs) {
        for (let oi = 0; oi < tx.outputs.length; oi++) {
          const outAddr = tx.outputs[oi].script_public_key_address || '';
          if (outAddr === address && tx.outputs[oi].amount > 0) {
            results.push({
              transaction_id: tx.transaction_id,
              output_index: oi,
              amount: parseInt(tx.outputs[oi].amount)
            });
            break;
          }
        }
      }
    }
    return results;
  } catch(e) {
    return [];
  }
}

async function fetchTransaction(txId, signal) {
  try {
    const res = await rateLimitedFetch(
      `${API_BASE}/transactions/${txId}?inputs=true&outputs=true&resolve_previous_outpoints=light`,
      { signal }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch(e) {
    return null;
  }
}

async function fetchAddressHistory(address, limit = 20, signal) {
  try {
    const res = await rateLimitedFetch(
      `${API_BASE}/addresses/${address}/full-transactions-page?limit=${limit}`,
      { signal }
    );
    return await res.json();
  } catch(e) {
    return [];
  }
}