/**
 * Kas Origins - Frontend Application
 * Calls Python backend API for tracing
 */

// Backend API base URL
const BACKEND_URL = '';

let multiTraceResults = [];
let activeTraceIndex = 0;
let expandedSteps = new Set();
let currentAbortController = null;

// ========== API CALLS ==========

async function traceAPI(input) {
    const controller = new AbortController();
    currentAbortController = controller;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/trace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: input }),
            signal: controller.signal
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Trace failed');
        }
        
        return await response.json();
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw e;
    }
}

// ========== UI HELPERS ==========

function showToast(msg) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    
    const t = document.createElement('div');
    t.className = 'toast-notification';
    t.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:var(--surface);border:1px solid var(--accent);
        color:var(--text);padding:0.5rem 1rem;border-radius:12px;
        font-size:0.8rem;z-index:2000;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function updateProgress(message, detail, percentage) {
    const panel = document.getElementById('resultPanel');
    panel.innerHTML = `
        <div class="progress-container">
            <div class="progress-spinner"></div>
            <div class="progress-message">${message}</div>
            ${detail ? `<div class="progress-detail">${detail}</div>` : ''}
            <div class="progress-bar-container">
                <div class="progress-bar" style="width:${percentage}%"></div>
            </div>
            <div class="progress-stats">
                <div class="progress-stat">
                    <div class="progress-stat-value" id="progressApiCalls">0</div>
                    <div>API Calls</div>
                </div>
            </div>
        </div>
    `;
}

// ========== RENDER FUNCTIONS ==========

function renderResults(data) {
    const panel = document.getElementById('resultPanel');
    multiTraceResults = data.traces || [];
    expandedSteps = new Set();
    activeTraceIndex = 0;
    
    if (multiTraceResults.length === 0) {
        panel.innerHTML = `
            <div class="empty-state">
                <p style="color:var(--muted);">${data.message || 'No results found.'}</p>
            </div>
        `;
        return;
    }
    
    let html = renderExportBar(data.api_calls || 0);
    
    if (multiTraceResults.length > 1) {
        html += renderTraceNav();
    }
    
    html += renderTraceContent(multiTraceResults[0], 0);
    panel.innerHTML = html;
    
    // Show mobile action bar
    const mobileBar = document.getElementById('mobileActionBar');
    if (mobileBar) mobileBar.style.display = 'flex';
    
    setupMobileActions();
}

function renderExportBar(apiCalls) {
    return `
        <div class="export-bar">
            <button class="btn-export-sm" onclick="exportResultsAsCSV()">📊 CSV</button>
            <button class="btn-export-sm" onclick="exportResultsAsJSON()">📋 JSON</button>
            <button class="btn-export-sm" onclick="exportResultsAsText()">📄 Text</button>
            <span style="font-size:0.55rem;color:var(--muted);margin-left:auto;">API: ${apiCalls} calls</span>
        </div>
    `;
}

function renderTraceNav() {
    let html = '<div class="trace-navigation">';
    html += `<button class="nav-btn" onclick="navigateTrace(-1)" ${activeTraceIndex === 0 ? 'disabled' : ''}>← Prev</button>`;
    html += '<div class="trace-dots">';
    
    multiTraceResults.forEach((result, i) => {
        let cls = 'trace-dot';
        if (i === activeTraceIndex) cls += ' active';
        if (result.found_coinbase) cls += ' coinbase';
        html += `<div class="${cls}" onclick="switchToTrace(${i})"></div>`;
    });
    
    html += '</div>';
    html += `<button class="nav-btn" onclick="navigateTrace(1)" ${activeTraceIndex === multiTraceResults.length - 1 ? 'disabled' : ''}>Next →</button>`;
    html += '</div>';
    return html;
}

function renderTraceContent(result, index) {
    if (result.error) {
        return `<p style="color:#f87171;">❌ ${result.error}</p>`;
    }
    
    const steps = result.steps || [];
    if (steps.length === 0) {
        return '<p style="color:var(--muted);">No steps found.</p>';
    }
    
    let html = renderCoinStory(result);
    html += renderJourneyTimeline(result);
    
    const phases = result.phases || [];
    if (phases.length > 1) {
        html += renderPhaseSummary(phases);
    }
    
    return html;
}

