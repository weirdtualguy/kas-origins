// UI Rendering Engine

let selectedFlowNode = null;
let activeTraceIndex = 0;
let expandedSteps = new Set();

// Progress Display
function updateProgress(message, detail, percentage, stats = {}) {
  const panel = document.getElementById('resultPanel');
  let statsHtml = '';
  
  if (Object.keys(stats).length > 0) {
    statsHtml = '<div class="progress-stats">';
    for (const [key, value] of Object.entries(stats)) {
      statsHtml += `<div class="progress-stat"><div class="progress-stat-value">${value}</div><div>${key}</div></div>`;
    }
    statsHtml += '</div>';
  }
  
  // Animated journey preview during tracing
  const journeyPreview = stats.journeyPreview || '';
  
  panel.innerHTML = `
    <div class="progress-container">
      <div class="progress-spinner"></div>
      <div class="progress-message">${message}</div>
      ${detail ? `<div class="progress-detail">${detail}</div>` : ''}
      ${journeyPreview ? `<div class="story-path" style="justify-content:center;opacity:0.5;">${journeyPreview}</div>` : ''}
      <div class="progress-bar-container">
        <div class="progress-bar" style="width:${percentage}%"></div>
      </div>
      ${statsHtml}
    </div>
  `;
}

// Main Render Function
function renderMultiTraceResults(results) {
  const panel = document.getElementById('resultPanel');
  expandedSteps = new Set();
  
  let html = renderExportBar();
  html += renderTraceNavigation(results);
  html += renderCurrentTrace(results, activeTraceIndex);
  
  panel.innerHTML = html;
  
  // Show mobile action bar
  const mobileBar = document.getElementById('mobileActionBar');
  if (mobileBar) mobileBar.style.display = 'flex';
  
  // Setup interactions
  setTimeout(() => setupTraceInteractions(results, activeTraceIndex), 100);
}

function renderExportBar() {
  return `
    <div class="export-bar">
      <button class="btn-export-sm" onclick="exportResultsAsCSV()">📊 CSV</button>
      <button class="btn-export-sm" onclick="exportResultsAsJSON()">📋 JSON</button>
      <button class="btn-export-sm" onclick="exportResultsAsText()">📄 Text</button>
      <span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCallCount} calls</span>
    </div>
  `;
}

function renderTraceNavigation(results) {
  if (results.length <= 1) return '';
  
  let html = '<div class="trace-navigation">';
  html += `<button class="nav-btn" onclick="navigateTrace(-1)" ${activeTraceIndex === 0 ? 'disabled' : ''}>← Prev</button>`;
  
  html += '<div class="trace-dots">';
  results.forEach((result, i) => {
    let dotClass = 'trace-dot';
    if (i === activeTraceIndex) dotClass += ' active';
    if (result.foundCoinbase) dotClass += ' coinbase';
    html += `<div class="${dotClass}" onclick="switchToTrace(${i})" title="Trace ${i + 1}: ${getTraceSummary(result)}"></div>`;
  });
  html += '</div>';
  
  html += `<button class="nav-btn" onclick="navigateTrace(1)" ${activeTraceIndex === results.length - 1 ? 'disabled' : ''}>Next →</button>`;
  html += '</div>';
  
  return html;
}

function renderCurrentTrace(results, index) {
  const result = results[index];
  if (!result) return '<p style="color:var(--muted);">No results available.</p>';
  
  if (result.error) {
    return `<p style="color:#f87171;">❌ Error: ${result.error}</p>`;
  }
  
  if (!result.steps || result.steps.length === 0) {
    return '<p style="color:var(--muted);">No steps traced for this input.</p>';
  }
  
  let html = '';
  
  // 1. Coin Story Summary
  html += renderCoinStory(result);
  
  // 2. Journey Timeline
  html += renderJourneyTimeline(result);
  
  // 3. Phase Summary (if multiple phases)
  const phases = analyzeTracePhases(result.steps);
  if (phases.length > 1) {
    html += renderPhaseSummary(phases);
  }
  
  return html;
}

