// Export Functions

function exportResultsAsCSV() {
  if (!multiTraceResults || multiTraceResults.length === 0) {
    showToast('No results to export');
    return;
  }
  
  let csv = 'Trace #,Phase,TX ID,Type,Amount (KAS),Address,Block Time,Is Coinbase,FastPath,Behavioral\n';
  
  multiTraceResults.forEach((result, traceIdx) => {
    if (result.steps && result.steps.length > 0) {
      const phases = analyzeTracePhases(result.steps);
      const stepPhases = {};
      
      phases.forEach(phase => {
        for (let i = phase.startIdx; i <= phase.endIdx; i++) {
          stepPhases[i] = getPhaseLabel(phase.type, phase.exchangeName);
        }
      });
      
      result.steps.forEach((step, stepIdx) => {
        csv += `"${traceIdx + 1}","${stepPhases[stepIdx] || ''}","${step.txId || ''}","${(step.type === 'coinbase' || step.isCoinbase) ? 'Mining Reward' : 'Spent'}","${sompiToKAS(step.amount || 0)}","${step.address || 'Unknown'}","${formatTime(step.blockTime)}","${step.isCoinbase ? 'Yes' : 'No'}","${result.usedFastPath ? 'Yes' : 'No'}","${result.behavioralFastPathUsed ? 'Yes' : 'No'}"\n`;
      });
    } else if (result.error) {
      csv += `"${traceIdx + 1}","","","ERROR","","${result.error}","","","",""\n`;
    }
  });
  
  downloadFile(csv, `kaspa-trace-${Date.now()}.csv`, 'text/csv');
  showToast('CSV exported');
}

function exportResultsAsJSON() {
  if (!multiTraceResults || multiTraceResults.length === 0) {
    showToast('No results to export');
    return;
  }
  
  const exportData = {
    exportTime: new Date().toISOString(),
    totalTraces: multiTraceResults.length,
    apiCalls: apiCallCount,
    traces: multiTraceResults.map((result, i) => ({
      traceNumber: i + 1,
      input: result.input || '',
      inputType: result.inputType || '',
      foundCoinbase: result.foundCoinbase || false,
      totalHops: result.totalHops || 0,
      fastPathHopsSaved: result.fastPathHopsSaved || 0,
      usedFastPath: result.usedFastPath || false,
      behavioralFastPathUsed: result.behavioralFastPathUsed || false,
      uniqueAddresses: result.uniqueAddresses || 0,
      segments: result.segments || 0,
      phases: result.steps ? analyzeTracePhases(result.steps).map(p => ({
        type: p.type,
        label: getPhaseLabel(p.type, p.exchangeName),
        exchangeName: p.exchangeName || null,
        startStep: p.startIdx + 1,
        endStep: p.endIdx + 1,
        stepCount: p.stepCount,
        addresses: p.addresses?.length || 0,
        startAmount: p.startAmount,
        endAmount: p.endAmount
      })) : [],
      validationWarnings: result.validationWarnings || [],
      invalidAddresses: result.invalidAddresses || [],
      error: result.error || null,
      steps: (result.steps || []).map(step => ({
        txId: step.txId || '',
        type: step.type || 'unknown',
        isCoinbase: step.isCoinbase || false,
        amount: step.amount || 0,
        amountKAS: sompiToKAS(step.amount || 0),
        address: step.address || 'Unknown',
        isExchangeAddress: step.isExchangeAddress || false,
        exchangeName: lookupKnownAddress(step.address)?.name || null,
        invalidAddress: step.invalidAddress || false,
        blockTime: step.blockTime || null,
        blockTimeFormatted: formatTime(step.blockTime),
        blockHash: step.blockHash || null
      }))
    }))
  };
  
  downloadFile(JSON.stringify(exportData, null, 2), `kaspa-trace-${Date.now()}.json`, 'application/json');
  showToast('JSON exported');
}

function exportResultsAsText() {
  if (!multiTraceResults || multiTraceResults.length === 0) {
    showToast('No results to export');
    return;
  }
  
  let text = '═══════════════════════════════════\n   KASPA COIN TRACE REPORT\n';
  text += `   Generated: ${new Date().toLocaleString()}\n   Total API Calls: ${apiCallCount}\n═══════════════════════════════════\n\n`;
  
  multiTraceResults.forEach((result, traceIdx) => {
    text += `📊 TRACE #${traceIdx + 1}\n${'─'.repeat(40)}\n`;
    
    if (result.error) {
      text += `  ❌ Error: ${result.error}\n\n`;
      return;
    }
    
    if (result.steps && result.steps.length > 0) {
      const lastStep = result.steps[result.steps.length - 1];
      text += `  🔍 Input: ${result.input || 'Unknown'}\n`;
      text += `  📈 Hops: ${result.steps.length}\n`;
      text += `  👥 Unique Addresses: ${result.uniqueAddresses || 0}\n`;
      text += `  ⛏️ Coinbase Found: ${result.foundCoinbase ? '✅ Yes' : '❌ No'}\n`;
      text += `  💰 Final Amount: ${sompiToKAS(lastStep?.amount || 0)} KAS\n`;
      
      if (result.usedFastPath) {
        text += `  ⚡ Fast-Path: Saved ~${result.fastPathHopsSaved} hops (${result.behavioralFastPathUsed ? 'Behavioral' : 'Known Exchange'})\n`;
      }
      
      const phases = analyzeTracePhases(result.steps);
      if (phases.length > 0) {
        text += '\n  📊 PHASE ANALYSIS:\n';
        phases.forEach(p => {
          text += `    ${getPhaseLabel(p.type, p.exchangeName)}: Steps ${p.startIdx + 1}-${p.endIdx + 1} (${p.stepCount} steps) | ${p.startAmount?.toFixed(2)} → ${p.endAmount?.toFixed(2)} KAS\n`;
        });
      }
      
      text += '\n  📋 STEPS:\n';
      result.steps.forEach((step, stepIdx) => {
        const exchangeLabel = step.isExchangeAddress ? 
          ` [${lookupKnownAddress(step.address)?.name || 'Exchange'}]` : '';
        text += `    ${step.type === 'coinbase' || step.isCoinbase ? '⛏️' : '💸'} Step ${stepIdx + 1}: ${sompiToKAS(step.amount || 0)} KAS${exchangeLabel}\n`;
        text += `       TX: ${step.txId || 'Unknown'}\n`;
        text += `       Addr: ${step.address || 'Unknown'}\n`;
        text += `       Time: ${formatTime(step.blockTime)}\n`;
      });
    }
    text += '\n';
  });
  
  text += '═══════════════════════════════════\n   END OF REPORT\n═══════════════════════════════════\n';
  downloadFile(text, `kaspa-trace-${Date.now()}.txt`, 'text/plain');
  showToast('Text report exported');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#252830;border:0.5px solid #374151;color:#d1d5db;padding:0.5rem 1rem;border-radius:8px;font-size:0.8rem;z-index:2000;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}