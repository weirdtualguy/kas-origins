"""Phase analysis for coin tracing."""

from backend.utils import sompi_to_kas
from backend.behavioral import is_exchange_like
from backend.known_addresses import lookup_known_address


def analyze_trace_phases(steps: list) -> list:
    """Analyze trace steps and categorize into phases."""
    if not steps:
        return []
    
    phases = []
    current_phase = {
        "type": "unknown",
        "start_idx": 0,
        "addresses": set(),
        "start_amount": float(sompi_to_kas(steps[0].get("amount", 0))),
        "exchange_name": None
    }
    
    for i, step in enumerate(steps):
        amount = float(sompi_to_kas(step.get("amount", 0)))
        addr = step.get("address", "")
        is_coinbase = step.get("type") == "coinbase" or step.get("is_coinbase", False)
        exchange_name = _get_exchange_name(addr)
        is_exchange = is_exchange_like(addr, amount)
        
        # Determine step phase type
        if is_coinbase:
            step_phase = "mining"
        elif is_exchange:
            step_phase = "exchange"
        elif amount < 100 and current_phase["type"] == "exchange":
            step_phase = "distribution"
        elif amount < 1000 and not is_exchange:
            step_phase = "consolidation"
        else:
            step_phase = "exchange"
        
        if i == 0:
            current_phase["type"] = step_phase
            current_phase["exchange_name"] = exchange_name
        else:
            type_changed = step_phase != current_phase["type"]
            exchange_changed = (
                is_exchange and 
                exchange_name and 
                exchange_name != current_phase["exchange_name"]
            )
            entering_exchange = step_phase == "exchange" and current_phase["type"] != "exchange"
            leaving_exchange = step_phase == "distribution" and current_phase["type"] == "exchange"
            entering_mining = step_phase == "mining" and current_phase["type"] != "mining"
            
            if type_changed or exchange_changed or entering_exchange or leaving_exchange or entering_mining:
                phases.append({
                    "type": current_phase["type"],
                    "exchange_name": current_phase["exchange_name"],
                    "start_idx": current_phase["start_idx"],
                    "end_idx": i - 1,
                    "start_amount": current_phase["start_amount"],
                    "end_amount": float(sompi_to_kas(steps[i-1].get("amount", 0))),
                    "step_count": i - current_phase["start_idx"],
                    "addresses": list(current_phase["addresses"])
                })
                
                current_phase = {
                    "type": step_phase,
                    "start_idx": i,
                    "addresses": {addr},
                    "start_amount": amount,
                    "exchange_name": exchange_name
                }
            else:
                current_phase["addresses"].add(addr)
                if exchange_name and not current_phase["exchange_name"]:
                    current_phase["exchange_name"] = exchange_name
    
    # Add final phase
    phases.append({
        "type": current_phase["type"],
        "exchange_name": current_phase["exchange_name"],
        "start_idx": current_phase["start_idx"],
        "end_idx": len(steps) - 1,
        "start_amount": current_phase["start_amount"],
        "end_amount": float(sompi_to_kas(steps[-1].get("amount", 0))),
        "step_count": len(steps) - current_phase["start_idx"],
        "addresses": list(current_phase["addresses"])
    })
    
    return phases


def _get_exchange_name(addr: str) -> str | None:
    """Get exchange name from known addresses."""
    info = lookup_known_address(addr)
    return info["name"] if info else None


def get_phase_label(phase_type: str, exchange_name: str | None = None) -> str:
    """Get human-readable label for a phase type."""
    labels = {
        "mining": "⛏️ Mining",
        "consolidation": "🔄 Consolidation",
        "exchange": f"🏦 {exchange_name}" if exchange_name else "🏦 Exchange Activity",
        "distribution": "📤 Distribution",
        "unknown": "❓ Unknown"
    }
    return labels.get(phase_type, phase_type)


def get_phase_icon(phase_type: str) -> str:
    """Get icon for a phase type."""
    icons = {
        "mining": "⛏️",
        "consolidation": "🔄",
        "exchange": "🏦",
        "distribution": "📤",
        "unknown": "❓"
    }
    return icons.get(phase_type, "❓")


def get_story_path(phases: list) -> list:
    """Get simplified path for coin story display."""
    return [
        {
            "type": p["type"],
            "label": get_phase_label(p["type"], p.get("exchange_name")),
            "exchange_name": p.get("exchange_name"),
            "icon": get_phase_icon(p["type"])
        }
        for p in phases
    ]


def calculate_confidence(trace_result: dict) -> int:
    """Calculate confidence score for a trace result."""
    from backend.config import UI_CONFIG
    
    if not trace_result or trace_result.get("error"):
        return 0
    
    weights = UI_CONFIG["confidence_weights"]
    confidence = 0
    steps = trace_result.get("steps", [])
    
    if trace_result.get("found_coinbase"):
        confidence += weights["coinbase_found"]
    
    has_exchange = any(
        s.get("is_exchange_address") or s.get("is_behavioral_exchange")
        for s in steps
    )
    if has_exchange:
        confidence += weights["exchange_identified"]
    
    if steps and not any(s.get("type") == "dead_end" for s in steps):
        confidence += weights["complete_path"]
    
    if not trace_result.get("validation_warnings") and not trace_result.get("invalid_addresses"):
        confidence += weights["no_dead_ends"]
    
    return min(100, confidence)


def get_confidence_label(confidence: int) -> str:
    """Get label for confidence score."""
    if confidence >= 90:
        return "High"
    if confidence >= 60:
        return "Medium"
    if confidence >= 30:
        return "Low"
    return "Minimal"
