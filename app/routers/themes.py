"""
GET /api/themes        — list all themes
GET /api/themes/{id}   — theme detail with recent articles & insight
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Theme, TrendPoint, Insight, Article, ArticleTheme

router = APIRouter(prefix="/api/themes", tags=["themes"])


def _theme_to_dict(t: Theme) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "status": t.status.value if t.status else "stable",
        "score": t.score,
        "delta": t.delta,
        "velocity": t.velocity,
        "sentiment_avg": t.sentiment_avg,
        "mention_count_7d": t.mention_count_7d,
        "mention_count_30d": t.mention_count_30d,
        "regions": t.regions or [],
        "asset_classes": t.asset_classes or [],
        "tags": t.tags or [],
        "sparkline": [tp.score for tp in (t.trend_points or [])[-8:]],
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@router.get("")
def list_themes(db: Session = Depends(get_db)):
    themes = db.query(Theme).order_by(Theme.score.desc()).all()
    return [_theme_to_dict(t) for t in themes]


@router.get("/{theme_id}")
def get_theme(theme_id: str, db: Session = Depends(get_db)):
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        return {"error": "Theme not found"}

    data = _theme_to_dict(theme)

    # Latest insight
    insight = (
        db.query(Insight)
        .filter(Insight.theme_id == theme_id)
        .order_by(Insight.generated_at.desc())
        .first()
    )
    if insight:
        data["latest_summary"] = insight.summary
        data["risk_implications"] = insight.risk_implications or []
        data["key_data_points"] = insight.key_data_points or []

    # Recent articles
    article_rows = (
        db.query(Article)
        .join(ArticleTheme, ArticleTheme.article_id == Article.id)
        .filter(ArticleTheme.theme_id == theme_id)
        .order_by(Article.published_at.desc())
        .limit(10)
        .all()
    )
    data["recent_articles"] = [
        {"title": a.title, "source": a.source, "url": a.url}
        for a in article_rows
    ]

    return data
