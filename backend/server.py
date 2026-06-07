"""Simple HTTP server for Kas Origins."""

import json
import re
import asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import os
import mimetypes
import traceback
import socket

from backend.api_client import KaspaAPIClient
from backend.tracer import KasOriginsTracer
from backend.phase_analysis import (
    analyze_trace_phases, get_phase_label, get_story_path,
    calculate_confidence, get_confidence_label
)
from backend.utils import sompi_to_kas, format_time
from backend.known_addresses import resolve_address_display


class KasOriginsHandler(BaseHTTPRequestHandler):
    
    # Increase timeout for long traces
    timeout = 120
    
    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            
            if parsed.path == "/api/health":
                self._send_json({"status": "ok", "version": "1.0.0"})
                return
            
            if parsed.path == "/" or parsed.path == "":
                self._serve_file("index.html")
                return
            
            if parsed.path == "/favicon.ico":
                self._send_error(404, "")
                return
            
            filepath = parsed.path.lstrip("/")
            if os.path.exists(filepath) and os.path.isfile(filepath):
                self._serve_file(filepath)
                return
            
            self._send_error(404, "Not found")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f"GET error: {e}")
    
    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            
            if parsed.path == "/api/trace":
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body)
                user_input = data.get("input", "").strip()
                
                print(f"\n🔍 Trace request: {user_input[:60]}...")
                
                if not user_input:
                    self._send_json({"error": "Please provide a TX ID or address"}, 400)
                    return
                
                # Run the async trace
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    result = loop.run_until_complete(self._do_trace(user_input))
                finally:
                    loop.close()
                
                print(f"✅ Trace complete: {len(result.get('traces', []))} traces, {result.get('api_calls', 0)} API calls")
                self._send_json(result)
                return
            
            self._send_json({"error": "Not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f"❌ POST error: {e}")
            traceback.print_exc()
            try:
                self._send_json({"error": str(e)}, 500)
            except:
                pass
    
    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self._send_cors_headers()
            self.end_headers()
        except:
            pass
    
    async def _do_trace(self, user_input: str) -> dict:
        async with KaspaAPIClient() as client:
            tracer = KasOriginsTracer(client)
            
            if re.match(r"^[a-f0-9]{64}$", user_input):
                print("  → Tracing transaction...")
                result = await tracer.trace_from_txid(user_input)
                return {
                    "traces": [self._format_result(result)],
                    "api_calls": client.get_call_count()
                }
            
            elif re.match(r"^kaspa:[a-z0-9]{61,63}$", user_input):
                print("  → Analyzing address UTXOs...")
                results = await tracer.trace_from_address(user_input)
                if not results:
                    return {
                        "traces": [],
                        "api_calls": client.get_call_count(),
                        "message": "No UTXOs found for this address."
                    }
                print(f"  → Found {len(results)} UTXOs to trace")
                return {
                    "traces": [self._format_result(r) for r in results],
                    "api_calls": client.get_call_count()
                }
            
            else:
                return {
                    "error": "Enter a valid 64-char TX ID or Kaspa address",
                    "api_calls": 0,
                    "traces": []
                }
    
    def _format_result(self, result: dict) -> dict:
        if result.get("error"):
            return {"error": result["error"], "steps": [], "phases": [], "story_path": []}
        
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
                "block_time": step.get("block_time"),
                "block_time_formatted": format_time(step.get("block_time")),
                "block_hash": step.get("block_hash")
            })
        
        return {
            "input": result.get("input", ""),
            "input_type": result.get("input_type", ""),
            "found_coinbase": result.get("found_coinbase", False),
            "total_hops": result.get("total_hops", 0),
            "unique_addresses": result.get("unique_addresses", 0),
            "confidence": confidence,
            "confidence_label": get_confidence_label(confidence),
            "used_fast_path": result.get("used_fast_path", False),
            "behavioral_fast_path_used": result.get("behavioral_fast_path_used", False),
            "phases": [
                {
                    "type": p["type"],
                    "label": get_phase_label(p["type"], p.get("exchange_name")),
                    "exchange_name": p.get("exchange_name"),
                    "start_idx": p["start_idx"],
                    "end_idx": p["end_idx"],
                    "step_count": p["step_count"]
                }
                for p in phases
            ],
            "story_path": get_story_path(phases),
            "steps": formatted_steps
        }
    
    def _send_json(self, data: dict, status: int = 200):
        try:
            response = json.dumps(data).encode()
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(response))
            self.end_headers()
            self.wfile.write(response)
        except (BrokenPipeError, ConnectionResetError):
            pass
    
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    
    def _serve_file(self, filepath: str):
        try:
            if not os.path.exists(filepath):
                self._send_error(404, "File not found")
                return
            
            mime_type, _ = mimetypes.guess_type(filepath)
            if mime_type is None:
                mime_type = "application/octet-stream"
            
            with open(filepath, "rb") as f:
                content = f.read()
            
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", len(content))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass
    
    def _send_error(self, code: int, message: str):
        try:
            self.send_response(code)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", 0)
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            pass
    
    def log_message(self, format, *args):
        # Only log important messages
        if "404" not in (args[0] if args else ""):
            print(f"[{self.log_date_time_string()}] {format % args}")


class ReusableTCPServer(HTTPServer):
    """Server that allows address reuse."""
    
    allow_reuse_address = True
    
    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()


def run_server(host="0.0.0.0", port=8000):
    server = ReusableTCPServer((host, port), KasOriginsHandler)
    print(f"\n🧬 Kas Origins server running at http://localhost:{port}")
    print("Open this URL in your browser\n")
    print("Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
