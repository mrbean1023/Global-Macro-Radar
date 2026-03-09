"""
POST /api/chat — RAG-powered macro Q&A using OpenAI + article DB
"""
import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

import httpx

from app.core.database import get_db
from app.core.config import settings
from app.models.models import Article, ArticleTheme, Theme, Insight
from app.services.nlp import classify_themes, extract_regions

logger = logging.getLogger("chat")

router = APIRouter(prefix="/api", tags=["chat"])

OPENAI_URL = "https://api.openai.com/v1/chat/completions"


class ChatRequest(BaseModel):
    question: str


def _retrieve_context(db: Session, question: str, max_articles: int = 8) -> dict:
    """
    RAG retrieval: find relevant articles and insights from the DB
    based on the user's question.
    """
    # 1. Classify question to find relevant themes
    theme_matches = classify_themes(question)
    theme_ids = [t[0] for t in theme_matches]
    regions = extract_regions(question)

    # 2. Search articles by keyword match
    keywords = [w for w in question.lower().split() if len(w) > 3]
    keyword_articles = []
    if keywords:
        filters = [Article.title.ilike(f"%{kw}%") for kw in keywords[:5]]
        filters += [Article.snippet.ilike(f"%{kw}%") for kw in keywords[:5]]
        keyword_articles = (
            db.query(Article)
            .filter(or_(*filters))
            .order_by(Article.published_at.desc())
            .limit(max_articles)
            .all()
        )

    # 3. Get articles from matched themes
    theme_articles = []
    if theme_ids:
        theme_articles = (
            db.query(Article)
            .join(ArticleTheme, ArticleTheme.article_id == Article.id)
            .filter(ArticleTheme.theme_id.in_(theme_ids))
            .order_by(Article.published_at.desc())
            .limit(max_articles)
            .all()
        )

    # Deduplicate and merge
    seen = set()
    articles = []
    for a in keyword_articles + theme_articles:
        if a.id not in seen:
            seen.add(a.id)
            articles.append(a)
        if len(articles) >= max_articles:
            break

    # 4. Get relevant insights
    insights = []
    if theme_ids:
        insights = (
            db.query(Insight)
            .filter(Insight.theme_id.in_(theme_ids))
            .order_by(Insight.generated_at.desc())
            .limit(3)
            .all()
        )

    # 5. Get theme info
    themes = []
    if theme_ids:
        themes = db.query(Theme).filter(Theme.id.in_(theme_ids)).all()

    return {
        "articles": articles,
        "insights": insights,
        "themes": themes,
        "theme_ids": theme_ids,
    }


def _build_context_text(context: dict) -> str:
    """Build a text context block from retrieved data."""
    parts = []

    # Theme summaries
    if context["themes"]:
        parts.append("=== ACTIVE MACRO THEMES ===")
        for t in context["themes"]:
            parts.append(
                f"• {t.name} — Score: {t.score:.0f}/100, "
                f"Status: {t.status.value if t.status else 'unknown'}, "
                f"Velocity: {t.velocity:.1f} art/day, "
                f"Sentiment: {t.sentiment_avg:+.2f}, "
                f"Regions: {', '.join(t.regions or [])}"
            )

    # Insights
    if context["insights"]:
        parts.append("\n=== ANALYST INSIGHTS ===")
        for ins in context["insights"]:
            parts.append(f"• [{ins.theme_id}] {ins.summary}")
            if ins.risk_implications:
                for r in ins.risk_implications[:2]:
                    parts.append(f"  → {r.get('asset','?')}: {r.get('direction','?')} — {r.get('rationale','')}")

    # Articles
    if context["articles"]:
        parts.append("\n=== RECENT ARTICLES ===")
        for a in context["articles"]:
            date_str = a.published_at.strftime("%Y-%m-%d") if a.published_at else "?"
            parts.append(f"• [{date_str}] {a.title} ({a.source})")
            if a.snippet:
                parts.append(f"  {a.snippet[:200]}")

    return "\n".join(parts)


SYSTEM_PROMPT = """You are a senior macro analyst AI embedded in the Global Macro Radar platform.
You have access to a real-time database of financial articles, macro themes, and analyst insights.

When answering:
1. Ground your answers in the provided article data and theme metrics
2. Cite specific articles or data points when relevant
3. Provide actionable insights with asset class implications
4. Be direct and quantitative — include numbers, scores, and sentiment readings
5. Structure your response with clear sections for Analysis, Risk Implications, and Asset Impact
6. Keep your answer concise but comprehensive (2-3 paragraphs max)

If the data doesn't contain enough information to fully answer, say so honestly and provide what you can."""


