"""
Data ingestion pipeline for the Macro Intelligence Platform.

Fetches real articles from NewsAPI and economic data from FRED,
classifies them using the NLP engine, computes theme scores,
generates alerts, and builds daily briefs.
"""
import hashlib
import logging
from datetime import datetime, timedelta
from typing import List, Optional

import httpx

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.config import settings
from app.models.models import (
    Article, Theme, ArticleTheme, TrendPoint,
    Insight, Event, Alert, DailyBrief,
    ThemeStatus, AlertType, AlertSeverity,
)
from app.services.nlp import (
    classify_themes, extract_regions, compute_sentiment,
    extract_asset_classes, extract_tickers,
    THEME_NAMES, THEME_ASSET_CLASSES,
)

logger = logging.getLogger("ingestion")

# ── NewsAPI ───────────────────────────────────────────────────────────────────

NEWSAPI_URL = "https://newsapi.org/v2/everything"
MACRO_QUERIES = [
    "inflation OR CPI OR interest rate",
    "oil price OR OPEC OR crude",
    "Federal Reserve OR ECB OR central bank",
    "artificial intelligence OR semiconductor",
    "geopolitical OR NATO OR sanctions",
    "China economy OR yuan OR PBOC",
    "fiscal policy OR government spending OR deficit",
    "climate change OR renewable energy OR ESG",
]


