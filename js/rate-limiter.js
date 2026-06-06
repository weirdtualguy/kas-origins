// Rate Limiting System

let apiCallCount = 0;
let lastApiCallTime = 0;
let consecutiveRateLimits = 0;
let rateLimitWindowStart = Date.now();
let callsInCurrentWindow = 0;
let currentAbortController = null;

function updateRateLimitIndicator(status, message) {
  const indicator = document.getElementById('rateLimitIndicator');
  const statusEl = document.getElementById('rateLimitStatus');
  const countEl = document.getElementById('apiCallCount');
  
  if (indicator) indicator.className = 'rate-limit-indicator ' + status;
  if (statusEl) statusEl.textContent = status === 'ok' ? 'OK' : status === 'warning' ? '⚠️' : '❌';
  if (countEl && apiCallCount > 0) countEl.textContent = apiCallCount;
}

async function rateLimitedFetch(url, options = {}, retryCount = 0) {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  
  const now = Date.now();
  
  // Reset window if second has passed
  if (now - rateLimitWindowStart > 1000) {
    rateLimitWindowStart = now;
    callsInCurrentWindow = 0;
  }
  
  // Throttle if at limit
  if (callsInCurrentWindow >= RATE_LIMIT.callsPerSecond) {
    const waitTime = 1000 - (now - rateLimitWindowStart);
    if (waitTime > 0) {
      updateRateLimitIndicator('warning', 'Throttling');
      await sleep(waitTime);
    }
    rateLimitWindowStart = Date.now();
    callsInCurrentWindow = 0;
  }
  
  // Enforce minimum delay between calls
  const timeSinceLastCall = now - lastApiCallTime;
  if (timeSinceLastCall < RATE_LIMIT.minDelay) {
    await sleep(RATE_LIMIT.minDelay - timeSinceLastCall);
  }
  
  // Backoff for rate limited responses
  if (consecutiveRateLimits > 0) {
    const backoffDelay = Math.min(
      RATE_LIMIT.minDelay * Math.pow(RATE_LIMIT.backoffFactor, consecutiveRateLimits),
      RATE_LIMIT.maxDelay
    );
    await sleep(backoffDelay);
  }
  
  lastApiCallTime = Date.now();
  callsInCurrentWindow++;
  apiCallCount++;
  updateRateLimitIndicator('ok', `${apiCallCount} calls`);
  
  try {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      consecutiveRateLimits++;
      updateRateLimitIndicator('error', 'Rate limited!');
      if (retryCount < RATE_LIMIT.maxRetries) {
        const waitTime = 2000 * (retryCount + 1);
        await sleep(waitTime);
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
    
    if (consecutiveRateLimits > 0) {
      consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
    }
    
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