@router.post("/chat")
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """RAG-powered macro Q&A: retrieve relevant context, send to OpenAI."""

    # Step 1: Retrieve relevant context from DB
    context = _retrieve_context(db, req.question)
    context_text = _build_context_text(context)

    # Format sources for the response
    sources = []
    for a in context["articles"][:5]:
        sources.append({
            "title": a.title,
            "source": a.source,
            "url": a.url,
            "date": a.published_at.isoformat() if a.published_at else None,
        })

    related_theme_ids = context["theme_ids"]

    # Step 2: Check if OpenAI is configured
    api_key = settings.OPENAI_API_KEY
    if not api_key or api_key == "sk-your-key-here" or len(api_key) < 10:
        # No OpenAI key — generate a smart response from DB data only
        answer = _generate_db_only_answer(req.question, context)
        return {
            "answer": answer,
            "sources": sources,
            "confidence": 0.7,
            "related_theme_ids": related_theme_ids,
        }

    # Step 3: Call OpenAI with context
    try:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context from our database:\n{context_text}\n\nUser question: {req.question}"},
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
                    "temperature": 0.3,
                    "max_tokens": 800,
                },
            )

        if resp.status_code == 200:
            data = resp.json()
            answer = data["choices"][0]["message"]["content"]
            return {
                "answer": answer,
                "sources": sources,
                "confidence": 0.9,
                "related_theme_ids": related_theme_ids,
            }
        else:
            logger.warning(f"OpenAI error {resp.status_code}: {resp.text[:200]}")
            answer = _generate_db_only_answer(req.question, context)
            return {
                "answer": f"{answer}\n\n_(Note: OpenAI API returned error {resp.status_code}, showing DB-only analysis)_",
                "sources": sources,
                "confidence": 0.6,
                "related_theme_ids": related_theme_ids,
            }

    except Exception as e:
        logger.error(f"Chat error: {e}")
        answer = _generate_db_only_answer(req.question, context)
        return {
            "answer": answer,
            "sources": sources,
            "confidence": 0.6,
            "related_theme_ids": related_theme_ids,
        }


def _generate_db_only_answer(question: str, context: dict) -> str:
    """Generate a meaningful answer purely from DB data when OpenAI is unavailable."""
    parts = []

    if context["themes"]:
        top = context["themes"][0]
        parts.append(
            f"**Analysis based on {len(context['articles'])} relevant articles:**\n"
        )
        for t in context["themes"]:
            status = t.status.value.upper() if t.status else "UNKNOWN"
            parts.append(
                f"**{t.name}** — Score: {t.score:.0f}/100 ({status}), "
                f"Velocity: {t.velocity:.1f} articles/day, "
                f"Sentiment: {t.sentiment_avg:+.2f}"
            )
            if t.regions:
                parts.append(f"  Regions: {', '.join(t.regions)}")

    if context["insights"]:
        parts.append("\n**Risk Implications:**")
        for ins in context["insights"][:2]:
            parts.append(f"• {ins.summary[:300]}")
            if ins.risk_implications:
                for r in ins.risk_implications[:3]:
                    direction_emoji = "📈" if r.get("direction") == "bullish" else "📉" if r.get("direction") == "bearish" else "⚡"
                    parts.append(
                        f"  {direction_emoji} **{r.get('asset', '?')}**: {r.get('direction', '?')} "
                        f"— {r.get('rationale', '')} (Confidence: {r.get('confidence', 0)}%)"
                    )

    if context["articles"]:
        parts.append(f"\n**Key Headlines ({len(context['articles'])} articles):**")
        for a in context["articles"][:5]:
            date = a.published_at.strftime("%b %d") if a.published_at else ""
            sent_color = "🟢" if (a.sentiment or 0) >= 0 else "🔴"
            parts.append(f"• {sent_color} [{date}] {a.title} — _{a.source}_")

    if not parts:
        parts.append(
            f"I found no articles matching your query: \"{question}\". "
            f"Try asking about: inflation, oil prices, interest rates, AI/semiconductors, "
            f"geopolitical risks, China economy, fiscal policy, or climate/ESG."
        )

    return "\n".join(parts)
