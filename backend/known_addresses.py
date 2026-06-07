KNOWN_ADDRESSES = {
    "kaspa:qpzpfwcsqsxhxwup26r55fd0ghqlhyugz8cp6y3wxuddc02vcxtjg75pspnwz": {"name":"MEXC","type":"exchange","category":"cex"},
    "kaspa:qrelgny7sr3vahq69yykxx36m65gvmhryxrlwngfzgu8xkdslum2yxjp3ap8m": {"name":"Gate.io","type":"exchange","category":"cex"},
    "kaspa:qzadxjufntvckxrvy76pyhvtkuu8lg5ryz252aglmhlyv27pxqplksshzuu9m": {"name":"KuCoin 1","type":"exchange","category":"cex"},
    "kaspa:qr8k05f9n6xtrd0eex5lr6878mc5n7dgrtn8xv3frfvuxgfchx9077jtz5tsk": {"name":"KuCoin 2","type":"exchange","category":"cex"},
    "kaspa:qrvum29vk365g0zcd5gx3c7h829etfq2ytdmscjzw4zw04fjfnprcg9c3tges": {"name":"Bybit","type":"exchange","category":"cex"},
    "kaspa:qphfy7yfwyj7uqw2q6v924q6xcsstfhdz70cdm7ewnzqt98r2x6jydujg6gle": {"name":"Kraken","type":"exchange","category":"cex"},
    "kaspa:qqywx2wszmnrsu0mzgav85rdwvzangfpdj9j3ady9jpr7hu4u8c2wl9wqgd6j": {"name":"Bitget","type":"exchange","category":"cex"},
    "kaspa:qpqpyavkqnp60q6t4sfctz4yp3n0ct963z65rxkd5ft32vkehnd3wx8jqctr2": {"name":"CoinEx","type":"exchange","category":"cex"},
    "kaspa:qq3wrlkeustmu5uuh6r3mrmkly88x3mg4wajc7ktxmqfnqptkfxaqgu47jq8n": {"name":"CoinEx Hot Wallet","type":"exchange","category":"cex"},
    "kaspa:qpgqlempmc7cq70e6thcahjvv6w8j6pexfult5n470ptvvxr8gec2re6jd38r": {"name":"CoinEx Cluster","type":"exchange","category":"cex"},
    "kaspa:qp9z8a0w7jedatvpr3l0knc6l0vdlpz7sp9kcd4yqq0up9hp87q4zyzr5ave9": {"name":"Exchange Cluster","type":"exchange","category":"cex"},
    "kaspa:qqlwf0skcfcfuy3qem3fp9z0q9ztqvyx2rp8xrw56uwtpqqu4ek3pdtja0hgp": {"name":"Exchange Cluster 2","type":"exchange","category":"cex"},
    "kaspa:qz2hu3q2r7rlpat9e0d35ly0ywlk4g60ymfnlq8c22g9r6p4g6kj6nsnlzgw7": {"name":"Exchange Cluster 3","type":"exchange","category":"cex"},
    "kaspa:qqmux7aq4r6vtytyprvl69l8gh9x6qrmdc8qwua5azc076yfdla8jz3zvt84r": {"name":"Exchange Cluster 4","type":"exchange","category":"cex"},
}

def lookup_known_address(address: str) -> dict | None:
    if not address: return None
    return KNOWN_ADDRESSES.get(address)

def resolve_address_display(address: str) -> str:
    known = lookup_known_address(address)
    if known: return f"{'🏦' if known['type']=='exchange' else '📋'} {known['name']}"
    return f"{address[:18]}..." if address else "Unknown"

def is_exchange_address(address: str) -> bool:
    info = lookup_known_address(address)
    return info is not None and info.get("type") == "exchange"
