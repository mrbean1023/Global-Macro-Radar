"""
POST /api/chain-reaction — AI-powered macro ripple effect simulator
"""
import logging
import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

import httpx

from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.models.models import Theme

logger = logging.getLogger("chain")

router = APIRouter(prefix="/api", tags=["chain"])

OPENAI_URL = "https://api.openai.com/v1/chat/completions"


class ChainRequest(BaseModel):
    event_description: str
    region: Optional[str] = None


CHAIN_SYSTEM_PROMPT = """You are a macro economics chain reaction simulator. Given a macro event, you must model how it ripples through the global financial system in 3-4 sequential steps.

For each step, provide:
- cause: what triggers this step
- effect: the resulting outcome
- mechanism: WHY this happens (economic logic)
- timeframe: one of "immediate", "days", "weeks", "months"
- confidence: 0-100 score
- asset_impacts: list of {asset, direction} where direction is "bullish", "bearish", or "volatile"

Respond ONLY with valid JSON in this exact format:
{
  "summary": "One-line summary of the overall chain",
  "steps": [
    {
      "step": 1,
      "cause": "...",
      "effect": "...",
      "mechanism": "...",
      "timeframe": "immediate",
      "confidence": 85,
      "asset_impacts": [{"asset": "Equities", "direction": "bearish"}]
    }
  ]
}

Be specific and quantitative. Use real asset class names: Equities, Bonds, FX, Commodities, Gold, Oil, EM Equities, Crypto, Real Estate."""


@router.post("/chain-reaction")
async def chain_reaction(req: ChainRequest, db: Session = Depends(get_db)):
    """Simulate macro ripple effects using AI."""
    region_label = f" in {req.region}" if req.region else ""

    # Get current theme context for better simulation
    themes_context = ""
    themes = db.query(Theme).order_by(Theme.score.desc()).limit(5).all()
    if themes:
        theme_lines = [
            f"• {t.name}: score={t.score:.0f}, status={t.status.value if t.status else '?'}, sentiment={t.sentiment_avg:+.2f}"
            for t in themes
        ]
        themes_context = f"\n\nCurrent macro backdrop:\n" + "\n".join(theme_lines)

    # Check if OpenAI is available
    api_key = settings.OPENAI_API_KEY
    if not api_key or api_key == "sk-your-key-here" or len(api_key) < 10:
        return _generate_rule_based_chain(req.event_description, req.region, themes)

    # Call OpenAI
    try:
        messages = [
            {"role": "system", "content": CHAIN_SYSTEM_PROMPT},
            {"role": "user", "content": f"Event: {req.event_description}{region_label}{themes_context}"},
        ]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                OPENAI_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": messages,
                    "temperature": 0.4,
                    "max_tokens": 1000,
                },
            )

        if resp.status_code == 200:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            # Parse JSON from response, handling markdown code blocks
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            try:
                result = json.loads(content)
                return result
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse chain JSON: {content[:200]}")
                return _generate_rule_based_chain(req.event_description, req.region, themes)
        else:
            logger.warning(f"OpenAI error {resp.status_code}")
            return _generate_rule_based_chain(req.event_description, req.region, themes)

    except Exception as e:
        logger.error(f"Chain reaction error: {e}")
        return _generate_rule_based_chain(req.event_description, req.region, themes)


