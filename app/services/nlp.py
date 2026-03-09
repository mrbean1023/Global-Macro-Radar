"""
NLP utilities for the Macro Intelligence Platform.
Keyword-based theme mapping, region tagging, sentiment scoring, asset class detection.
"""
from typing import List, Dict, Tuple

# ── Theme keyword mapping ─────────────────────────────────────────────────────
THEME_KEYWORDS: Dict[str, List[str]] = {
    "sticky_inflation": [
        "inflation", "cpi", "consumer price", "price index", "core inflation",
        "pce", "cost of living", "wage growth", "sticky prices", "disinflation",
        "hyperinflation", "deflation", "price pressure", "inflationary",
    ],
    "oil_supply_shock": [
        "oil", "opec", "crude", "barrel", "brent", "wti", "petroleum",
        "energy crisis", "oil supply", "production cut", "oil price",
        "natural gas", "lng", "energy shock", "fuel",
    ],
    "cb_divergence": [
        "federal reserve", "fed", "ecb", "boj", "bank of england", "boe",
        "rate hike", "rate cut", "interest rate", "monetary policy",
        "quantitative easing", "qe", "qt", "tightening", "dovish", "hawkish",
        "pivot", "fomc", "central bank", "basis points", "bps",
    ],
    "ai_capex_boom": [
        "artificial intelligence", " ai ", "semiconductor", "chips", "nvidia",
        "data center", "capex", "machine learning", "gpu", "tech spending",
        "cloud computing", "generative ai", "llm", "openai", "compute",
    ],
    "geopolitical_flashpoints": [
        "geopolitical", "war", "conflict", "sanctions", "nato", "military",
        "missile", "nuclear", "tension", "invasion", "defense", "defence",
        "alliance", "diplomacy", "ceasefire", "escalation",
    ],
    "china_stabilization": [
        "china", "beijing", "yuan", "renminbi", "pboc", "property crisis",
        "evergrande", "chinese economy", "xi jinping", "chinese stock",
        "shanghai", "shenzhen", "hong kong", "chinese exports",
    ],
    "fiscal_expansion": [
        "fiscal", "government spending", "deficit", "stimulus", "infrastructure",
        "national debt", "budget", "fiscal policy", "public spending",
        "debt ceiling", "treasury", "bond issuance", "fiscal deficit",
    ],
    "climate_transition": [
        "climate", "esg", "carbon", "renewable", "green energy", "solar",
        "wind power", "electric vehicle", "ev", "emission", "net zero",
        "sustainability", "clean energy", "carbon tax", "paris agreement",
    ],
}

# Theme ID → display name
THEME_NAMES: Dict[str, str] = {
    "sticky_inflation": "Sticky Inflation",
    "oil_supply_shock": "Oil Supply Shock",
    "cb_divergence": "CB Divergence",
    "ai_capex_boom": "AI Capex Boom",
    "geopolitical_flashpoints": "Geopolitical Flashpoints",
    "china_stabilization": "China Stabilization",
    "fiscal_expansion": "Fiscal Expansion",
    "climate_transition": "Climate Transition",
}

# Theme → default asset_classes
THEME_ASSET_CLASSES: Dict[str, List[str]] = {
    "sticky_inflation": ["Bonds", "TIPS", "Gold"],
    "oil_supply_shock": ["Energy", "Airlines", "Commodities"],
    "cb_divergence": ["FX", "Rates", "Bonds"],
    "ai_capex_boom": ["Tech", "Semiconductors", "Utilities"],
    "geopolitical_flashpoints": ["Defense", "Gold", "Oil"],
    "china_stabilization": ["EM Equities", "Commodities", "FX"],
    "fiscal_expansion": ["Bonds", "Infrastructure", "Equities"],
    "climate_transition": ["Clean Energy", "Utilities", "EVs"],
}

# ── Region keyword mapping ────────────────────────────────────────────────────
REGION_KEYWORDS: Dict[str, List[str]] = {
    "US": [
        "united states", "u.s.", "us ", "america", "fed", "federal reserve",
        "wall street", "nasdaq", "s&p", "dow jones", "treasury", "dollar",
        "washington", "biden", "trump", "congress", "white house",
    ],
    "EU": [
        "europe", "european", "eurozone", "eu ", "ecb", "euro ",
        "brussels", "france", "germany", "berlin", "paris",
    ],
    "UK": [
        "united kingdom", "u.k.", "uk ", "britain", "british",
        "bank of england", "boe", "london", "sterling", "pound",
    ],
    "JP": [
        "japan", "japanese", "boj", "bank of japan", "tokyo", "yen",
        "nikkei",
    ],
    "CN": [
        "china", "chinese", "beijing", "shanghai", "pboc", "yuan",
        "renminbi", "shenzhen", "hong kong",
    ],
    "ASIA": [
        "asia", "asian", "india", "korea", "asean", "singapore",
        "indonesia", "thailand", "vietnam", "pacific",
    ],
    "ME": [
        "middle east", "saudi", "opec", "iran", "iraq", "uae",
        "gulf", "riyadh", "dubai", "israel",
    ],
    "EM": [
        "emerging market", "developing", "brazil", "south africa",
        "turkey", "argentina", "frontier",
    ],
    "LATAM": [
        "latin america", "brazil", "mexico", "argentina", "chile",
        "colombia", "peru",
    ],
}