// Coin Story Summary
function renderCoinStory(result) {
  const steps = result.steps;
  const phases = analyzeTracePhases(steps);
  const storyPath = getStoryPath(phases);
  const confidence = calculateConfidence(result);
  const confidenceLabel = getConfidenceLabel(confidence);
  
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  const totalSpan = firstStep.blockTime && lastStep.blockTime ? 
    Math.round((parseInt(lastStep.blockTime) - parseInt(firstStep.blockTime)) / 86400000) : 0;
  
  // Count unique exchanges
  const exchanges = new Set();
  steps.forEach(s => {
    if (s.isExchangeAddress && lookupKnownAddress(s.address)) {
      exchanges.add(lookupKnownAddress(s.address).name);
    }
  });
  
  let html = `
    <div class="coin-story">
      <div class="story-header">
        <span class="story-title">🧬 Coin Story</span>
        <div class="confidence-badge">
          <span>Confidence</span>
          <div class="confidence-meter">
            ${renderConfidenceMeter(confidence)}
          </div>
          <span style="color:var(--accent);">${confidence}%</span>
          <span style="color:var(--muted);font-size:0.6rem;">${confidenceLabel}</span>
        </div>
      </div>
      
      <div class="story-path" id="storyPath">
        ${storyPath.map((node, i) => `
          <div class="path-node ${node.cssClass}">
            <div class="path-node-icon">${node.icon}</div>
            <div class="path-node-type">${node.type}</div>
            <div class="path-node-name">${node.exchangeName || ''}</div>
          </div>
          ${i < storyPath.length - 1 ? '<div class="path-arrow">→</div>' : ''}
        `).join('')}
      </div>
      
      <div class="story-stats">
        <div class="story-stat">
          <div class="story-stat-value">${steps.length}</div>
          <div class="story-stat-label">Transfers</div>
        </div>
        <div class="story-stat">
          <div class="story-stat-value">${exchanges.size}</div>
          <div class="story-stat-label">Exchanges</div>
        </div>
        <div class="story-stat">
          <div class="story-stat-value">${totalSpan}d</div>
          <div class="story-stat-label">Age</div>
        </div>
        <div class="story-stat">
          <div class="story-stat-value">${result.uniqueAddresses || new Set(steps.map(s => s.address)).size}</div>
          <div class="story-stat-label">Addresses</div>
        </div>
        <div class="story-stat">
          <div class="story-stat-value">${sompiToKAS(lastStep.amount)}</div>
          <div class="story-stat-label">Amount</div>
        </div>
        ${result.usedFastPath ? `
        <div class="story-stat">
          <div class="story-stat-value" style="color:${result.behavioralFastPathUsed ? 'var(--yellow)' : 'var(--purple)'};">⚡</div>
          <div class="story-stat-label">Fast-Path</div>
        </div>` : ''}
      </div>
    </div>
  `;
  
  return html;
}

function renderConfidenceMeter(confidence) {
  const segments = 10;
  const filledCount = Math.round(confidence / 10);
  let html = '';
  
  for (let i = 0; i < segments; i++) {
    html += `<div class="confidence-segment ${i < filledCount ? 'filled' : ''}"></div>`;
  }
  
  return html;
}

