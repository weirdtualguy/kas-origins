"""FastAPI server for Kas Origins."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os

from backend.api_client import KaspaAPIClient
from backend.tracer import KasOriginsTracer
from backend.phase_analysis import (
    analyze_trace_phases, get_phase_label, get_story_path,
    calculate_confidence, get_confidence_label
)
from backend.utils import sompi_to_kas, format_time
from backend.known_addresses import resolve_address_display, is_exchange_address

app = FastAPI(title="Kas Origins API", version="1.0.0")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TraceRequest(BaseModel):
    input: str


@app.get("/")
async def root():
    """Serve the main HTML file."""
    return FileResponse("index.html")


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/trace")
async def trace(request: TraceRequest):
    """Trace a transaction or address."""
    import re
    
    user_input = request.input.strip()
    
    if not user_input:
        raise HTTPException(status_code=400, detail="Please provide a TX ID or address")
    
    async with KaspaAPIClient() as client:
        tracer = KasOriginsTracer(client)
        
        try:
            # TX ID (64 hex chars)
            if re.match(r"^[a-f0-9]{64}$", user_input):
                result = await tracer.trace_from_txid(user_input)
                return {
                    "traces": [format_trace_result(result)],
                    "api_calls": client.get_call_count()
                }
            
            # Kaspa address
            elif re.match(r"^kaspa:[a-z0-9]{61,63}$", user_input):
                results = await tracer.trace_from_address(user_input)
                if not results:
                    return {
                        "traces": [],
                        "api_calls": client.get_call_count(),
                        "message": "No UTXOs or transactions found for this address."
                    }
                return {
                    "traces": [format_trace_result(r) for r in results],
                    "api_calls": client.get_call_count()
                }
            
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Enter a valid 64-char TX ID or Kaspa address (e.g., kaspa:qq...)"
                )
        
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


def format_trace_result(result: dict) -> dict:
    """Format a trace result for API response."""
    if result.get("error"):
        return {"error": result["error"]}
    
    steps = result.get("steps", [])
    phases = analyze_trace_phases(steps)
    confidence = calculate_confidence(result)
    
    formatted_steps = []
    for step in steps:
        addr = step.get("address", "")
        formatted_steps.append({
            "tx_id": step.get("tx_id", ""),
            "type": step.get("type", "unknown"),
            "is_coinbase": step.get("is_coinbase", False),
            "amount_sompi": step.get("amount", 0),
            "amount_kas": sompi_to_kas(step.get("amount", 0)),
            "address": addr,
            "address_display": resolve_address_display(addr),
            "is_exchange_address": step.get("is_exchange_address", False),
            "is_behavioral_exchange": step.get("is_behavioral_exchange", False),
            "invalid_address": step.get("invalid_address", False),
            "block_time": step.get("block_time"),
            "block_time_formatted": format_time(step.get("block_time")),
            "block_hash": step.get("block_hash")
        })
    
    formatted_phases = []
    for p in phases:
        formatted_phases.append({
            "type": p["type"],
            "label": get_phase_label(p["type"], p.get("exchange_name")),
            "exchange_name": p.get("exchange_name"),
            "start_idx": p["start_idx"],
            "end_idx": p["end_idx"],
            "step_count": p["step_count"],
            "start_amount": p["start_amount"],
            "end_amount": p["end_amount"],
            "address_count": len(p.get("addresses", []))
        })
    
    return {
        "input": result.get("input", ""),
        "input_type": result.get("input_type", ""),
        "found_coinbase": result.get("found_coinbase", False),
        "total_hops": result.get("total_hops", 0),
        "unique_addresses": result.get("unique_addresses", 0),
        "segments": result.get("segments", 0),
        "fast_path_hops_saved": result.get("fast_path_hops_saved", 0),
        "used_fast_path": result.get("used_fast_path", False),
        "behavioral_fast_path_used": result.get("behavioral_fast_path_used", False),
        "confidence": confidence,
        "confidence_label": get_confidence_label(confidence),
        "validation_warnings": result.get("validation_warnings", []),
        "invalid_addresses": result.get("invalid_addresses", []),
        "phases": formatted_phases,
        "story_path": get_story_path(phases),
        "steps": formatted_steps
    }


# Serve static files
if os.path.exists("css"):
    app.mount("/css", StaticFiles(directory="css"), name="css")
if os.path.exists("js"):
    app.mount("/js", StaticFiles(directory="js"), name="js")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
