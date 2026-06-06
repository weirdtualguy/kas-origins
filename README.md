🧬 Kas Origins

Every coin has a story.

Discover where your KAS came from.

Kas Origins is a coin lineage explorer for the Kaspa network. It traces the journey of coins through wallets, exchanges, consolidations, and mining rewards, transforming raw blockchain data into a readable story.

Whether you're a miner, researcher, builder, or simply curious about your coins, Kas Origins helps uncover their history.

"Status" (https://img.shields.io/badge/status-active-success)
"License" (https://img.shields.io/badge/license-MIT-blue)
"Platform" (https://img.shields.io/badge/platform-web-brightgreen)

---

✨ Features

🔍 Deep Coin Tracing

Follow coins backward through the Kaspa BlockDAG to uncover their origin.

🏦 Exchange Detection

Recognizes known exchange wallets including:

- MEXC
- KuCoin
- Bybit
- Kraken
- Gate.io
- CoinEx
- Bitget
- Bitvavo
- Uphold
- PionexUS

🧠 Behavioral Exchange Detection

Identifies exchange-like activity even when addresses are not part of the known exchange database.

⚡ Smart Fast-Path Tracing

Automatically skips internal exchange movements to produce cleaner and faster traces.

📊 Phase Analysis

Classifies coin movement into meaningful phases:

- ⛏️ Mining
- 🏦 Exchange Activity
- 🔄 Consolidation
- 📤 Distribution

🗺️ Coin Story Visualization

See a coin's history as a chronological journey instead of a raw transaction list.

📱 Mobile Friendly

Designed to work smoothly across desktop, tablet, and mobile devices.

📋 Export Results

Export traces as:

- CSV
- JSON
- Text Reports

---

🚀 Quick Start

Clone the repository:

git clone https://github.com/weirdtualguy/kas-origins.git
cd kas-origins

Open "index.html" in your browser.

No installation required.

---

📖 Usage

Trace a Transaction

Paste a transaction ID to trace the history of a specific coin.

Trace an Address

Paste a Kaspa address to analyze wallet UTXOs and discover where those coins originated.

Understand the Results

🧬 Coin Story

A high-level summary of the coin's journey.

📍 Journey Timeline

A chronological view of each step in the trace.

📊 Phase Analysis

Detects movement patterns such as mining, exchange activity, consolidation, and distribution.

🎯 Confidence Score

Estimates the reliability and completeness of the trace.

---

🏦 Supported Exchanges

Kas Origins currently recognizes wallets associated with:

- MEXC
- Gate.io
- KuCoin
- Bybit
- Kraken
- Bitget
- CoinEx
- Bitvavo
- Uphold
- PionexUS

In addition to behavioral detection for unidentified exchange clusters.

---

⚙️ How It Works

Kas Origins combines multiple tracing techniques to reconstruct coin history:

Known Exchange Recognition

Matches addresses against a curated database of known custodial wallets.

Behavioral Analysis

Detects unknown exchanges using:

- Large transfer patterns
- Rapid transaction timing
- Repetitive movement behavior
- Consolidation characteristics

Smart Path Selection

Prioritizes meaningful ownership changes while reducing noise from internal exchange transfers.

Phase Classification

Groups activity into higher-level phases that make traces easier to understand.

---

🔧 API

Powered by:

https://api.kaspa.org

Built-in protections include:

- Rate limiting
- Automatic retry handling
- Exponential backoff
- Request throttling

---

🤝 Contributing

Contributions are welcome.

Found a new exchange wallet?

Open an issue or submit a pull request.

Example format:

"kaspa:q..." : {
  name: "Exchange Name",
  type: "exchange",
  category: "cex"
}

---

💰 Support

If Kas Origins helped you, consider supporting its development:

kaspa:qp4ljl85vxf6wfj5m46txm9rdnnxdrjwm53wzjhh2we83u2fs8xm5mk5rknv0

---

👤 Creator

Built by WeirdtualGuy

- X: https://x.com/weirdtualguy
- GitHub: https://github.com/weirdtualguy

---

📄 License

MIT License.

See the LICENSE file for details.

---

⚠️ Disclaimer

Kas Origins attempts to reconstruct the historical path of coins using publicly available blockchain data.

Some traces may be incomplete due to:

- Exchange wallet shuffling
- Custodial aggregation
- Privacy-preserving techniques
- Incomplete attribution data
- API limitations

Confidence scores should be treated as estimates, not guarantees.

---

Made with 🧬 for the Kaspa community.