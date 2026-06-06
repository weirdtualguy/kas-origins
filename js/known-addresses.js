// Known Addresses Database
const KNOWN_ADDRESSES = {
  "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": { name: "MEXC", type: "exchange", category: "cex" },
  "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": { name: "Gate.io", type: "exchange", category: "cex" },
  "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m": { name: "KuCoin 1", type: "exchange", category: "cex" },
  "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk": { name: "KuCoin 2", type: "exchange", category: "cex" },
  "kaspa:qpq94ntnvy8p9q6wrdwtn37xtspgashrydc0kuu8ctpyxulmh0wlxh2807zdh": { name: "KuCoin 3", type: "exchange", category: "cex" },
  "kaspa:qq3k4du6wf2g26j7ds6fqmgtgavgm3zy676wntp2e52nsuns2n4s6xkndmx0y": { name: "KuCoin 4", type: "exchange", category: "cex" },
  "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges": { name: "Bybit", type: "exchange", category: "cex" },
  "kaspa:qzxrs8gxjgk2q84wlt3xfd057ntws73fptalhy84g85zqfu5lcemvpu04vj3w": { name: "Uphold 1", type: "exchange", category: "cex" },
  "kaspa:qr7vrlhgekw9efxgfq09ca3wqcxlslgxndcpk77pguu2usaa9aa27lhuunewj": { name: "Uphold 2", type: "exchange", category: "cex" },
  "kaspa:qqfxn597v5c23td4asz99ky52sha8l2ypq8kmrsqxcu7skhdunncjgup0hdys": { name: "Bitvavo 1", type: "exchange", category: "cex" },
  "kaspa:qzxs23g7txh3wq9d0t2z0hluhsflvzpf6d0yfum830ppumgtxa5d7zqca8r67": { name: "Bitvavo 2", type: "exchange", category: "cex" },
  "kaspa:qz4kt3t0qzpmpcgle28mgudu6lpu0fel6rgn0y2p808l8em7gd2exnss8cr2t": { name: "Bitvavo 3", type: "exchange", category: "cex" },
  "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle": { name: "Kraken", type: "exchange", category: "cex" },
  "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j": { name: "Bitget", type: "exchange", category: "cex" },
  "kaspa:qyp90geyzyp56p4zqd87flxrwd64r557r2cwkuwxzuq9zxehmswcg8g54jmeu7p": { name: "PionexUS", type: "exchange", category: "cex" },
  "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": { name: "CoinEx", type: "exchange", category: "cex" },
  "kaspa:qq3wrlkeustm5sxg2w8x5m8w2h2s8w2h2s8w2h2s8w2h2s8w2h2s8w2h2s8w": { name: "Unknown Exchange (Linked to CoinEx)", type: "exchange", category: "cex", tentative: true },
};

function lookupKnownAddress(address) {
  if (!address) return null;
  return KNOWN_ADDRESSES[address] || null;
}

function resolveAddressDisplay(address) {
  const known = lookupKnownAddress(address);
  if (known) {
    return `${known.type === 'exchange' ? '🏦' : '📋'} ${known.name}`;
  }
  return address ? `${address.substring(0, 18)}...` : 'Unknown';
}

function isExchangeAddress(address) {
  const info = lookupKnownAddress(address);
  return info?.type === 'exchange';
}