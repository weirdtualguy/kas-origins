// Core Trace Engine

let multiTraceResults = [];
let globalVisited = null;
let validationWarnings = [];
let fastPathHopsSaved = 0;
let behavioralFastPathUsed = false;

async function traceLifecycleForMulti(txId, outputIndex, signal, autoContinue) {
  const allLifecycle = [];
  globalVisited = new Set();
  validationWarnings = [];
  fastPathHopsSaved = 0;
  behavioralFastPathUsed = false;
  
  let currentTxId = txId;
  let currentIndex = outputIndex;
  let totalHops = 0;
  let segmentNumber = 0;

  while (currentTxId && totalHops < TRACE_CONFIG.maxTotalHops) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    
    segmentNumber++;
    const segmentLifecycle = [];
    const segmentVisited = new Set();
    let backwardTxId = currentTxId;
    let backwardIndex = currentIndex;
    let originFound = false;
    let attempts = 0;

    while (!originFound && attempts < TRACE_CONFIG.maxAttemptsPerSegment && totalHops < TRACE_CONFIG.maxTotalHops) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      attempts++;
      totalHops++;
      
      const key = `${backwardTxId}:${backwardIndex}`;
      if (segmentVisited.has(key) || globalVisited.has(key)) break;
      segmentVisited.add(key);
      globalVisited.add(key);

      const tx = await fetchTransaction(backwardTxId, signal);
      if (!tx) break;

      const outputValidation = validateOutputIndex(tx, backwardIndex);
      if (!outputValidation.valid) {
        validationWarnings.push({
          type: 'output_bounds',
          txId: backwardTxId,
          index: backwardIndex,
          message: outputValidation.message
        });
        
        segmentLifecycle.unshift({
          txId: backwardTxId,
          type: 'dead_end',
          amount: 0,
          address: 'Invalid_Output_Index',
          blockTime: tx.block_time,
          blockHash: tx.block_hash?.[0] || null,
          isCoinbase: false,
          validationError: outputValidation.message
        });
        originFound = true;
        break;
      }

      const input = tx.inputs?.[backwardIndex];
      
      if (!input || !input.previous_outpoint_hash) {
        const isCoinbase = isCoinbaseTransaction(tx);
        const outputAddress = tx.outputs?.[backwardIndex]?.script_public_key_address || 'Unknown';
        const addressValid = isValidKaspaAddress(outputAddress);
        
        if (!addressValid && outputAddress !== 'Unknown') {
          validationWarnings.push({
            type: 'invalid_address',
            txId: backwardTxId,
            address: outputAddress,
            message: 'Invalid address format'
          });
        }
        
        segmentLifecycle.unshift({
          txId: backwardTxId,
          type: isCoinbase ? 'coinbase' : 'dead_end',
          amount: tx.outputs?.[backwardIndex]?.amount || 0,
          address: outputAddress,
          blockTime: tx.block_time,
          blockHash: tx.block_hash?.[0] || null,
          isCoinbase,
          invalidAddress: !addressValid && outputAddress !== 'Unknown',
          isExchangeAddress: isExchangeAddress(outputAddress),
          isBehavioralExchange: false
        });
        
        originFound = true;
        if (!isCoinbase && tx.outputs?.[backwardIndex]?.script_public_key_address) {
          segmentLifecycle[0].continueAddress = tx.outputs[backwardIndex].script_public_key_address;
        }
        break;
      }

      const prevAddress = input.previous_outpoint_address || 'Unknown';
      const prevAddressValid = isValidKaspaAddress(prevAddress);
      
      if (!prevAddressValid && prevAddress !== 'Unknown') {
        validationWarnings.push({
          type: 'invalid_address',
          txId: backwardTxId,
          address: prevAddress,
          message: 'Invalid address format'
        });
      }

      segmentLifecycle.unshift({
        txId: backwardTxId,
        type: 'spend',
        amount: input.previous_outpoint_amount || 0,
        address: prevAddress,
        blockTime: tx.block_time,
        blockHash: tx.block_hash?.[0] || null,
        invalidAddress: !prevAddressValid && prevAddress !== 'Unknown',
        isExchangeAddress: isExchangeAddress(prevAddress),
        isBehavioralExchange: false
      });

      backwardTxId = input.previous_outpoint_hash;
      backwardIndex = parseInt(input.previous_outpoint_index) || 0;
      await sleep(30);
    }

    if (segmentLifecycle.length > 0) {
      if (allLifecycle.length > 0) allLifecycle.push({ type: 'separator' });
      allLifecycle.push(...segmentLifecycle);
    }

    // ===== AUTO-CONTINUE STRATEGIES =====
    if (!autoContinue) break;
    
    const lastStep = segmentLifecycle[0];
    if (lastStep && lastStep.continueAddress && !(lastStep.isCoinbase === true) && totalHops < TRACE_CONFIG.maxTotalHops) {
      let foundNext = false;
      const exchangeInfo = lookupKnownAddress(lastStep.continueAddress);
      
      // ===== BEHAVIORAL EXCHANGE DETECTION =====
      if (!exchangeInfo && !foundNext) {
        const recentSteps = allLifecycle.filter(s => s.type === 'spend' || s.type === 'coinbase' || s.type === 'dead_end');
        const isBehavioralExchange = detectExchangeBehavior(recentSteps, lastStep.continueAddress);
        
        if (isBehavioralExchange) {
          behavioralFastPathUsed = true;
          allLifecycle.push({ type: 'message', text: `🏦 Detected unknown exchange activity - applying fast-path...` });
          
          try {
            const tx = await fetchTransaction(lastStep.txId, signal);
            if (tx) {
              const externalInputs = (tx.inputs || []).filter(inp => {
                const addr = inp.previous_outpoint_address || '';
                const amount = parseFloat(sompiToKAS(inp.previous_outpoint_amount || 0));
                return !detectExchangeBehavior(recentSteps, addr) && amount < 1000000;
              });
              
              if (externalInputs.length > 0) {
                currentTxId = externalInputs[0].previous_outpoint_hash;
                currentIndex = parseInt(externalInputs[0].previous_outpoint_index) || 0;
                foundNext = true;
                fastPathHopsSaved += 15;
                allLifecycle.push({ type: 'message', text: `⚡ Behavioral fast-path: Skipped unknown exchange internal transfers` });
              }
            }
          } catch(e) {}
        }
      }
      
      // ===== KNOWN EXCHANGE FAST-PATH =====
      if (!foundNext && exchangeInfo && exchangeInfo.type === 'exchange') {
        allLifecycle.push({ type: 'message', text: `🏦 Detected ${exchangeInfo.name} - using fast-path...` });
        
        try {
          const tx = await fetchTransaction(lastStep.txId, signal);
          if (tx) {
            const externalInputs = (tx.inputs || []).filter(inp => 
              inp.previous_outpoint_hash && 
              inp.previous_outpoint_address && 
              !isExchangeAddress(inp.previous_outpoint_address)
            );
            
            if (externalInputs.length > 0) {
              currentTxId = externalInputs[0].previous_outpoint_hash;
              currentIndex = parseInt(externalInputs[0].previous_outpoint_index) || 0;
              foundNext = true;
              fastPathHopsSaved += 10;
              allLifecycle.push({ type: 'message', text: `⚡ Fast-path: Skipped ${exchangeInfo.name} internal transfers` });
            } else {
              const firstExchangeInput = tx.inputs?.[0];
              if (firstExchangeInput?.previous_outpoint_hash) {
                currentTxId = firstExchangeInput.previous_outpoint_hash;
                currentIndex = parseInt(firstExchangeInput.previous_outpoint_index) || 0;
                foundNext = true;
                allLifecycle.push({ type: 'message', text: `🏦 Tracing through ${exchangeInfo.name} internal transfer` });
              }
            }
          }
        } catch(e) {}
      }
      
      // Strategy 1: Same address history
      if (!foundNext) {
        try {
          const txs = await fetchAddressHistory(lastStep.continueAddress, 20, signal);
          if (Array.isArray(txs)) {
            for (const histTx of txs) {
              if (histTx.outputs && !foundNext) {
                for (let oi = 0; oi < histTx.outputs.length; oi++) {
                  const out = histTx.outputs[oi];
                  const outAddr = out.script_public_key_address || out.verboseData?.scriptPublicKeyAddress || '';
                  const key = `${histTx.transaction_id}:${oi}`;
                  const deadEndTime = parseInt(lastStep.blockTime) || 0;
                  const histTime = parseInt(histTx.block_time) || 0;
                  
                  if (isExchangeAddress(outAddr) && outAddr !== lastStep.continueAddress) continue;
                  
                  if (outAddr === lastStep.continueAddress && 
                      parseInt(out.amount) > 0 && 
                      !globalVisited.has(key) && 
                      (histTime === 0 || deadEndTime === 0 || histTime <= deadEndTime)) {
                    currentTxId = histTx.transaction_id;
                    currentIndex = oi;
                    foundNext = true;
                    allLifecycle.push({ type: 'message', text: '🔗 Continued via same address' });
                    break;
                  }
                }
              }
            }
          }
        } catch(e) {}
      }

      // Strategy 2: Other outputs (skip exchange addresses)
      if (!foundNext && !signal.aborted) {
        try {
          const deadEndData = await fetchTransaction(lastStep.txId, signal);
          if (deadEndData?.outputs) {
            const outputs = deadEndData.outputs.sort((a, b) => {
              const aExch = isExchangeAddress(a.script_public_key_address || a.verboseData?.scriptPublicKeyAddress || '');
              const bExch = isExchangeAddress(b.script_public_key_address || b.verboseData?.scriptPublicKeyAddress || '');
              if (aExch && !bExch) return 1;
              if (!aExch && bExch) return -1;
              return 0;
            });
            
            for (let oi = 0; oi < outputs.length && !foundNext; oi++) {
              if (signal.aborted) break;
              const out = outputs[oi];
              const outAddr = out.script_public_key_address || out.verboseData?.scriptPublicKeyAddress || '';
              const key = `${lastStep.txId}:${oi}`;
              
              if (globalVisited.has(key) || !outAddr || parseInt(out.amount) <= 0) continue;
              if (isExchangeAddress(outAddr)) continue;
              
              const branchTxs = await fetchAddressHistory(outAddr, 20, signal);
              if (Array.isArray(branchTxs)) {
                for (const branchTx of branchTxs) {
                  if (branchTx.outputs && !foundNext) {
                    for (let bi = 0; bi < branchTx.outputs.length; bi++) {
                      const bOut = branchTx.outputs[bi];
                      const bAddr = bOut.script_public_key_address || bOut.verboseData?.scriptPublicKeyAddress || '';
                      const bKey = `${branchTx.transaction_id}:${bi}`;
                      const deadTime = parseInt(lastStep.blockTime) || 0;
                      const bTime = parseInt(branchTx.block_time) || 0;
                      
                      if (bAddr === outAddr && 
                          parseInt(bOut.amount) > 0 && 
                          !globalVisited.has(bKey) && 
                          (bTime === 0 || deadTime === 0 || bTime <= deadTime)) {
                        currentTxId = branchTx.transaction_id;
                        currentIndex = bi;
                        foundNext = true;
                        allLifecycle.push({ type: 'message', text: '🔀 Switched to non-exchange branch' });
                        break;
                      }
                    }
                  }
                }
              }
              if (foundNext) break;
              await sleep(20);
            }
          }
        } catch(e) {}
      }

      // Strategy 3: Input addresses (prefer non-exchange)
      if (!foundNext && !signal.aborted) {
        try {
          const deadEndData = await fetchTransaction(lastStep.txId, signal);
          if (deadEndData?.inputs) {
            const inputs = deadEndData.inputs.sort((a, b) => {
              const aExch = isExchangeAddress(a.previous_outpoint_address || '');
              const bExch = isExchangeAddress(b.previous_outpoint_address || '');
              if (aExch && !bExch) return 1;
              if (!aExch && bExch) return -1;
              return 0;
            });
            
            for (let ii = 0; ii < inputs.length && !foundNext; ii++) {
              const inp = inputs[ii];
              if (inp.previous_outpoint_address && 
                  inp.previous_outpoint_hash && 
                  !globalVisited.has(`${inp.previous_outpoint_hash}:${inp.previous_outpoint_index}`)) {
                currentTxId = inp.previous_outpoint_hash;
                currentIndex = parseInt(inp.previous_outpoint_index) || 0;
                foundNext = true;
                const addrLabel = isExchangeAddress(inp.previous_outpoint_address) ? 
                  ` (${lookupKnownAddress(inp.previous_outpoint_address)?.name})` : '';
                allLifecycle.push({ type: 'message', text: `🔗 Traced through input address${addrLabel}` });
                break;
              }
            }
          }
        } catch(e) {}
      }

      // Strategy 4: Deep search
      if (!foundNext && !signal.aborted) {
        try {
          const allTxs = await fetchAddressHistory(lastStep.continueAddress, TRACE_CONFIG.deepSearchLimit, signal);
          if (Array.isArray(allTxs) && allTxs.length > 0) {
            allTxs.sort((a, b) => (a.block_time || 0) - (b.block_time || 0));
            for (const oldTx of allTxs) {
              if (oldTx.outputs && !foundNext) {
                for (let oi = 0; oi < oldTx.outputs.length; oi++) {
                  const out = oldTx.outputs[oi];
                  const outAddr = out.script_public_key_address || out.verboseData?.scriptPublicKeyAddress || '';
                  const key = `${oldTx.transaction_id}:${oi}`;
                  const deadTime = parseInt(lastStep.blockTime) || 0;
                  const oldTime = parseInt(oldTx.block_time) || 0;
                  
                  if (outAddr === lastStep.continueAddress && 
                      parseInt(out.amount) > 0 && 
                      !globalVisited.has(key) && 
                      (oldTime === 0 || deadTime === 0 || oldTime <= deadTime)) {
                    currentTxId = oldTx.transaction_id;
                    currentIndex = oi;
                    foundNext = true;
                    allLifecycle.push({ type: 'message', text: '🔍 Found via deep search' });
                    break;
                  }
                }
              }
            }
          }
        } catch(e) {}
      }

      if (!foundNext) {
        allLifecycle.push({ type: 'message', text: '🔚 All strategies exhausted' });
        break;
      }
    } else {
      break;
    }
    await sleep(50);
  }

  const realSteps = allLifecycle.filter(s => s.type !== 'separator' && s.type !== 'message');
  realSteps.sort((a, b) => (parseInt(a.blockTime) || 0) - (parseInt(b.blockTime) || 0));

  const { steps: sanitizedSteps, invalidAddresses } = sanitizeSteps(realSteps);

  return {
    steps: sanitizedSteps,
    allLifecycle,
    foundCoinbase: sanitizedSteps.some(s => s.type === 'coinbase' || s.isCoinbase),
    totalHops,
    segments: segmentNumber,
    uniqueAddresses: new Set(sanitizedSteps.map(s => s.address)).size,
    validationWarnings,
    invalidAddresses,
    fastPathHopsSaved,
    usedFastPath: fastPathHopsSaved > 0,
    behavioralFastPathUsed
  };
}