// Journey Timeline
function renderJourneyTimeline(result) {
  const steps = result.steps;
  
  let html = '<div class="journey-timeline" id="journeyTimeline">';
  
  steps.forEach((step, i) => {
    const phaseType = getStepPhaseType(step);
    const isExpanded = expandedSteps.has(i);
    const badgeClass = getStepBadgeClass(phaseType);
    const badgeLabel = getStepBadgeLabel(step);
    
    html += `
      <div class="journey-step ${phaseType}" id="journeyStep${i}">
        <div class="step-card" onclick="toggleStepDetails(${i})">
          <div class="step-card-header">
            <span class="step-type-badge ${badgeClass}">
              ${badgeLabel}
            </span>
            <span class="step-amount">${sompiToKAS(step.amount)} KAS</span>
          </div>
          
          <div class="step-details">
            <div class="step-detail-row">
              <span class="step-detail-label">Address</span>
              <span class="step-detail-value copy-inline" onclick="event.stopPropagation();navigator.clipboard.writeText('${step.address}')" title="${step.address}">
                ${resolveAddressDisplay(step.address)}
              </span>
            </div>
            <div class="step-detail-row">
              <span class="step-detail-label">Time</span>
              <span class="step-detail-value">${formatTime(step.blockTime)}</span>
            </div>
          </div>
          
          <button class="step-expand-btn" onclick="event.stopPropagation();toggleStepDetails(${i})">
            ${isExpanded ? '▲ Hide details' : '▼ Show details'}
          </button>
          
          <div class="step-expanded-content ${isExpanded ? 'visible' : ''}" id="stepExpanded${i}">
            <div class="step-detail-row">
              <span class="step-detail-label">Transaction</span>
              <span class="step-detail-value copy-inline" onclick="navigator.clipboard.writeText('${step.txId}')" title="${step.txId}">
                ${(step.txId || '').substring(0, 20)}...
              </span>
            </div>
            ${step.blockHash ? `
            <div class="step-detail-row">
              <span class="step-detail-label">Block</span>
              <span class="step-detail-value">${step.blockHash.substring(0, 16)}...</span>
            </div>` : ''}
            ${step.isCoinbase ? `
            <div class="step-detail-row">
              <span class="step-detail-label">Type</span>
              <span class="step-detail-value" style="color:var(--yellow);">⛏️ Mining Reward</span>
            </div>` : ''}
            ${step.invalidAddress ? `
            <div class="step-detail-row">
              <span class="step-detail-label">Warning</span>
              <span class="step-detail-value" style="color:var(--red);">⚠️ Invalid address format</span>
            </div>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  
  // Exchange cluster cards
  const exchangeRanges = findExchangeRanges(steps);
  exchangeRanges.forEach(range => {
    html += renderExchangeCluster(range, steps);
  });
  
  return html;
}

function renderExchangeCluster(range, steps) {
  const exchangeSteps = steps.slice(range.start, range.end + 1);
  const exchangeNames = new Set();
  exchangeSteps.forEach(s => {
    if (s.isExchangeAddress) {
      const info = lookupKnownAddress(s.address);
      if (info) exchangeNames.add(info.name);
    }
  });
  
  const hiddenCount = range.end - range.start - 2; // Show first and last
  
  return `
    <div class="exchange-cluster" style="margin: 1rem 0;">
      <div class="exchange-cluster-header">
        <span class="exchange-cluster-icon">🏦</span>
        <span class="exchange-cluster-name">
          ${Array.from(exchangeNames).join(', ') || 'Exchange Cluster'}
        </span>
      </div>
      <div class="exchange-cluster-stats">
        ${exchangeSteps.length} steps • ${hiddenCount > 0 ? `${hiddenCount} internal transfers hidden` : 'Fast-path enabled'}
      </div>
      <button class="exchange-cluster-toggle" onclick="scrollToExchangeSteps(${range.start}, ${range.end})">
        Show Internal Activity
      </button>
    </div>
  `;
}

// Phase Summary
function renderPhaseSummary(phases) {
  let html = `
    <div style="margin: 1rem 0;">
      <div style="font-size:0.65rem;color:var(--muted);margin-bottom:0.3rem;">📊 Journey Phases</div>
      <div class="phase-timeline">
  `;
  
  phases.forEach((phase, i) => {
    html += `
      <div class="phase-item ${getPhaseClass(phase.type)}">
        ${getPhaseLabel(phase.type, phase.exchangeName)}
        <span class="phase-step-range">Steps ${phase.startIdx + 1}-${phase.endIdx + 1}</span>
      </div>
    `;
    if (i < phases.length - 1) {
      html += '<div class="phase-arrow">→</div>';
    }
  });
  
  html += '</div></div>';
  return html;
}

// Helper Functions
function getStepPhaseType(step) {
  if (step.type === 'coinbase' || step.isCoinbase) return 'mining';
  if (step.isExchangeAddress || step.isBehavioralExchange) return 'exchange';
  return 'personal';
}

function getStepBadgeClass(phaseType) {
  const classes = {
    'mining': 'badge-mining',
    'exchange': 'badge-exchange',
    'personal': 'badge-personal'
  };
  return classes[phaseType] || 'badge-personal';
}

function getStepBadgeLabel(step) {
  if (step.type === 'coinbase' || step.isCoinbase) {
    return '⛏️ Mining Reward';
  }
  if (step.isExchangeAddress) {
    const info = lookupKnownAddress(step.address);
    return `🏦 ${info?.name || 'Exchange'}`;
  }
  if (step.isBehavioralExchange) {
    return '🧠 Exchange Activity';
  }
  return '💸 Transfer';
}

function findExchangeRanges(steps) {
  const ranges = [];
  let currentRange = null;
  
  steps.forEach((step, i) => {
    const isExchange = step.isExchangeAddress || step.isBehavioralExchange;
    
    if (isExchange) {
      if (!currentRange) {
        currentRange = { start: i, end: i };
      } else {
        currentRange.end = i;
      }
    } else {
      if (currentRange && currentRange.end - currentRange.start >= 2) {
        ranges.push({ ...currentRange });
      }
      currentRange = null;
    }
  });
  
  if (currentRange && currentRange.end - currentRange.start >= 2) {
    ranges.push(currentRange);
  }
  
  return ranges;
}

function getTraceSummary(result) {
  if (!result.steps || result.steps.length === 0) return 'Empty';
  const firstStep = result.steps[0];
  return firstStep.type === 'coinbase' ? 'Coinbase' : `${result.steps.length} steps`;
}

function toggleStepDetails(index) {
  const content = document.getElementById(`stepExpanded${index}`);
  const step = document.getElementById(`journeyStep${index}`);
  
  if (!content) return;
  
  if (expandedSteps.has(index)) {
    expandedSteps.delete(index);
    content.classList.remove('visible');
  } else {
    expandedSteps.add(index);
    content.classList.add('visible');
  }
  
  // Update button text
  const btn = step?.querySelector('.step-expand-btn');
  if (btn) {
    btn.textContent = expandedSteps.has(index) ? '▲ Hide details' : '▼ Show details';
  }
  
  // Scroll to step
  step?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function scrollToExchangeSteps(start, end) {
  for (let i = start; i <= end; i++) {
    expandedSteps.add(i);
  }
  
  // Re-render to show expanded steps
  if (multiTraceResults[activeTraceIndex]) {
    const result = multiTraceResults[activeTraceIndex];
    const panel = document.getElementById('resultPanel');
    const html = renderExportBar() + 
                 renderTraceNavigation(multiTraceResults) + 
                 renderCurrentTrace(multiTraceResults, activeTraceIndex);
    panel.innerHTML = html;
    setupTraceInteractions(multiTraceResults, activeTraceIndex);
    
    // Scroll to first exchange step
    setTimeout(() => {
      document.getElementById(`journeyStep${start}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}