// Behavioral Exchange Detection System

/**
 * Detect if a series of steps shows exchange-like behavior
 * even for addresses not in our known database
 */
function detectExchangeBehavior(steps, address) {
  if (!steps || steps.length < 3) return false;
  
  // Filter steps for this specific address
  const addressSteps = steps.filter(s => s.address === address);
  if (addressSteps.length < 5) return false; // Need at least 5 occurrences
  
  // Check for very large amounts (>1M KAS)
  const hasVeryLargeAmounts = addressSteps.some(s => 
    parseFloat(sompiToKAS(s.amount || 0)) >= 1000000
  );
  
  // Check for rapid timing (<30 second intervals)
  const hasRapidTiming = checkRapidTiming(addressSteps);
  
  // Check for alternating amounts pattern (order book matching)
  const hasAlternatingPattern = checkAlternatingAmounts(addressSteps);
  
  // Must have at least 2 of 3 indicators
  const indicators = [hasVeryLargeAmounts, hasRapidTiming, hasAlternatingPattern];
  const indicatorCount = indicators.filter(Boolean).length;
  
  return indicatorCount >= 2;
}

/**
 * Check if transfers happen at exchange-like speeds (<30 seconds)
 */
function checkRapidTiming(steps) {
  const timestamps = steps
    .filter(s => s.blockTime)
    .map(s => parseInt(s.blockTime));
  
  if (timestamps.length < 3) return false;
  
  let rapidIntervals = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const interval = Math.abs(timestamps[i] - timestamps[i - 1]) / 1000;
    if (interval < 30) rapidIntervals++;
  }
  
  return rapidIntervals >= 3;
}

/**
 * Check for alternating amounts pattern characteristic of exchange order matching
 */
function checkAlternatingAmounts(steps) {
  if (steps.length < 4) return false;
  
  const amounts = steps.map(s => parseFloat(sompiToKAS(s.amount || 0)));
  let alternations = 0;
  
  for (let i = 2; i < amounts.length; i++) {
    // Check if amount alternates: A, B, A, B pattern
    const diff1 = Math.abs(amounts[i] - amounts[i - 2]);
    const diff2 = Math.abs(amounts[i - 1] - amounts[i - 3] || 0);
    const threshold = Math.max(amounts[i], amounts[i - 2]) * 0.001; // 0.1% tolerance
    
    if (diff1 < threshold && diff2 < threshold && 
        Math.abs(amounts[i] - amounts[i - 1]) > threshold * 10) {
      alternations++;
    }
  }
  
  return alternations >= 3;
}

/**
 * Check if an address exhibits exchange-like behavior based on amount
 */
function isExchangeLike(addr, amount) {
  if (isExchangeAddress(addr)) return true;
  if (amount >= 1000000) return true;
  return false;
}