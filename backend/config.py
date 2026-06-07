"""Configuration for Kas Origins backend."""

API_BASE = "https://api.kaspa.org"

RATE_LIMIT = {
    "min_delay": 0.1,        # 100ms
    "max_delay": 5.0,        # 5s
    "backoff_factor": 2,
    "max_retries": 3,
    "calls_per_second": 8
}

TRACE_CONFIG = {
    "max_total_hops": 100,
    "max_attempts_per_segment": 30,
    "max_utxos_to_select": 5,
    "exchange_threshold": 100000 * 100000000,  # 100k KAS in sompi
    "dust_threshold": 1000,
    "address_transaction_limit": 20,
    "deep_search_limit": 50
}

UI_CONFIG = {
    "confidence_weights": {
        "coinbase_found": 40,
        "exchange_identified": 30,
        "complete_path": 20,
        "no_dead_ends": 10
    }
}
