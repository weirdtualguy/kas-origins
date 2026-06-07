"""Utility functions for Kas Origins."""

import re
from datetime import datetime


def sompi_to_kas(sompi) -> str:
    """Convert sompi to KAS with 6 decimal places."""
    try:
        n = int(sompi) if isinstance(sompi, str) else sompi
        return f"{n / 100000000:.6f}"
    except (ValueError, TypeError):
        return "0.000000"


def format_time(ts) -> str:
    """Format a timestamp to readable string."""
    if not ts:
        return "?"
    try:
        return datetime.fromtimestamp(int(ts) / 1000).strftime("%m/%d/%Y, %I:%M:%S %p")
    except (ValueError, TypeError, OSError):
        return "?"


def is_valid_kaspa_address(address: str) -> bool:
    """Check if a string is a valid Kaspa address."""
    if not address or address == "Unknown":
        return False
    return bool(re.match(r"^kaspa:[a-z0-9]{61,63}$", address))


def is_coinbase_transaction(tx: dict) -> bool:
    """Check if a transaction is a coinbase (mining reward)."""
    inputs = tx.get("inputs") or []
    
    # No inputs
    if len(inputs) == 0:
        return True
    
    # Single empty input
    if len(inputs) == 1:
        inp = inputs[0]
        if not inp.get("previous_outpoint_hash") and not inp.get("signature_script"):
            return True
    
    # Coinbase marker
    if inputs[0].get("previous_outpoint_hash") == "0000000000000000000000000000000000000000000000000000000000000000":
        return True
    
    return False


def validate_output_index(tx: dict, output_index: int) -> dict:
    """Validate that an output index exists in a transaction."""
    outputs = tx.get("outputs") or []
    max_index = len(outputs) - 1
    
    if output_index < 0:
        return {"valid": False, "max_index": max_index, "message": f"Negative output index: {output_index}"}
    if output_index > max_index:
        return {"valid": False, "max_index": max_index, "message": f"Output index {output_index} out of bounds (max: {max_index})"}
    
    return {"valid": True, "max_index": max_index, "message": ""}


def sanitize_steps(steps: list) -> dict:
    """Sanitize trace steps and flag invalid addresses."""
    invalid_addresses = []
    
    for i, step in enumerate(steps):
        addr = step.get("address", "")
        if addr and addr != "Unknown":
            if not is_valid_kaspa_address(addr):
                invalid_addresses.append({
                    "step_index": i,
                    "address": addr,
                    "tx_id": step.get("tx_id", "")
                })
                step["invalid_address"] = True
    
    return {"steps": steps, "invalid_addresses": invalid_addresses}


def classify_utxos(utxos: list) -> list:
    """Classify UTXOs into categories."""
    from backend.config import TRACE_CONFIG
    
    classified = []
    for utxo in utxos:
        entry = utxo.get("utxoEntry", {})
        amount = int(entry.get("amount", 0))
        is_coinbase = entry.get("isCoinbase", False)
        block_daa_score = int(entry.get("blockDaaScore", 0))
        address = utxo.get("address", "")
        
        from backend.known_addresses import is_exchange_address
        
        if is_coinbase:
            category = "mining_reward"
        elif amount >= TRACE_CONFIG["exchange_threshold"] or is_exchange_address(address):
            category = "exchange_custodial"
        elif amount <= TRACE_CONFIG["dust_threshold"]:
            category = "dust"
        elif amount >= 1000 * 100000000:
            category = "large_personal"
        elif amount >= 10 * 100000000:
            category = "medium_personal"
        else:
            category = "small_personal"
        
        classified.append({
            **utxo,
            "amount": amount,
            "category": category,
            "block_daa_score": block_daa_score,
            "is_coinbase": is_coinbase
        })
    
    return classified


def select_personal_utxos(classified: list, max_count: int = 5) -> list:
    """Select the most interesting UTXOs for tracing."""
    mining_rewards = [u for u in classified if u["category"] == "mining_reward"]
    medium_personal = [u for u in classified if u["category"] == "medium_personal"]
    small_personal = [u for u in classified if u["category"] == "small_personal"]
    large_personal = [u for u in classified if u["category"] == "large_personal"]
    
    selected = []
    
    if mining_rewards:
        mining_rewards.sort(key=lambda u: u["block_daa_score"], reverse=True)
        selected.extend(mining_rewards[:min(3, max_count)])
    
    if len(selected) < max_count and medium_personal:
        medium_personal.sort(key=lambda u: u["block_daa_score"], reverse=True)
        selected.extend(medium_personal[:max_count - len(selected)])
    
    if len(selected) < max_count and small_personal:
        small_personal.sort(key=lambda u: u["amount"])
        selected.extend(small_personal[:max_count - len(selected)])
    
    if len(selected) < 3 and large_personal:
        large_personal.sort(key=lambda u: u["amount"])
        selected.extend(large_personal[:3 - len(selected)])
    
    if len(selected) == 0:
        valid = [u for u in classified if u["category"] not in ("exchange_custodial", "dust")]
        valid.sort(key=lambda u: u["amount"])
        if valid:
            selected.append(valid[0])
    
    return selected[:max_count]
