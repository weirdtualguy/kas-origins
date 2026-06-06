// Phase Analysis System
// (Same logic as before, preserved completely)

function analyzeTracePhases(steps) {
  if (!steps || steps.length === 0) return [];
  
  const phases = [];
  let currentPhase = { 
    type: 'unknown', 
    startIdx: 0, 
    addresses: new Set(),
    startAmount: parseFloat(sompiToKAS(steps[0]?.amount || 0)), 
    exchangeName: null 
  };
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const amount = parseFloat(sompiToKAS(step.amount || 0));
    const addr = step.address;
    const isCoinbase = step.type === 'coinbase' || step.isCoinbase;
    const exchangeName = getExchangeNameFromAddress(addr);
    const isExchange = isExchangeLike(addr, amount);
    
    let stepPhaseType;
    
    if (isCoinbase) { 
      stepPhaseType = 'mining'; 
    } else if (isExchange) { 
      stepPhaseType = 'exchange'; 
    } else if (amount < 100 && currentPhase.type === 'exchange') { 
      stepPhaseType = 'distribution'; 
    } else if (amount < 1000 && !isExchange) { 
      stepPhaseType = 'consolidation'; 
    } else { 
      stepPhaseType = 'exchange'; 
    }
    
    if (i === 0) {
      currentPhase.type = stepPhaseType;
      currentPhase.exchangeName = exchangeName;
    } else {
      const typeChanged = stepPhaseType !== currentPhase.type;
      const exchangeChanged = isExchange && exchangeName && exchangeName !== currentPhase.exchangeName;
      const enteringExchange = stepPhaseType === 'exchange' && currentPhase.type !== 'exchange';
      const leavingExchange = stepPhaseType === 'distribution' && currentPhase.type === 'exchange';
      const enteringMining = stepPhaseType === 'mining' && currentPhase.type !== 'mining';
      
      if (typeChanged || exchangeChanged || enteringExchange || leavingExchange || enteringMining) {
        phases.push({
          type: currentPhase.type,
          exchangeName: currentPhase.exchangeName,
          startIdx: currentPhase.startIdx,
          endIdx: i - 1,
          startAmount: currentPhase.startAmount,
          endAmount: parseFloat(sompiToKAS(steps[i - 1]?.amount || 0)),
          stepCount: i - currentPhase.startIdx,
          addresses: Array.from(currentPhase.addresses)
        });
        
        currentPhase = {
          type: stepPhaseType,
          startIdx: i,
          addresses: new Set([addr]),
          startAmount: amount,
          exchangeName: exchangeName
        };
      } else {
        currentPhase.addresses.add(addr);
        if (exchangeName && !currentPhase.exchangeName) {
          currentPhase.exchangeName = exchangeName;
        }
      }
    }
  }
  
  phases.push({
    type: currentPhase.type,
    exchangeName: currentPhase.exchangeName,
    startIdx: currentPhase.startIdx,
    endIdx: steps.length - 1,
    startAmount: currentPhase.startAmount,
    endAmount: parseFloat(sompiToKAS(steps[steps.length - 1]?.amount || 0)),
    stepCount: steps.length - currentPhase.startIdx,
    addresses: Array.from(currentPhase.addresses)
  });
  
  return phases;
}

function getExchangeNameFromAddress(addr) {
  return lookupKnownAddress(addr)?.name || null;
}

function getPhaseLabel(type, exchangeName) {
  const labels = {
    'mining': '⛏️ Mining',
    'consolidation': '🔄 Consolidation',
    'exchange': exchangeName ? `🏦 ${exchangeName}` : '🏦 Exchange Activity',
    'distribution': '📤 Distribution',
    'unknown': '❓ Unknown'
  };
  return labels[type] || type;
}

function getPhaseClass(type) {
  return `phase-${type}`;
}

// Get simplified path for coin story
function getStoryPath(phases) {
  return phases.map(phase => ({
    type: phase.type,
    label: getPhaseLabel(phase.type, phase.exchangeName),
    exchangeName: phase.exchangeName,
    icon: getPhaseIcon(phase.type),
    cssClass: getPhaseNodeClass(phase.type)
  }));
}

function getPhaseIcon(type) {
  const icons = {
    'mining': '⛏️',
    'consolidation': '🔄',
    'exchange': '🏦',
    'distribution': '📤',
    'unknown': '❓'
  };
  return icons[type] || '❓';
}

function getPhaseNodeClass(type) {
  const classes = {
    'mining': 'mining',
    'exchange': 'exchange',
    'consolidation': 'personal',
    'distribution': 'personal'
  };
  return classes[type] || '';
}

// Calculate trace confidence
function calculateConfidence(traceResult) {
  if (!traceResult || traceResult.error) return 0;
  
  let confidence = 0;
  const weights = UI_CONFIG.confidenceWeights;
  
  if (traceResult.foundCoinbase) confidence += weights.coinbaseFound;
  
  const hasKnownExchange = traceResult.steps?.some(s => 
    s.isExchangeAddress || s.isBehavioralExchange
  );
  if (hasKnownExchange) confidence += weights.exchangeIdentified;
  
  if (traceResult.steps?.length > 0 && !traceResult.steps.some(s => s.type === 'dead_end')) {
    confidence += weights.completePath;
  }
  
  if (!traceResult.validationWarnings?.length && !traceResult.invalidAddresses?.length) {
    confidence += weights.noDeadEnds;
  }
  
  return Math.min(100, confidence);
}

function getConfidenceLabel(confidence) {
  if (confidence >= 90) return 'High';
  if (confidence >= 60) return 'Medium';
  if (confidence >= 30) return 'Low';
  return 'Minimal';
}