def _generate_rule_based_chain(event: str, region: Optional[str], themes: list) -> dict:
    """Generate a rule-based chain reaction when OpenAI is unavailable."""
    from app.services.nlp import classify_themes, extract_regions

    event_lower = event.lower()
    region_label = f" in {region}" if region else ""

    # Determine event type and generate appropriate chain
    if any(w in event_lower for w in ["oil", "opec", "crude", "energy"]):
        return {
            "summary": f"Oil supply disruption{region_label} triggers energy price cascade with cross-asset contagion",
            "steps": [
                {"step": 1, "cause": event, "effect": "Oil prices spike 8-15%",
                 "mechanism": "Supply constraint tightens an already-balanced market. Brent moves above $90/bbl as traders price in reduced output.",
                 "timeframe": "immediate", "confidence": 88,
                 "asset_impacts": [{"asset": "Oil", "direction": "bullish"}, {"asset": "Energy", "direction": "bullish"}]},
                {"step": 2, "cause": "Oil prices spike", "effect": "Inflation expectations re-anchor higher",
                 "mechanism": "Energy costs feed into CPI via transport, manufacturing, and utilities. Breakevens widen 15-25bps.",
                 "timeframe": "days", "confidence": 78,
                 "asset_impacts": [{"asset": "Bonds", "direction": "bearish"}, {"asset": "Gold", "direction": "bullish"}]},
                {"step": 3, "cause": "Rising inflation expectations", "effect": "Central banks signal hawkish tilt",
                 "mechanism": "Fed/ECB forced to keep rates higher for longer. Rate cut expectations pushed out by 2-3 months.",
                 "timeframe": "weeks", "confidence": 65,
                 "asset_impacts": [{"asset": "Equities", "direction": "bearish"}, {"asset": "FX", "direction": "volatile"}]},
                {"step": 4, "cause": "Hawkish central banks", "effect": "EM currencies under pressure",
                 "mechanism": "Dollar strength from higher-for-longer US rates compresses EM FX. Oil importers (India, Turkey) most vulnerable.",
                 "timeframe": "months", "confidence": 55,
                 "asset_impacts": [{"asset": "EM Equities", "direction": "bearish"}, {"asset": "Commodities", "direction": "volatile"}]},
            ],
        }
    elif any(w in event_lower for w in ["rate", "fed", "interest", "hike", "cut", "monetary"]):
        return {
            "summary": f"Central bank policy shift{region_label} cascades through rates, FX, and risk assets",
            "steps": [
                {"step": 1, "cause": event, "effect": "Yield curve reprices",
                 "mechanism": "Front-end rates adjust immediately. 2-year Treasury moves 10-20bps as markets reprice the terminal rate.",
                 "timeframe": "immediate", "confidence": 90,
                 "asset_impacts": [{"asset": "Bonds", "direction": "bearish"}, {"asset": "FX", "direction": "bullish"}]},
                {"step": 2, "cause": "Yield curve repricing", "effect": "Growth stock de-rating",
                 "mechanism": "Higher discount rates compress long-duration equity valuations. Tech/growth P/E multiples contract 5-8%.",
                 "timeframe": "days", "confidence": 80,
                 "asset_impacts": [{"asset": "Equities", "direction": "bearish"}, {"asset": "Gold", "direction": "bearish"}]},
                {"step": 3, "cause": "Risk asset selloff", "effect": "Credit spreads widen",
                 "mechanism": "High yield spreads widen 30-50bps as risk sentiment deteriorates. Refinancing risk increases for leveraged borrowers.",
                 "timeframe": "weeks", "confidence": 68,
                 "asset_impacts": [{"asset": "Bonds", "direction": "bearish"}, {"asset": "Real Estate", "direction": "bearish"}]},
            ],
        }
    elif any(w in event_lower for w in ["war", "conflict", "geopolitical", "sanction", "military"]):
        return {
            "summary": f"Geopolitical escalation{region_label} triggers flight-to-safety rotation",
            "steps": [
                {"step": 1, "cause": event, "effect": "Risk-off sentiment spike",
                 "mechanism": "VIX jumps above 25 as uncertainty premium enters all asset classes. Equity index futures drop 2-3%.",
                 "timeframe": "immediate", "confidence": 85,
                 "asset_impacts": [{"asset": "Equities", "direction": "bearish"}, {"asset": "Gold", "direction": "bullish"}]},
                {"step": 2, "cause": "Risk-off rotation", "effect": "Safe haven flows accelerate",
                 "mechanism": "Treasuries rally as flight-to-quality bids push 10Y yield down 15-25bps. Gold tests new highs.",
                 "timeframe": "days", "confidence": 82,
                 "asset_impacts": [{"asset": "Bonds", "direction": "bullish"}, {"asset": "Gold", "direction": "bullish"}]},
                {"step": 3, "cause": "Sustained geopolitical risk", "effect": "Supply chain disruption fears",
                 "mechanism": "Energy/commodity supply routes threatened. Defense sector outperforms as military spending expectations rise.",
                 "timeframe": "weeks", "confidence": 70,
                 "asset_impacts": [{"asset": "Oil", "direction": "bullish"}, {"asset": "EM Equities", "direction": "bearish"}]},
            ],
        }
    else:
        # Generic macro event
        return {
            "summary": f"Macro event{region_label} creates multi-asset ripple effects across global markets",
            "steps": [
                {"step": 1, "cause": event, "effect": "Initial market repricing",
                 "mechanism": "Markets rapidly digest the new information, adjusting positioning across affected asset classes. Volatility spikes as uncertainty increases.",
                 "timeframe": "immediate", "confidence": 80,
                 "asset_impacts": [{"asset": "Equities", "direction": "volatile"}, {"asset": "FX", "direction": "volatile"}]},
                {"step": 2, "cause": "Market repricing", "effect": "Sector rotation and rebalancing",
                 "mechanism": "Active managers adjust portfolio allocations. Cross-asset correlations temporarily spike as systematic strategies de-risk.",
                 "timeframe": "days", "confidence": 72,
                 "asset_impacts": [{"asset": "Bonds", "direction": "bullish"}, {"asset": "Gold", "direction": "bullish"}]},
                {"step": 3, "cause": "Portfolio rebalancing", "effect": "Policy response and second-order effects",
                 "mechanism": "Central banks and fiscal authorities signal readiness to act if market stress escalates. New equilibrium formation begins.",
                 "timeframe": "weeks", "confidence": 58,
                 "asset_impacts": [{"asset": "Commodities", "direction": "volatile"}, {"asset": "EM Equities", "direction": "bearish"}]},
            ],
        }
