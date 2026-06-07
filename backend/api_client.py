"""Async Kaspa API client with rate limiting."""

import asyncio
import time
import aiohttp
from backend.config import API_BASE, RATE_LIMIT, TRACE_CONFIG


class KaspaAPIClient:
    """Rate-limited async client for the Kaspa API."""
    
    def __init__(self):
        self.session: aiohttp.ClientSession | None = None
        self.api_call_count = 0
        self.last_call_time = 0
        self.consecutive_rate_limits = 0
        self.window_start = time.monotonic()
        self.calls_in_window = 0
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()
    
    async def _rate_limit(self):
        """Apply rate limiting before making a call."""
        now = time.monotonic()
        
        # Reset window if second has passed
        if now - self.window_start > 1.0:
            self.window_start = now
            self.calls_in_window = 0
        
        # Throttle if at limit
        if self.calls_in_window >= RATE_LIMIT["calls_per_second"]:
            wait = 1.0 - (now - self.window_start)
            if wait > 0:
                await asyncio.sleep(wait)
            self.window_start = time.monotonic()
            self.calls_in_window = 0
        
        # Minimum delay between calls
        time_since_last = now - self.last_call_time
        if time_since_last < RATE_LIMIT["min_delay"]:
            await asyncio.sleep(RATE_LIMIT["min_delay"] - time_since_last)
        
        # Backoff for rate limited responses
        if self.consecutive_rate_limits > 0:
            delay = min(
                RATE_LIMIT["min_delay"] * (RATE_LIMIT["backoff_factor"] ** self.consecutive_rate_limits),
                RATE_LIMIT["max_delay"]
            )
            await asyncio.sleep(delay)
        
        self.last_call_time = time.monotonic()
        self.calls_in_window += 1
        self.api_call_count += 1
    
    async def _fetch(self, url: str, retry_count: int = 0) -> dict | list | None:
        """Fetch from API with retries and rate limiting."""
        await self._rate_limit()
        
        try:
            async with self.session.get(url) as response:
                if response.status == 429:
                    self.consecutive_rate_limits += 1
                    if retry_count < RATE_LIMIT["max_retries"]:
                        await asyncio.sleep(2 * (retry_count + 1))
                        return await self._fetch(url, retry_count + 1)
                    return None
                
                if response.status == 503:
                    if retry_count < RATE_LIMIT["max_retries"]:
                        await asyncio.sleep(3 * (retry_count + 1))
                        return await self._fetch(url, retry_count + 1)
                    return None
                
                if self.consecutive_rate_limits > 0:
                    self.consecutive_rate_limits = max(0, self.consecutive_rate_limits - 1)
                
                return await response.json()
        except Exception:
            if retry_count < RATE_LIMIT["max_retries"]:
                await asyncio.sleep(1 * (retry_count + 1))
                return await self._fetch(url, retry_count + 1)
            return None
    
    async def get_transaction(self, tx_id: str) -> dict | None:
        """Fetch a transaction with inputs and outputs."""
        url = f"{API_BASE}/transactions/{tx_id}?inputs=true&outputs=true&resolve_previous_outpoints=light"
        return await self._fetch(url)
    
    async def get_address_utxos(self, address: str) -> list:
        """Fetch UTXOs for an address."""
        url = f"{API_BASE}/addresses/{address}/utxos"
        result = await self._fetch(url)
        return result if isinstance(result, list) else []
    
    async def get_address_transactions(self, address: str, limit: int = 20) -> list:
        """Fetch transaction history for an address."""
        url = f"{API_BASE}/addresses/{address}/full-transactions-page?limit={limit}"
        result = await self._fetch(url)
        
        if not isinstance(result, list):
            return []
        
        # Filter to transactions where this address received funds
        txs = []
        for tx in result:
            if tx.get("outputs"):
                for oi, out in enumerate(tx["outputs"]):
                    out_addr = out.get("script_public_key_address", "")
                    if out_addr == address and int(out.get("amount", 0)) > 0:
                        txs.append({
                            "transaction_id": tx["transaction_id"],
                            "output_index": oi,
                            "amount": int(out["amount"])
                        })
                        break
        return txs
    
    def get_call_count(self) -> int:
        """Get total API calls made."""
        return self.api_call_count