async function traceLifecycleSingle(txId, outputIndex, signal) {
  const result = await traceLifecycleForMulti(txId, outputIndex, signal, true);
  result.input = txId;
  result.inputType = 'txid';
  multiTraceResults = [result];
  renderMultiTraceResults([result]);
}

async function traceFromAddress(address, signal) {
  const panel = document.getElementById('resultPanel');
  
  updateProgress('Analyzing UTXOs...', `Looking up address: ${address}`, 20, {
    'Status': 'Fetching...',
    'UTXOs': '0',
    'API Calls': apiCallCount.toString()
  });
  
  try {
    const utxos = await fetchAddressUTXOs(address, 'all', signal);
    
    if (utxos.length === 0) {
      updateProgress('No UTXOs found...', 'Searching transaction history', 40, {
        'Status': 'Fallback mode',
        'API Calls': apiCallCount.toString()
      });
      
      const txs = await fetchAddressTransactions(address, signal);
      if (txs.length > 0) {
        const reasonableTxs = txs.filter(tx => tx.amount < 1000000 * 1e8);
        reasonableTxs.sort((a, b) => a.amount - b.amount);
        
        updateProgress('Found personal transactions...', 'Starting trace', 60, {
          'Status': 'Tracing',
          'Candidates': reasonableTxs.length.toString()
        });
        
        multiTraceResults = [];
        for (let i = 0; i < Math.min(reasonableTxs.length, 3); i++) {
          if (signal.aborted) break;
          const result = await traceLifecycleForMulti(
            reasonableTxs[i].transaction_id,
            reasonableTxs[i].output_index,
            signal,
            true
          );
          result.input = `${address} (TX: ${sompiToKAS(reasonableTxs[i].amount)} KAS)`;
          result.inputType = 'address_tx';
          multiTraceResults.push(result);
          await sleep(50);
        }
        
        renderMultiTraceResults(multiTraceResults);
        return;
      }
      
      panel.innerHTML = '<p style="color:var(--muted);">No UTXOs or transactions found for this address.</p>';
      return;
    }
    
    const classified = classifyUTXOs(utxos);
    updateProgress('Selecting best UTXOs...', getUTXOClassificationSummary(classified), 40, {
      'Status': 'Analyzing',
      'Total UTXOs': utxos.length.toString()
    });
    
    const selectedUTXOs = selectPersonalUTXOs(classified, TRACE_CONFIG.maxUTXOsToSelect);
    if (selectedUTXOs.length === 0) {
      panel.innerHTML = '<p style="color:#f59e0b;font-size:0.7rem;">⚠️ All UTXOs appear to be exchange/custodial.</p>';
      return;
    }
    
    updateProgress('Tracing...', `${selectedUTXOs.length} UTXOs selected`, 60, {
      'Status': 'Tracing',
      'Selected': selectedUTXOs.length.toString()
    });
    
    multiTraceResults = [];
    for (let i = 0; i < selectedUTXOs.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      
      const utxo = selectedUTXOs[i];
      const amount = sompiToKAS(utxo.amount || utxo.utxoEntry?.amount || 0);
      const result = await traceLifecycleForMulti(
        utxo.outpoint.transactionId,
        utxo.outpoint.index || 0,
        signal,
        true
      );
      result.input = `${address} (${amount} KAS UTXO)`;
      result.inputType = 'address_utxo';
      multiTraceResults.push(result);
      await sleep(100);
    }
    
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    renderMultiTraceResults(multiTraceResults);
    
  } catch(e) {
    if (e.name !== 'AbortError') {
      panel.innerHTML = `<p style="color:#f87171;">Error: ${e.message}</p>`;
    }
  }
}