function renderCoinStory(result) {
    const storyPath = result.story_path || [];
    const confidence = result.confidence || 0;
    const confidenceLabel = result.confidence_label || 'Unknown';
    const steps = result.steps || [];
    
    const firstStep = steps[0] || {};
    const lastStep = steps[steps.length - 1] || {};
    
    let totalSpan = 0;
    if (firstStep.block_time && lastStep.block_time) {
        totalSpan = Math.round((parseInt(lastStep.block_time) - parseInt(firstStep.block_time)) / 86400000);
    }
    
    // Count unique exchanges
    const exchanges = new Set();
    steps.forEach(s => {
        if (s.is_exchange_address && s.address) {
            exchanges.add(s.address_display || s.address);
        }
    });
    
    return `
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
            
            <div class="story-path">
                ${storyPath.map((node, i) => `
                    <div class="path-node ${getNodeClass(node.type)}">
                        <div class="path-node-icon">${node.icon || '❓'}</div>
                        <div class="path-node-type">${node.type || 'unknown'}</div>
                        ${node.exchange_name ? `<div class="path-node-name">${node.exchange_name}</div>` : ''}
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
                    <div class="story-stat-value">${result.unique_addresses || 0}</div>
                    <div class="story-stat-label">Addresses</div>
                </div>
                <div class="story-stat">
                    <div class="story-stat-value">${lastStep.amount_kas || '0'}</div>
                    <div class="story-stat-label">Amount</div>
                </div>
                ${result.used_fast_path ? `
                <div class="story-stat">
                    <div class="story-stat-value" style="color:${result.behavioral_fast_path_used ? 'var(--yellow)' : 'var(--purple)'};">⚡</div>
                    <div class="story-stat-label">Fast-Path</div>
                </div>` : ''}
            </div>
        </div>
    `;
}

function renderConfidenceMeter(confidence) {
    const segments = 10;
    const filled = Math.round(confidence / 10);
    let html = '';
    for (let i = 0; i < segments; i++) {
        html += `<div class="confidence-segment ${i < filled ? 'filled' : ''}"></div>`;
    }
    return html;
}

function renderJourneyTimeline(result) {
    const steps = result.steps || [];
    
    let html = '<div class="journey-timeline">';
    
    steps.forEach((step, i) => {
        const phaseType = getStepPhase(step);
        const badgeClass = `badge-${phaseType}`;
        const badgeLabel = getStepBadge(step);
        const isExpanded = expandedSteps.has(i);
        
        html += `
            <div class="journey-step ${phaseType}" id="journeyStep${i}">
                <div class="step-card" onclick="toggleStep(${i})">
                    <div class="step-card-header">
                        <span class="step-type-badge ${badgeClass}">${badgeLabel}</span>
                        <span class="step-amount">${step.amount_kas || '0'} KAS</span>
                    </div>
                    
                    <div class="step-details">
                        <div class="step-detail-row">
                            <span class="step-detail-label">Address</span>
                            <span class="step-detail-value copy-inline" onclick="event.stopPropagation();copyText('${step.address || ''}')">
                                ${step.address_display || step.address?.substring(0, 18) || 'Unknown'}
                            </span>
                        </div>
                        <div class="step-detail-row">
                            <span class="step-detail-label">Time</span>
                            <span class="step-detail-value">${step.block_time_formatted || '?'}</span>
                        </div>
                    </div>
                    
                    <button class="step-expand-btn" onclick="event.stopPropagation();toggleStep(${i})">
                        ${isExpanded ? '▲ Hide details' : '▼ Show details'}
                    </button>
                    
                    <div class="step-expanded-content ${isExpanded ? 'visible' : ''}" id="stepExpanded${i}">
                        <div class="step-detail-row">
                            <span class="step-detail-label">Transaction</span>
                            <span class="step-detail-value copy-inline" onclick="copyText('${step.tx_id || ''}')">
                                ${(step.tx_id || '').substring(0, 20)}...
                            </span>
                        </div>
                        ${step.block_hash ? `
                        <div class="step-detail-row">
                            <span class="step-detail-label">Block</span>
                            <span class="step-detail-value">${step.block_hash.substring(0, 16)}...</span>
                        </div>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    
    // Exchange clusters
    const ranges = findExchangeRanges(steps);
    ranges.forEach(range => {
        html += renderExchangeCluster(range, steps);
    });
    
    return html;
}

function renderExchangeCluster(range, steps) {
    const exchangeSteps = steps.slice(range.start, range.end + 1);
    const names = new Set();
    exchangeSteps.forEach(s => {
        if (s.is_exchange_address && s.address_display) {
            names.add(s.address_display);
        }
    });
    
    const hiddenCount = range.end - range.start - 1;
    
    return `
        <div class="exchange-cluster" style="margin:1rem 0;">
            <div class="exchange-cluster-header">
                <span class="exchange-cluster-icon">🏦</span>
                <span class="exchange-cluster-name">${Array.from(names).join(', ') || 'Exchange Cluster'}</span>
            </div>
            <div class="exchange-cluster-stats">
                ${exchangeSteps.length} steps • ${hiddenCount > 0 ? `${hiddenCount} internal transfers` : 'Fast-path enabled'}
            </div>
        </div>
    `;
}

function renderPhaseSummary(phases) {
    let html = `
        <div style="margin:1rem 0;">
            <div style="font-size:0.65rem;color:var(--muted);margin-bottom:0.3rem;">📊 Journey Phases</div>
            <div class="phase-timeline">
    `;
    
    phases.forEach((phase, i) => {
        html += `
            <div class="phase-item phase-${phase.type}">
                ${phase.label}
                <span class="phase-step-range">Steps ${phase.start_idx + 1}-${phase.end_idx + 1}</span>
            </div>
        `;
        if (i < phases.length - 1) {
            html += '<div class="phase-arrow">→</div>';
        }
    });
    
    html += '</div></div>';
    return html;
}

// ========== HELPER FUNCTIONS ==========

function getNodeClass(type) {
    const map = { 'mining': 'mining', 'exchange': 'exchange' };
    return map[type] || 'personal';
}

function getStepPhase(step) {
    if (step.is_coinbase) return 'mining';
    if (step.is_exchange_address || step.is_behavioral_exchange) return 'exchange';
    return 'personal';
}

function getStepBadge(step) {
    if (step.is_coinbase) return '⛏️ Mining Reward';
    if (step.is_exchange_address) return '🏦 Exchange';
    if (step.is_behavioral_exchange) return '🧠 Exchange Activity';
    return '💸 Transfer';
}

function findExchangeRanges(steps) {
    const ranges = [];
    let current = null;
    
    steps.forEach((step, i) => {
        const isExchange = step.is_exchange_address || step.is_behavioral_exchange;
        if (isExchange) {
            if (!current) current = { start: i, end: i };
            else current.end = i;
        } else {
            if (current && current.end - current.start >= 1) {
                ranges.push({...current});
            }
            current = null;
        }
    });
    
    if (current && current.end - current.start >= 1) {
        ranges.push(current);
    }
    
    return ranges;
}

function toggleStep(index) {
    if (expandedSteps.has(index)) {
        expandedSteps.delete(index);
    } else {
        expandedSteps.add(index);
    }
    
    const content = document.getElementById(`stepExpanded${index}`);
    if (content) {
        content.classList.toggle('visible');
    }
    
    const step = document.getElementById(`journeyStep${index}`);
    const btn = step?.querySelector('.step-expand-btn');
    if (btn) {
        btn.textContent = expandedSteps.has(index) ? '▲ Hide details' : '▼ Show details';
    }
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied! 📋'));
}

function setupMobileActions() {
    const result = multiTraceResults[activeTraceIndex];
    if (!result) return;
    
    const steps = result.steps || [];
    
    const btnOrigin = document.getElementById('btnJumpCoinbase');
    if (btnOrigin) {
        const idx = steps.findIndex(s => s.is_coinbase);
        btnOrigin.style.display = idx >= 0 ? 'flex' : 'none';
        if (idx >= 0) {
            btnOrigin.onclick = () => document.getElementById(`journeyStep${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    const btnExchange = document.getElementById('btnJumpExchange');
    if (btnExchange) {
        const idx = steps.findIndex(s => s.is_exchange_address);
        btnExchange.style.display = idx >= 0 ? 'flex' : 'none';
        if (idx >= 0) {
            btnExchange.onclick = () => document.getElementById(`journeyStep${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// ========== NAVIGATION ==========

function switchToTrace(index) {
    activeTraceIndex = index;
    expandedSteps = new Set();
    
    const panel = document.getElementById('resultPanel');
    let html = renderExportBar(multiTraceResults.length > 0 ? '?' : '0');
    
    if (multiTraceResults.length > 1) {
        html += renderTraceNav();
    }
    
    html += renderTraceContent(multiTraceResults[index], index);
    panel.innerHTML = html;
    
    setupMobileActions();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateTrace(dir) {
    const newIdx = activeTraceIndex + dir;
    if (newIdx >= 0 && newIdx < multiTraceResults.length) {
        switchToTrace(newIdx);
    }
}

// ========== EXPORT ==========

function exportResultsAsCSV() {
    if (!multiTraceResults.length) { showToast('No results'); return; }
    
    let csv = 'Trace #,Phase,TX ID,Type,Amount (KAS),Address,Block Time,Is Coinbase,FastPath\n';
    multiTraceResults.forEach((r, ti) => {
        (r.steps || []).forEach((s, si) => {
            const phase = (r.phases || []).find(p => si >= p.start_idx && si <= p.end_idx);
            csv += `"${ti+1}","${phase?.label || ''}","${s.tx_id}","${s.is_coinbase ? 'Mining' : 'Spent'}","${s.amount_kas}","${s.address}","${s.block_time_formatted}","${s.is_coinbase ? 'Yes' : 'No'}","${r.used_fast_path ? 'Yes' : 'No'}"\n`;
        });
    });
    
    downloadFile(csv, `kas-origins-${Date.now()}.csv`, 'text/csv');
    showToast('CSV exported');
}

function exportResultsAsJSON() {
    if (!multiTraceResults.length) { showToast('No results'); return; }
    
    const data = {
        export_time: new Date().toISOString(),
        total_traces: multiTraceResults.length,
        traces: multiTraceResults
    };
    
    downloadFile(JSON.stringify(data, null, 2), `kas-origins-${Date.now()}.json`, 'application/json');
    showToast('JSON exported');
}

function exportResultsAsText() {
    if (!multiTraceResults.length) { showToast('No results'); return; }
    
    let text = '═══════════════════\n  KAS ORIGINS REPORT\n═══════════════════\n\n';
    
    multiTraceResults.forEach((r, i) => {
        text += `📊 TRACE #${i+1}\n${'─'.repeat(30)}\n`;
        text += `Confidence: ${r.confidence}% (${r.confidence_label})\n`;
        text += `Coinbase: ${r.found_coinbase ? '✅ Yes' : '❌ No'}\n`;
        text += `Fast-Path: ${r.used_fast_path ? '⚡ Yes' : 'No'}\n\n`;
        
        (r.steps || []).forEach((s, si) => {
            text += `  Step ${si+1}: ${s.amount_kas} KAS | ${s.address_display}\n`;
            text += `  TX: ${s.tx_id}\n`;
            text += `  Time: ${s.block_time_formatted}\n\n`;
        });
    });
    
    downloadFile(text, `kas-origins-${Date.now()}.txt`, 'text/plain');
    showToast('Text exported');
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

// ========== MAIN TRACE BUTTON ==========

document.getElementById('btnTrace').addEventListener('click', async () => {
    const input = document.getElementById('mainInput').value.trim();
    
    if (!input) {
        showToast('Please enter a TX ID or Kaspa address');
        return;
    }
    
    document.getElementById('btnTrace').disabled = true;
    document.getElementById('btnCancel').style.display = 'inline-block';
    
    updateProgress('Tracing coin lineage...', 'Contacting server', 20);
    
    try {
        const data = await traceAPI(input);
        renderResults(data);
    } catch (e) {
        if (e.name === 'AbortError') {
            document.getElementById('resultPanel').innerHTML = '<div class="empty-state"><p style="color:var(--muted);">⚠️ Trace cancelled.</p></div>';
        } else {
            document.getElementById('resultPanel').innerHTML = `<div class="empty-state"><p style="color:#f87171;">❌ ${e.message}</p></div>`;
        }
    } finally {
        document.getElementById('btnTrace').disabled = false;
        document.getElementById('btnCancel').style.display = 'none';
        document.getElementById('mobileActionBar').style.display = 'none';
    }
});

document.getElementById('btnCancel').addEventListener('click', () => {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    document.getElementById('btnTrace').disabled = false;
    document.getElementById('btnCancel').style.display = 'none';
});

// Enter key triggers trace
document.getElementById('mainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnTrace').click();
});

// Example badges
document.querySelectorAll('.example-badge').forEach(badge => {
    badge.addEventListener('click', function() {
        const addr = this.getAttribute('data-address');
        if (addr) {
            document.getElementById('mainInput').value = addr;
        }
    });
});

// Expose to global scope
window.switchToTrace = switchToTrace;
window.navigateTrace = navigateTrace;
window.toggleStep = toggleStep;
window.copyText = copyText;
window.exportResultsAsCSV = exportResultsAsCSV;
window.exportResultsAsJSON = exportResultsAsJSON;
window.exportResultsAsText = exportResultsAsText;
