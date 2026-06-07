"""Core tracing engine for Kas Origins."""

import asyncio
from backend.api_client import KaspaAPIClient
from backend.utils import (
    sompi_to_kas, is_coinbase_transaction, validate_output_index,
    sanitize_steps, is_valid_kaspa_address, classify_utxos,
    select_personal_utxos, format_time
)
from backend.known_addresses import is_exchange_address, lookup_known_address
from backend.behavioral import detect_exchange_behavior, is_exchange_like
from backend.phase_analysis import analyze_trace_phases, calculate_confidence
from backend.config import TRACE_CONFIG


class KasOriginsTracer:
    
    def __init__(self, client: KaspaAPIClient):
        self.client = client
        self.multi_trace_results = []
    
    async def trace_from_txid(self, tx_id: str, output_index: int = 0) -> dict:
        print(f"  → Tracing TX: {tx_id[:16]}...")
        result = await self._trace_lifecycle(tx_id, output_index, auto_continue=True)
        result["input"] = tx_id
        result["input_type"] = "txid"
        self.multi_trace_results = [result]
        print(f"  → Steps: {len(result.get('steps', []))}, coinbase: {result.get('found_coinbase')}")
        return result
    
    async def trace_from_address(self, address: str) -> list:
        print(f"  → Fetching UTXOs for {address[:20]}...")
        utxos = await self.client.get_address_utxos(address)
        print(f"  → Found {len(utxos)} UTXOs")
        
        if not utxos:
            txs = await self.client.get_address_transactions(address)
            if txs:
                reasonable = [tx for tx in txs if tx["amount"] < 1000000 * 100000000]
                reasonable.sort(key=lambda tx: tx["amount"])
                results = []
                for i, tx in enumerate(reasonable[:3]):
                    result = await self._trace_lifecycle(tx["transaction_id"], tx["output_index"], auto_continue=True)
                    result["input"] = f"{address} (TX: {sompi_to_kas(tx['amount'])} KAS)"
                    result["input_type"] = "address_tx"
                    results.append(result)
                    await asyncio.sleep(0.05)
                self.multi_trace_results = results
                return results
            return []
        
        classified = classify_utxos(utxos)
        selected = select_personal_utxos(classified, TRACE_CONFIG["max_utxos_to_select"])
        
        if not selected:
            return []
        
        results = []
        for i, utxo in enumerate(selected):
            outpoint = utxo.get("outpoint", {})
            tx_id = outpoint.get("transactionId", "")
            idx = outpoint.get("index", 0)
            result = await self._trace_lifecycle(tx_id, idx, auto_continue=True)
            result["input"] = f"{address} (UTXO)"
            result["input_type"] = "address_utxo"
            results.append(result)
            await asyncio.sleep(0.1)
        
        self.multi_trace_results = results
        return results
    
    async def _trace_lifecycle(self, tx_id: str, output_index: int, auto_continue: bool = True) -> dict:
        all_lifecycle = []
        global_visited = set()
        validation_warnings = []
        fast_path_hops_saved = 0
        behavioral_fast_path_used = False
        
        current_tx_id = tx_id
        current_index = output_index
        total_hops = 0
        segment_number = 0
        max_total_hops = TRACE_CONFIG["max_total_hops"]
        max_attempts = TRACE_CONFIG["max_attempts_per_segment"]
        
        while current_tx_id and total_hops < max_total_hops:
            segment_number += 1
            segment_lifecycle = []
            segment_visited = set()
            backward_tx_id = current_tx_id
            backward_index = current_index
            origin_found = False
            attempts = 0
            
            while not origin_found and attempts < max_attempts and total_hops < max_total_hops:
                attempts += 1
                total_hops += 1
                
                if total_hops % 20 == 0:
                    print(f"    → {total_hops} hops, {self.client.get_call_count()} API calls...")
                
                key = f"{backward_tx_id}:{backward_index}"
                if key in segment_visited or key in global_visited:
                    break
                segment_visited.add(key)
                global_visited.add(key)
                
                tx = await self.client.get_transaction(backward_tx_id)
                if not tx:
                    break
                
                validation = validate_output_index(tx, backward_index)
                if not validation["valid"]:
                    validation_warnings.append({
                        "type": "output_bounds", "tx_id": backward_tx_id,
                        "index": backward_index, "message": validation["message"]
                    })
                    segment_lifecycle.insert(0, {
                        "tx_id": backward_tx_id, "type": "dead_end", "amount": 0,
                        "address": "Invalid_Output_Index", "block_time": tx.get("block_time"),
                        "block_hash": (tx.get("block_hash") or [None])[0],
                        "is_coinbase": False
                    })
                    origin_found = True
                    break
                
                inputs = tx.get("inputs") or []
                inp = inputs[backward_index] if backward_index < len(inputs) else None
                
                if not inp or not inp.get("previous_outpoint_hash"):
                    is_cb = is_coinbase_transaction(tx)
                    outputs = tx.get("outputs") or []
                    out_addr = "Unknown"
                    if backward_index < len(outputs):
                        out_addr = outputs[backward_index].get("script_public_key_address", "Unknown")
                    
                    step = {
                        "tx_id": backward_tx_id,
                        "type": "coinbase" if is_cb else "dead_end",
                        "amount": outputs[backward_index].get("amount", 0) if backward_index < len(outputs) else 0,
                        "address": out_addr,
                        "block_time": tx.get("block_time"),
                        "block_hash": (tx.get("block_hash") or [None])[0],
                        "is_coinbase": is_cb,
                        "is_exchange_address": is_exchange_address(out_addr),
                        "is_behavioral_exchange": False
                    }
                    segment_lifecycle.insert(0, step)
                    origin_found = True
                    
                    if is_cb:
                        print(f"    ⛏️ Coinbase at hop {total_hops}!")
                    
                    if not is_cb and backward_index < len(outputs):
                        segment_lifecycle[0]["continue_address"] = outputs[backward_index].get("script_public_key_address")
                    break
                
                prev_addr = inp.get("previous_outpoint_address", "Unknown")
                
                segment_lifecycle.insert(0, {
                    "tx_id": backward_tx_id,
                    "type": "spend",
                    "amount": inp.get("previous_outpoint_amount", 0),
                    "address": prev_addr,
                    "block_time": tx.get("block_time"),
                    "block_hash": (tx.get("block_hash") or [None])[0],
                    "is_exchange_address": is_exchange_address(prev_addr),
                    "is_behavioral_exchange": False
                })
                
                backward_tx_id = inp["previous_outpoint_hash"]
                backward_index = int(inp.get("previous_outpoint_index", 0))
                await asyncio.sleep(0.03)
            
            if segment_lifecycle:
                if all_lifecycle:
                    all_lifecycle.append({"type": "separator"})
                all_lifecycle.extend(segment_lifecycle)
            
            if not auto_continue:
                break
            
            last_step = segment_lifecycle[0] if segment_lifecycle else None
            if (last_step and last_step.get("continue_address") and 
                not last_step.get("is_coinbase") and total_hops < max_total_hops):
                
                addr = last_step.get("continue_address", "")
                print(f"    → Continue from {addr[:30]}...")
                
                # CHECK: is this a known exchange?
                exchange_info = lookup_known_address(addr)
                
                if exchange_info and exchange_info.get("type") == "exchange":
                    print(f"    🏦 Exchange detected: {exchange_info['name']} - FAST PATH")
                    found = await self._exchange_fast_path(
                        all_lifecycle, last_step, global_visited, exchange_info
                    )
                    if found:
                        current_tx_id = found["tx_id"]
                        current_index = found["index"]
                        fast_path_hops_saved += found.get("hops_saved", 0)
                        all_lifecycle.append({
                            "type": "message",
                            "text": f"⚡ Fast-path: Skipped {exchange_info['name']} internal transfers"
                        })
                        continue
                
                # CHECK: behavioral exchange?
                recent = [s for s in all_lifecycle if s.get("type") in ("spend", "coinbase", "dead_end")]
                if detect_exchange_behavior(recent, addr):
                    print(f"    🧠 Behavioral exchange detected - FAST PATH")
                    found = await self._behavioral_fast_path(
                        all_lifecycle, last_step, global_visited, recent
                    )
                    if found:
                        current_tx_id = found["tx_id"]
                        current_index = found["index"]
                        fast_path_hops_saved += found.get("hops_saved", 0)
                        behavioral_fast_path_used = True
                        all_lifecycle.append({
                            "type": "message",
                            "text": "⚡ Behavioral fast-path: Skipped unknown exchange transfers"
                        })
                        continue
                
                # Strategy: try other addresses in same tx
                found = await self._find_continuation(all_lifecycle, last_step, global_visited)
                if found:
                    current_tx_id = found["tx_id"]
                    current_index = found["index"]
                    continue
                
                print(f"    → No continuation found")
                all_lifecycle.append({"type": "message", "text": "🔚 All strategies exhausted"})
                break
            else:
                break
            
            await asyncio.sleep(0.05)
        
        real_steps = [s for s in all_lifecycle if s.get("type") not in ("separator", "message")]
        real_steps.sort(key=lambda s: int(s.get("block_time", 0)) if s.get("block_time") else 0)
        sanitized = sanitize_steps(real_steps)
        
        return {
            "steps": sanitized["steps"],
            "all_lifecycle": all_lifecycle,
            "found_coinbase": any(s.get("type") == "coinbase" or s.get("is_coinbase") for s in sanitized["steps"]),
            "total_hops": total_hops,
            "segments": segment_number,
            "unique_addresses": len(set(s.get("address", "") for s in sanitized["steps"])),
            "validation_warnings": validation_warnings,
            "invalid_addresses": sanitized["invalid_addresses"],
            "fast_path_hops_saved": fast_path_hops_saved,
            "used_fast_path": fast_path_hops_saved > 0,
            "behavioral_fast_path_used": behavioral_fast_path_used,
            "error": None
        }
    
    async def _exchange_fast_path(self, all_lifecycle, last_step, visited, exchange_info):
        """Skip exchange internal transfers by finding external inputs."""
        tx = await self.client.get_transaction(last_step["tx_id"])
        if not tx or not tx.get("inputs"):
            return None
        
        dead_time = int(last_step.get("block_time", 0)) if last_step.get("block_time") else 0
        
        # Get ALL inputs, prefer non-exchange ones
        all_inputs = []
        for inp in tx["inputs"]:
            inp_addr = inp.get("previous_outpoint_address", "")
            inp_hash = inp.get("previous_outpoint_hash", "")
            inp_idx = int(inp.get("previous_outpoint_index", 0))
            inp_key = f"{inp_hash}:{inp_idx}"
            
            if not inp_hash or inp_key in visited:
                continue
            
            is_exch = is_exchange_address(inp_addr)
            all_inputs.append({
                "tx_id": inp_hash,
                "index": inp_idx,
                "address": inp_addr,
                "is_exchange": is_exch,
                "key": inp_key
            })
        
        if not all_inputs:
            return None
        
        # Sort: non-exchange first
        all_inputs.sort(key=lambda x: x["is_exchange"])
        
        # Try non-exchange inputs first
        for inp in all_inputs:
            if not inp["is_exchange"]:
                print(f"    ⚡ External input found: {inp['address'][:20]}...")
                return {
                    "tx_id": inp["tx_id"],
                    "index": inp["index"],
                    "hops_saved": 10
                }
        
        # If ALL inputs are exchange, pick one and add marker
        # But only if it's a DIFFERENT exchange
        first = all_inputs[0]
        if first["is_exchange"]:
            inp_info = lookup_known_address(first["address"])
            if inp_info and inp_info.get("name") != exchange_info.get("name"):
                print(f"    → Different exchange: {inp_info['name']}")
                return {
                    "tx_id": first["tx_id"],
                    "index": first["index"],
                    "hops_saved": 0
                }
        
        return None
    
    async def _behavioral_fast_path(self, all_lifecycle, last_step, visited, recent_steps):
        """Skip behavioral exchange internal transfers."""
        tx = await self.client.get_transaction(last_step["tx_id"])
        if not tx or not tx.get("inputs"):
            return None
        
        external = []
        for inp in tx["inputs"]:
            addr = inp.get("previous_outpoint_address", "")
            amt = float(sompi_to_kas(inp.get("previous_outpoint_amount", 0)))
            key = f"{inp.get('previous_outpoint_hash', '')}:{inp.get('previous_outpoint_index', 0)}"
            
            if key in visited or not inp.get("previous_outpoint_hash"):
                continue
            
            if not detect_exchange_behavior(recent_steps, addr) and amt < 1000000:
                external.append({
                    "tx_id": inp["previous_outpoint_hash"],
                    "index": int(inp.get("previous_outpoint_index", 0)),
                    "address": addr
                })
        
        if external:
            print(f"    ⚡ Behavioral external: {external[0]['address'][:20]}...")
            return {
                "tx_id": external[0]["tx_id"],
                "index": external[0]["index"],
                "hops_saved": 15
            }
        
        return None
    
    async def _find_continuation(self, all_lifecycle, last_step, visited):
        """Try to find continuation through other addresses in the dead-end tx."""
        addr = last_step.get("continue_address", "")
        tx_id = last_step.get("tx_id", "")
        dead_time = int(last_step.get("block_time", 0)) if last_step.get("block_time") else 0
        
        # Strategy 1: Same address history
        txs = await self.client.get_address_transactions(addr, 20)
        if isinstance(txs, list):
            for ht in txs:
                key = f"{ht['transaction_id']}:{ht.get('output_index', 0)}"
                ht_time = int(ht.get("block_time", 0)) if ht.get("block_time") else 0
                if key not in visited and (ht_time == 0 or dead_time == 0 or ht_time <= dead_time):
                    return {"tx_id": ht["transaction_id"], "index": ht.get("output_index", 0)}
        
        # Strategy 2: Other outputs from same tx
        tx = await self.client.get_transaction(tx_id)
        if tx and tx.get("outputs"):
            for oi, out in enumerate(tx["outputs"]):
                out_addr = out.get("script_public_key_address", "")
                if not out_addr or out_addr == addr:
                    continue
                if is_exchange_address(out_addr):
                    continue
                if int(out.get("amount", 0)) <= 0:
                    continue
                
                key = f"{tx_id}:{oi}"
                if key in visited:
                    continue
                
                branch_txs = await self.client.get_address_transactions(out_addr, 20)
                if isinstance(branch_txs, list):
                    for bt in branch_txs:
                        b_key = f"{bt['transaction_id']}:{bt.get('output_index', 0)}"
                        b_time = int(bt.get("block_time", 0)) if bt.get("block_time") else 0
                        if b_key not in visited and (b_time == 0 or dead_time == 0 or b_time <= dead_time):
                            return {"tx_id": bt["transaction_id"], "index": bt.get("output_index", 0)}
                await asyncio.sleep(0.02)
        
        # Strategy 3: Input addresses (prefer non-exchange)
        if tx and tx.get("inputs"):
            inputs = list(tx["inputs"])
            inputs.sort(key=lambda i: is_exchange_address(i.get("previous_outpoint_address", "")))
            
            for inp in inputs:
                if inp.get("previous_outpoint_hash"):
                    key = f"{inp['previous_outpoint_hash']}:{inp.get('previous_outpoint_index', 0)}"
                    if key not in visited:
                        return {
                            "tx_id": inp["previous_outpoint_hash"],
                            "index": int(inp.get("previous_outpoint_index", 0))
                        }
        
        # Strategy 4: Deep search
        all_txs = await self.client.get_address_transactions(addr, TRACE_CONFIG["deep_search_limit"])
        if isinstance(all_txs, list):
            all_txs.sort(key=lambda tx: tx.get("block_time", 0) if tx.get("block_time") else 0)
            for ot in all_txs:
                key = f"{ot['transaction_id']}:{ot.get('output_index', 0)}"
                ot_time = int(ot.get("block_time", 0)) if ot.get("block_time") else 0
                if key not in visited and (ot_time == 0 or dead_time == 0 or ot_time <= dead_time):
                    return {"tx_id": ot["transaction_id"], "index": ot.get("output_index", 0)}
        
        return None
