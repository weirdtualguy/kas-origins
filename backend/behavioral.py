"""Behavioral exchange detection for unknown addresses."""

from backend.utils import sompi_to_kas


def detect_exchange_behavior(steps: list, address: str) -> bool:
    """Detect if a series of steps shows exchange-like behavior."""
    if not steps or len(steps) < 3:
        return False
    
    # Filter steps for this specific address
    address_steps = [s for s in steps if s.get("address") == address]
    if len(address_steps) < 5:
        return False
    
    # Check for very large amounts (>1M KAS)
    has_very_large = any(
        float(sompi_to_kas(s.get("amount", 0))) >= 1000000
        for s in address_steps
    )
    
    # Check for rapid timing (<30 second intervals)
    has_rapid = _check_rapid_timing(address_steps)
    
    # Check for alternating amounts pattern
    has_alternating = _check_alternating_amounts(address_steps)
    
    # Need at least 2 of 3 indicators
    indicators = [has_very_large, has_rapid, has_alternating]
    return sum(1 for i in indicators if i) >= 2


def _check_rapid_timing(steps: list) -> bool:
    """Check if transfers happen at exchange-like speeds (<30 seconds)."""
    timestamps = []
    for s in steps:
        bt = s.get("block_time")
        if bt:
            try:
                timestamps.append(int(bt))
            except (ValueError, TypeError):
                pass
    
    if len(timestamps) < 3:
        return False
    
    rapid_count = 0
    for i in range(1, len(timestamps)):
        interval = abs(timestamps[i] - timestamps[i-1]) / 1000
        if interval < 30:
            rapid_count += 1
    
    return rapid_count >= 3


def _check_alternating_amounts(steps: list) -> bool:
    """Check for alternating amounts pattern (order book matching)."""
    if len(steps) < 4:
        return False
    
    amounts = [float(sompi_to_kas(s.get("amount", 0))) for s in steps]
    alternations = 0
    
    for i in range(2, len(amounts)):
        diff1 = abs(amounts[i] - amounts[i-2])
        diff2 = abs(amounts[i-1] - (amounts[i-3] if i >= 3 else 0))
        threshold = max(amounts[i], amounts[i-2]) * 0.001  # 0.1% tolerance
        
        if diff1 < threshold and diff2 < threshold and abs(amounts[i] - amounts[i-1]) > threshold * 10:
            alternations += 1
    
    return alternations >= 3


def is_exchange_like(address: str, amount: float) -> bool:
    """Check if an address exhibits exchange-like behavior based on amount."""
    from backend.known_addresses import is_exchange_address
    
    if is_exchange_address(address):
        return True
    if amount >= 1000000:
        return True
    return False