async def fetch_newsapi_articles() -> List[dict]:
    """Fetch articles from NewsAPI across multiple macro queries."""
    if not settings.NEWSAPI_KEY:
        logger.warning("NEWSAPI_KEY not set — skipping NewsAPI fetch")
        return []

    all_articles = []
    async with httpx.AsyncClient(timeout=30) as client:
        for query in MACRO_QUERIES:
            try:
                resp = await client.get(
                    NEWSAPI_URL,
                    params={
                        "q": query,
                        "language": "en",
                        "sortBy": "publishedAt",
                        "pageSize": 10,
                        "apiKey": settings.NEWSAPI_KEY,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    articles = data.get("articles", [])
                    all_articles.extend(articles)
                    logger.info(f"NewsAPI: {len(articles)} articles for '{query[:30]}...'")
                else:
                    logger.warning(f"NewsAPI error {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                logger.error(f"NewsAPI fetch error for '{query[:30]}': {e}")

    # Deduplicate by URL
    seen = set()
    unique = []
    for a in all_articles:
        url = a.get("url", "")
        if url and url not in seen:
            seen.add(url)
            unique.append(a)

    logger.info(f"NewsAPI: {len(unique)} unique articles total")
    return unique


# ── FRED API ──────────────────────────────────────────────────────────────────

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES = {
    "CPIAUCSL": {"name": "CPI (All Urban Consumers)", "theme": "sticky_inflation"},
    "FEDFUNDS": {"name": "Federal Funds Rate", "theme": "cb_divergence"},
    "DCOILBRENTEU": {"name": "Brent Crude Oil Price", "theme": "oil_supply_shock"},
    "GDP": {"name": "US GDP", "theme": "fiscal_expansion"},
    "UNRATE": {"name": "Unemployment Rate", "theme": "sticky_inflation"},
    "T10Y2Y": {"name": "10Y-2Y Treasury Spread", "theme": "cb_divergence"},
}


async def fetch_fred_data() -> List[dict]:
    """Fetch recent economic indicator observations from FRED."""
    if not settings.FRED_API_KEY:
        logger.warning("FRED_API_KEY not set — skipping FRED fetch")
        return []

    results = []
    async with httpx.AsyncClient(timeout=30) as client:
        for series_id, meta in FRED_SERIES.items():
            try:
                resp = await client.get(
                    FRED_URL,
                    params={
                        "series_id": series_id,
                        "api_key": settings.FRED_API_KEY,
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": 5,
                        "observation_start": (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d"),
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    obs = data.get("observations", [])
                    for o in obs:
                        if o.get("value") and o["value"] != ".":
                            results.append({
                                "series_id": series_id,
                                "name": meta["name"],
                                "theme": meta["theme"],
                                "date": o["date"],
                                "value": float(o["value"]),
                            })
                    logger.info(f"FRED: {len(obs)} observations for {series_id}")
                else:
                    logger.warning(f"FRED error {resp.status_code} for {series_id}")
            except Exception as e:
                logger.error(f"FRED fetch error for {series_id}: {e}")

    return results


# ── Article Processing ────────────────────────────────────────────────────────

def _article_id(url: str) -> str:
    """Generate deterministic ID from URL."""
    return hashlib.md5(url.encode()).hexdigest()[:16]


def process_and_store_articles(db: Session, raw_articles: List[dict]) -> int:
    """
    Process raw NewsAPI articles: classify, tag, score, and store in DB.
    Returns count of newly inserted articles.
    """
    inserted = 0

    for raw in raw_articles:
        url = raw.get("url", "")
        title = raw.get("title", "")
        if not url or not title or title == "[Removed]":
            continue

        article_id = _article_id(url)

        # Skip if already exists
        if db.query(Article).filter(Article.id == article_id).first():
            continue

        # Combine title + description for richer NLP
        full_text = f"{title}. {raw.get('description', '') or ''}"
        snippet = raw.get("description", "") or ""

        # NLP classification
        themes = classify_themes(full_text)
        regions = extract_regions(full_text)
        sentiment = compute_sentiment(full_text)
        asset_classes = extract_asset_classes(full_text)
        tickers = extract_tickers(full_text)

        # Parse published date
        pub_str = raw.get("publishedAt", "")
        try:
            published_at = datetime.fromisoformat(pub_str.replace("Z", "+00:00")).replace(tzinfo=None)
        except (ValueError, AttributeError):
            published_at = datetime.utcnow()

        # Source
        source = raw.get("source", {}).get("name", "Unknown")

        article = Article(
            id=article_id,
            source=source,
            title=title,
            url=url,
            published_at=published_at,
            snippet=snippet,
            full_text=full_text,
            regions=regions,
            entities=[],
            tickers=tickers,
            asset_classes=asset_classes,
            sentiment=sentiment,
            processed=True,
            created_at=datetime.utcnow(),
        )
        db.add(article)

        # Link to themes via ArticleTheme
        for theme_id, relevance in themes:
            # Ensure theme exists
            ensure_theme(db, theme_id)
            link = ArticleTheme(
                article_id=article_id,
                theme_id=theme_id,
                relevance_score=relevance,
            )
            db.merge(link)

        inserted += 1

    db.commit()
    logger.info(f"Inserted {inserted} new articles")
    return inserted


def ensure_theme(db: Session, theme_id: str):
    """Create a theme record if it doesn't exist."""
    existing = db.query(Theme).filter(Theme.id == theme_id).first()
    if not existing:
        theme = Theme(
            id=theme_id,
            name=THEME_NAMES.get(theme_id, theme_id.replace("_", " ").title()),
            description=f"Auto-created theme tracking {THEME_NAMES.get(theme_id, theme_id)}",
            status=ThemeStatus.stable,
            score=0.0,
            delta=0.0,
            velocity=0.0,
            sentiment_avg=0.0,
            mention_count_7d=0,
            mention_count_30d=0,
            regions=[],
            asset_classes=THEME_ASSET_CLASSES.get(theme_id, []),
            tags=[theme_id],
        )
        db.add(theme)
        db.commit()


# ── FRED → Events ─────────────────────────────────────────────────────────────

def store_fred_as_events(db: Session, fred_data: List[dict]) -> int:
    """Store FRED data points as MacroEvents."""
    stored = 0
    for item in fred_data:
        event_id = hashlib.md5(
            f"{item['series_id']}_{item['date']}".encode()
        ).hexdigest()[:16]

        if db.query(Event).filter(Event.id == event_id).first():
            continue

        try:
            occurred_at = datetime.strptime(item["date"], "%Y-%m-%d")
        except ValueError:
            occurred_at = datetime.utcnow()

        event = Event(
            id=event_id,
            event_type="economic_release",
            title=f"{item['name']}: {item['value']}",
            description=f"{item['name']} ({item['series_id']}) reported at {item['value']} on {item['date']}",
            region="US",
            occurred_at=occurred_at,
            article_ids=[],
            chain_reactions=[],
        )
        db.add(event)

        # Ensure the associated theme exists
        ensure_theme(db, item["theme"])
        stored += 1

    db.commit()
    logger.info(f"Stored {stored} new FRED events")
    return stored


# ── Theme Score Computation ───────────────────────────────────────────────────

def recompute_theme_scores(db: Session):
    """Recompute all theme metrics from article links."""
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    themes = db.query(Theme).all()
    for theme in themes:
        # Count mentions
        links_7d = (
            db.query(ArticleTheme)
            .join(Article, Article.id == ArticleTheme.article_id)
            .filter(ArticleTheme.theme_id == theme.id)
            .filter(Article.published_at >= week_ago)
            .all()
        )
        links_30d = (
            db.query(ArticleTheme)
            .join(Article, Article.id == ArticleTheme.article_id)
            .filter(ArticleTheme.theme_id == theme.id)
            .filter(Article.published_at >= month_ago)
            .all()
        )

        mention_7d = len(links_7d)
        mention_30d = len(links_30d)

        # Velocity: articles per day over last 7 days
        velocity = round(mention_7d / 7.0, 2)

        # Score: weighted combination
        score = min(100, round(mention_7d * 4 + velocity * 10, 1))

        # Average sentiment
        article_ids_7d = [l.article_id for l in links_7d]
        if article_ids_7d:
            articles = db.query(Article).filter(Article.id.in_(article_ids_7d)).all()
            sentiments = [a.sentiment for a in articles if a.sentiment is not None]
            sentiment_avg = round(sum(sentiments) / len(sentiments), 2) if sentiments else 0.0
        else:
            sentiment_avg = 0.0

        # Aggregate regions from articles
        article_ids_all = [l.article_id for l in links_30d]
        all_regions = set()
        if article_ids_all:
            arts = db.query(Article).filter(Article.id.in_(article_ids_all)).all()
            for a in arts:
                if a.regions:
                    all_regions.update(a.regions)

        # Determine status
        if score >= 70 and velocity >= 2:
            status = ThemeStatus.hot
        elif score <= 30 or velocity <= 0.5:
            status = ThemeStatus.cooling
        else:
            status = ThemeStatus.stable

        # Delta: compare to previous score
        old_score = theme.score or 0.0
        delta = round(score - old_score, 1)

        # Update theme
        theme.score = score
        theme.delta = delta
        theme.velocity = velocity
        theme.sentiment_avg = sentiment_avg
        theme.mention_count_7d = mention_7d
        theme.mention_count_30d = mention_30d
        theme.status = status
        theme.regions = list(all_regions) if all_regions else theme.regions
        theme.updated_at = now

        # Store trend point for today
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        existing_tp = (
            db.query(TrendPoint)
            .filter(TrendPoint.theme_id == theme.id, TrendPoint.date == today_start)
            .first()
        )
        if existing_tp:
            existing_tp.score = score
            existing_tp.mention_count = mention_7d
            existing_tp.velocity = velocity
            existing_tp.sentiment_avg = sentiment_avg
        else:
            tp = TrendPoint(
                theme_id=theme.id,
                date=today_start,
                score=score,
                mention_count=mention_7d,
                velocity=velocity,
                sentiment_avg=sentiment_avg,
            )
            db.add(tp)

    db.commit()
    logger.info("Theme scores recomputed")


# ── Alert Generation ──────────────────────────────────────────────────────────

def generate_alerts(db: Session):
    """Generate alerts based on theme metrics."""
    now = datetime.utcnow()
    themes = db.query(Theme).all()

    for theme in themes:
        # Velocity spike alert
        if theme.velocity >= 3.0:
            _create_alert_if_new(
                db, theme,
                alert_type=AlertType.velocity_spike,
                severity=AlertSeverity.critical if theme.velocity >= 5 else AlertSeverity.high,
                title=f"Velocity spike: {theme.name}",
                message=f"{theme.name} is seeing {theme.velocity:.1f} articles/day — "
                        f"significantly above normal levels. "
                        f"Regions affected: {', '.join(theme.regions or ['global'])}",
                data={"velocity": theme.velocity, "score": theme.score},
            )

        # Risk threshold alert
        if theme.score >= 80:
            _create_alert_if_new(
                db, theme,
                alert_type=AlertType.risk_threshold,
                severity=AlertSeverity.critical if theme.score >= 90 else AlertSeverity.high,
                title=f"Risk threshold breached: {theme.name}",
                message=f"{theme.name} score has reached {theme.score:.0f}/100. "
                        f"Sentiment: {theme.sentiment_avg:+.2f}. "
                        f"Monitor closely for portfolio exposure.",
                data={"score": theme.score, "sentiment": theme.sentiment_avg},
            )

        # Cross-region alert
        if theme.regions and len(theme.regions) >= 3:
            _create_alert_if_new(
                db, theme,
                alert_type=AlertType.cross_region,
                severity=AlertSeverity.high,
                title=f"Cross-region correlation: {theme.name}",
                message=f"{theme.name} is being discussed across {len(theme.regions)} regions: "
                        f"{', '.join(theme.regions)}. Potential for contagion.",
                data={"regions": theme.regions, "count": len(theme.regions)},
            )

    db.commit()
    logger.info("Alert generation complete")


def _create_alert_if_new(
    db: Session, theme: Theme,
    alert_type: AlertType, severity: AlertSeverity,
    title: str, message: str, data: dict,
):
    """Create an alert only if a similar one doesn't exist in last 24h."""
    cutoff = datetime.utcnow() - timedelta(hours=24)
    existing = (
        db.query(Alert)
        .filter(
            Alert.theme_id == theme.id,
            Alert.alert_type == alert_type,
            Alert.triggered_at >= cutoff,
        )
        .first()
    )
    if existing:
        return

    alert_id = hashlib.md5(
        f"{theme.id}_{alert_type.value}_{datetime.utcnow().isoformat()}".encode()
    ).hexdigest()[:16]

    alert = Alert(
        id=alert_id,
        theme_id=theme.id,
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        data=data,
        read=False,
        triggered_at=datetime.utcnow(),
    )
    db.add(alert)


# ── Insight Generation ────────────────────────────────────────────────────────

def generate_insights(db: Session):
    """Generate analyst insights for each theme based on article data."""
    themes = db.query(Theme).all()
    now = datetime.utcnow()

    RISK_TEMPLATES = {
        "sticky_inflation": [
            {"asset": "Bonds", "direction": "bearish", "rationale": "Persistent inflation erodes fixed income real returns", "confidence": 85},
            {"asset": "Gold", "direction": "bullish", "rationale": "Inflation hedge demand increases", "confidence": 78},
            {"asset": "Equities", "direction": "bearish", "rationale": "Higher rates compress P/E multiples", "confidence": 72},
        ],
        "oil_supply_shock": [
            {"asset": "Energy", "direction": "bullish", "rationale": "Supply constraints drive energy sector outperformance", "confidence": 88},
            {"asset": "Airlines", "direction": "bearish", "rationale": "Fuel costs directly compress margins", "confidence": 82},
            {"asset": "EM Equities", "direction": "bearish", "rationale": "Oil-importing EMs face current account deterioration", "confidence": 70},
        ],
        "cb_divergence": [
            {"asset": "FX", "direction": "volatile", "rationale": "Rate differentials drive currency swings", "confidence": 80},
            {"asset": "Bonds", "direction": "bearish", "rationale": "Divergent policies increase term premium globally", "confidence": 75},
            {"asset": "EM FX", "direction": "bearish", "rationale": "Dollar strength pressures EM currencies", "confidence": 68},
        ],
        "ai_capex_boom": [
            {"asset": "Tech", "direction": "bullish", "rationale": "AI infrastructure buildout drives revenue growth", "confidence": 82},
            {"asset": "Utilities", "direction": "bullish", "rationale": "Data center power demand creates tailwind", "confidence": 74},
            {"asset": "Semiconductors", "direction": "bullish", "rationale": "GPU/chip demand exceeds supply capacity", "confidence": 86},
        ],
        "geopolitical_flashpoints": [
            {"asset": "Gold", "direction": "bullish", "rationale": "Safe haven demand spikes during geopolitical uncertainty", "confidence": 90},
            {"asset": "Defense", "direction": "bullish", "rationale": "Military spending increases across NATO", "confidence": 85},
            {"asset": "Equities", "direction": "bearish", "rationale": "Risk-off sentiment weighs on broad markets", "confidence": 65},
        ],
        "china_stabilization": [
            {"asset": "EM Equities", "direction": "bullish", "rationale": "China stabilization lifts EM sentiment", "confidence": 62},
            {"asset": "Commodities", "direction": "bullish", "rationale": "Chinese demand recovery boosts raw materials", "confidence": 58},
            {"asset": "FX", "direction": "volatile", "rationale": "Yuan policy shifts create cross-currency ripples", "confidence": 55},
        ],
        "fiscal_expansion": [
            {"asset": "Bonds", "direction": "bearish", "rationale": "Increased issuance pushes yields higher", "confidence": 78},
            {"asset": "Infrastructure", "direction": "bullish", "rationale": "Direct beneficiary of government spending", "confidence": 82},
            {"asset": "Equities", "direction": "bullish", "rationale": "Fiscal stimulus supports corporate earnings", "confidence": 65},
        ],
        "climate_transition": [
            {"asset": "Clean Energy", "direction": "bullish", "rationale": "Policy support and investment flows accelerate", "confidence": 76},
            {"asset": "Fossil Fuels", "direction": "bearish", "rationale": "Stranded asset risk increases with regulation", "confidence": 70},
            {"asset": "EVs", "direction": "bullish", "rationale": "Adoption curve steepens with subsidy support", "confidence": 68},
        ],
    }

    SUMMARY_TEMPLATES = {
        "sticky_inflation": "Inflation remains above central bank targets, with core measures proving stickier than expected. Services inflation and wage growth continue to resist disinflationary trends. Markets pricing in higher-for-longer rate environment.",
        "oil_supply_shock": "Oil markets face supply-side pressure from OPEC+ output discipline and geopolitical risks. Brent crude elevated above $85/bbl with limited spare capacity. Energy transition inadequate to offset near-term supply gaps.",
        "cb_divergence": "Major central banks pursuing increasingly divergent policy paths. Fed, ECB, and BOJ rate trajectories creating significant cross-asset implications. FX volatility elevated as carry trades adjust.",
        "ai_capex_boom": "AI infrastructure spending accelerating with hyperscaler capex commitments exceeding $200B. Supply chain bottlenecks emerging in advanced chips and power infrastructure. Productivity gains potential offset by concentration risk.",
        "geopolitical_flashpoints": "Multiple geopolitical risk vectors active simultaneously. Elevated defense spending, sanctions regimes, and supply chain reconfiguration creating structural shifts across asset classes.",
        "china_stabilization": "Chinese economic indicators showing mixed signals. Property sector stress ongoing while policy easing measures gradually take effect. FDI flows redirecting across Asia.",
        "fiscal_expansion": "Government spending expanding globally post-pandemic. Rising debt-to-GDP ratios and bond supply creating fiscal sustainability questions. Infrastructure spend providing near-term growth support.",
        "climate_transition": "Energy transition investing accelerating with policy tailwinds. Green bond issuance at record levels. Regulatory pressure increasing on carbon-intensive sectors.",
    }

    for theme in themes:
        # Check if insight already exists for today
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        existing = (
            db.query(Insight)
            .filter(Insight.theme_id == theme.id, Insight.generated_at >= today)
            .first()
        )
        if existing:
            continue

        insight_id = hashlib.md5(
            f"insight_{theme.id}_{now.isoformat()}".encode()
        ).hexdigest()[:16]

        # Get recent articles for key data points
        recent_articles = (
            db.query(Article)
            .join(ArticleTheme, ArticleTheme.article_id == Article.id)
            .filter(ArticleTheme.theme_id == theme.id)
            .order_by(Article.published_at.desc())
            .limit(5)
            .all()
        )
        key_data_points = [a.title for a in recent_articles[:3]]

        # Narrative tags
        narrative_tags = [theme.id.replace("_", " ")]
        if theme.regions:
            narrative_tags.extend([f"{r.lower()}_macro" for r in theme.regions[:2]])

        insight = Insight(
            id=insight_id,
            theme_id=theme.id,
            summary=SUMMARY_TEMPLATES.get(theme.id, f"Analysis for {theme.name} based on recent data."),
            risk_implications=RISK_TEMPLATES.get(theme.id, []),
            evidence_article_ids=[a.id for a in recent_articles],
            narrative_tags=narrative_tags,
            key_data_points=key_data_points,
            generated_at=now,
        )
        db.add(insight)

    db.commit()
    logger.info("Insights generated")


# ── Daily Brief ───────────────────────────────────────────────────────────────

def generate_daily_brief(db: Session):
    """Build today's daily brief from top themes."""
    now = datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Check if brief already exists for today
    existing = db.query(DailyBrief).filter(DailyBrief.date == today).first()
    if existing:
        # Update it
        brief = existing
    else:
        brief = DailyBrief(date=today, bullets=[], top_theme_ids=[], generated_at=now)
        db.add(brief)

    # Get top themes by score
    top_themes = db.query(Theme).order_by(Theme.score.desc()).limit(5).all()

    bullets = []
    for t in top_themes:
        status_str = t.status.value.upper() if t.status else "STABLE"
        regions_str = ", ".join(t.regions[:3]) if t.regions else "Global"
        bullets.append(
            f"[{status_str}] {t.name} — Score: {t.score:.0f}/100, "
            f"Velocity: {t.velocity:.1f} art/day, "
            f"Sentiment: {t.sentiment_avg:+.2f}. "
            f"Regions: {regions_str}"
        )

    brief.bullets = bullets
    brief.top_theme_ids = [t.id for t in top_themes]
    brief.narrative_summary = (
        f"Macro environment tracking {len(top_themes)} active themes. "
        f"{sum(1 for t in top_themes if t.status == ThemeStatus.hot)} themes classified as HOT. "
        f"Average theme score: {sum(t.score for t in top_themes) / len(top_themes):.0f}/100."
        if top_themes else "No themes tracked yet."
    )
    brief.generated_at = now

    db.commit()
    logger.info("Daily brief generated")


# ── Main Pipeline ─────────────────────────────────────────────────────────────

async def run_full_pipeline() -> dict:
    """
    Execute the complete ingestion pipeline:
    1. Fetch articles from NewsAPI
    2. Fetch economic data from FRED
    3. Process and store articles (NLP classification)
    4. Store FRED data as events
    5. Recompute theme scores
    6. Generate alerts
    7. Generate insights
    8. Build daily brief
    """
    logger.info("=== Starting full ingestion pipeline ===")
    stats = {}

    # 1. Fetch data
    raw_articles = await fetch_newsapi_articles()
    fred_data = await fetch_fred_data()
    stats["articles_fetched"] = len(raw_articles)
    stats["fred_observations"] = len(fred_data)

    # 2. Process with NLP and store
    db = SessionLocal()
    try:
        inserted = process_and_store_articles(db, raw_articles)
        stats["articles_inserted"] = inserted

        fred_stored = store_fred_as_events(db, fred_data)
        stats["events_stored"] = fred_stored

        # 3. Recompute scores
        recompute_theme_scores(db)
        stats["themes_updated"] = db.query(Theme).count()

        # 4. Generate alerts
        generate_alerts(db)
        stats["alerts_total"] = db.query(Alert).count()

        # 5. Generate insights
        generate_insights(db)
        stats["insights_total"] = db.query(Insight).count()

        # 6. Build daily brief
        generate_daily_brief(db)
        stats["brief_generated"] = True

    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        stats["error"] = str(e)
    finally:
        db.close()

    logger.info(f"=== Pipeline complete: {stats} ===")
    return stats