# ── Sentiment word lists ──────────────────────────────────────────────────────
POSITIVE_WORDS = {
    "growth", "rally", "surge", "gain", "rise", "bull", "bullish", "boom",
    "recovery", "rebound", "optimism", "expansion", "strong", "strength",
    "beat", "exceed", "improve", "upgrade", "positive", "upside", "confident",
    "resilient", "acceleration", "soar", "robust", "outperform",
}

NEGATIVE_WORDS = {
    "decline", "fall", "crash", "plunge", "drop", "bear", "bearish", "bust",
    "recession", "downturn", "pessimism", "contraction", "weak", "weakness",
    "miss", "cut", "worsen", "downgrade", "negative", "downside", "risk",
    "crisis", "collapse", "slump", "volatile", "fear", "uncertainty",
    "default", "layoff", "loss", "deficit", "inflation",
}

# ── Asset class keywords ─────────────────────────────────────────────────────
ASSET_CLASS_KEYWORDS: Dict[str, List[str]] = {
    "Equities": ["stock", "equity", "equities", "shares", "s&p", "nasdaq", "dow"],
    "Bonds": ["bond", "treasury", "yield", "fixed income", "debt", "gilt"],
    "FX": ["forex", "currency", "dollar", "euro", "yen", "fx", "exchange rate"],
    "Commodities": ["commodity", "commodities", "gold", "silver", "copper", "wheat"],
    "Energy": ["oil", "gas", "energy", "crude", "brent", "wti", "petroleum"],
    "Crypto": ["bitcoin", "crypto", "ethereum", "blockchain", "digital asset"],
    "Real Estate": ["real estate", "property", "housing", "mortgage", "reit"],
}


def classify_themes(text: str) -> List[Tuple[str, float]]:
    """
    Return list of (theme_id, relevance_score) for a piece of text.
    Relevance score is based on keyword match density.
    """
    if not text:
        return []
    text_lower = text.lower()
    results = []

    for theme_id, keywords in THEME_KEYWORDS.items():
        matches = sum(1 for kw in keywords if kw in text_lower)
        if matches > 0:
            # Normalize: more matches → higher relevance (cap at 1.0)
            relevance = min(1.0, matches / 3.0)
            results.append((theme_id, round(relevance, 2)))

    # Sort by relevance descending
    results.sort(key=lambda x: x[1], reverse=True)
    return results


def extract_regions(text: str) -> List[str]:
    """Extract region codes mentioned in text."""
    if not text:
        return []
    text_lower = text.lower()
    regions = []
    for region, keywords in REGION_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            regions.append(region)
    return regions


def compute_sentiment(text: str) -> float:
    """
    Simple keyword-based sentiment score between -1.0 and 1.0.
    """
    if not text:
        return 0.0
    words = set(text.lower().split())
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    total = pos + neg
    if total == 0:
        return 0.0
    return round((pos - neg) / total, 2)


def extract_asset_classes(text: str) -> List[str]:
    """Extract asset classes mentioned in text."""
    if not text:
        return []
    text_lower = text.lower()
    assets = []
    for asset, keywords in ASSET_CLASS_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            assets.append(asset)
    return assets


def extract_tickers(text: str) -> List[str]:
    """Extract common tickers from text."""
    import re
    # Match common ticker patterns: $AAPL or standalone uppercase 2-5 letter words
    tickers = re.findall(r'\$([A-Z]{1,5})', text)
    # Also match well-known tickers
    KNOWN_TICKERS = [
        "SPX", "SPY", "QQQ", "DXY", "VIX", "AAPL", "MSFT", "NVDA",
        "TSLA", "GOOG", "AMZN", "META", "GLD", "USO", "TLT",
    ]
    for ticker in KNOWN_TICKERS:
        if ticker in text:
            tickers.append(ticker)
    return list(set(tickers))
