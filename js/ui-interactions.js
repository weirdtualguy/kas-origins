// UI Interactions and Event Handlers

function setupTraceInteractions(results, index) {
  setupMobileActionBar(results, index);
  setupClickListeners();
}

function setupMobileActionBar(results, index) {
  const mobileBar = document.getElementById('mobileActionBar');
  if (!mobileBar || !results || !results[index]) return;
  
  const result = results[index];
  const steps = result.steps || [];
  
  // Jump to Coinbase
  const btnJumpCoinbase = document.getElementById('btnJumpCoinbase');
  if (btnJumpCoinbase) {
    const coinbaseIndex = steps.findIndex(s => s.type === 'coinbase' || s.isCoinbase);
    if (coinbaseIndex >= 0) {
      btnJumpCoinbase.style.display = 'flex';
      btnJumpCoinbase.onclick = () => {
        document.getElementById(`journeyStep${coinbaseIndex}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      };
    } else {
      btnJumpCoinbase.style.display = 'none';
    }
  }
  
  // Jump to Exchange
  const btnJumpExchange = document.getElementById('btnJumpExchange');
  if (btnJumpExchange) {
    const exchangeIndex = steps.findIndex(s => s.isExchangeAddress);
    if (exchangeIndex >= 0) {
      btnJumpExchange.style.display = 'flex';
      btnJumpExchange.onclick = () => {
        document.getElementById(`journeyStep${exchangeIndex}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      };
    } else {
      btnJumpExchange.style.display = 'none';
    }
  }
}

function setupClickListeners() {
  // Copy-to-clipboard for all copy-inline elements
  document.querySelectorAll('.copy-inline').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = el.getAttribute('title') || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied! 📋');
      });
    });
  });
}

function navigateTrace(direction) {
  const newIndex = activeTraceIndex + direction;
  if (newIndex >= 0 && newIndex < multiTraceResults.length) {
    switchToTrace(newIndex);
  }
}

function switchToTrace(index) {
  activeTraceIndex = index;
  expandedSteps = new Set();
  
  if (multiTraceResults[index]) {
    const panel = document.getElementById('resultPanel');
    const html = renderExportBar() + 
                 renderTraceNavigation(multiTraceResults) + 
                 renderCurrentTrace(multiTraceResults, index);
    panel.innerHTML = html;
    
    setupTraceInteractions(multiTraceResults, index);
    
    // Scroll to top of results
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Toast notification
function showToast(msg) {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) existingToast.remove();
  
  const t = document.createElement('div');
  t.className = 'toast-notification';
  t.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--accent);
    color: var(--text);
    padding: 0.5rem 1rem;
    border-radius: 12px;
    font-size: 0.8rem;
    z-index: 2000;
    backdrop-filter: blur(10px);
    animation: fadeInUp 0.3s ease;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'fadeOutDown 0.3s ease';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// Add toast animations
const toastStyles = document.createElement('style');
toastStyles.textContent = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  @keyframes fadeOutDown {
    from { opacity: 1; transform: translateX(-50%) translateY(0); }
    to { opacity: 0; transform: translateX(-50%) translateY(10px); }
  }
`;
document.head.appendChild(toastStyles);

// Main trace button handler
document.getElementById('btnTrace').addEventListener('click', async () => {
  const input = document.getElementById('mainInput').value.trim();
  
  if (!input) {
    showToast('Please enter a transaction ID or address');
    return;
  }
  
  // Reset
  apiCallCount = 0;
  updateRateLimitIndicator('ok', 'Starting...');
  
  document.getElementById('btnTrace').disabled = true;
  document.getElementById('btnCancel').style.display = 'flex';
  
  selectedFlowNode = null;
  multiTraceResults = [];
  expandedSteps = new Set();
  
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  
  try {
    if (/^[a-f0-9]{64}$/.test(input)) {
      await traceLifecycleSingle(input, 0, signal);
    } else if (/^kaspa:[a-z0-9]{61,63}$/.test(input)) {
      await traceFromAddress(input, signal);
    } else {
      showToast('Enter a valid 64-char TX ID or Kaspa address (kaspa:qq...)');
      document.getElementById('btnTrace').disabled = false;
      document.getElementById('btnCancel').style.display = 'none';
    }
  } catch (e) {
    document.getElementById('resultPanel').innerHTML = e.name === 'AbortError' ? 
      '<div class="empty-state"><p style="color:var(--muted);">⚠️ Trace cancelled.</p></div>' : 
      `<div class="empty-state"><p style="color:#f87171;">Error: ${e.message}</p></div>`;
  } finally {
    document.getElementById('btnTrace').disabled = false;
    document.getElementById('btnCancel').style.display = 'none';
    currentAbortController = null;
    updateRateLimitIndicator('ok', `Done (${apiCallCount} calls)`);
  }
});

// Cancel button
document.getElementById('btnCancel').addEventListener('click', () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  
  document.getElementById('btnTrace').disabled = false;
  document.getElementById('btnCancel').style.display = 'none';
  document.getElementById('resultPanel').innerHTML = `
    <div class="empty-state">
      <p style="color:var(--muted);">⚠️ Trace cancelled.</p>
    </div>
  `;
  document.getElementById('mobileActionBar').style.display = 'none';
  updateRateLimitIndicator('ok', 'Idle');
});

// Keyboard shortcut for trace
document.getElementById('mainInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btnTrace').click();
  }
});

// Expose functions globally
window.switchToTrace = switchToTrace;
window.navigateTrace = navigateTrace;
window.toggleStepDetails = toggleStepDetails;
window.scrollToExchangeSteps = scrollToExchangeSteps;
window.exportResultsAsCSV = exportResultsAsCSV;
window.exportResultsAsJSON = exportResultsAsJSON;
window.exportResultsAsText = exportResultsAsText;
window.showToast = showToast;