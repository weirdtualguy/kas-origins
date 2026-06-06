// API Configuration
const API_BASE = 'https://api.kaspa.org';

// Rate Limiting Configuration
const RATE_LIMIT = {
  minDelay: 100,
  maxDelay: 5000,
  backoffFactor: 2,
  maxRetries: 3,
  callsPerSecond: 8
};

// Tracing Configuration
const TRACE_CONFIG = {
  maxTotalHops: 100,
  maxAttemptsPerSegment: 30,
  maxUTXOsToSelect: 5,
  exchangeThreshold: 100000 * 1e8,
  dustThreshold: 1000,
  addressTransactionLimit: 20,
  deepSearchLimit: 50
};

// UI Configuration
const UI_CONFIG = {
  maxPathNodesInStory: 6,
  stepsPerPage: 5,
  confidenceWeights: {
    coinbaseFound: 40,
    exchangeIdentified: 30,
    completePath: 20,
    noDeadEnds: 10
  }
};