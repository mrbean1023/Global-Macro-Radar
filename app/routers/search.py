"""
GET /api/search — full-text search across articles with filters
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db
from app.models.models import Article, ArticleTheme, Theme

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def search_articles(
    q: str = Query(..., min_length=1, description="Search query"),
    region: Optional[str] = Query(None),
    asset_class: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    Full-text search across articles with optional region & asset class filters.
    """
    query = db.query(Article).filter(
        or_(
            Article.title.ilike(f"%{q}%"),
            Article.snippet.ilike(f"%{q}%"),
            Article.full_text.ilike(f"%{q}%"),
        )
    )

    # Get all matching, then filter in Python for JSON fields
    articles = query.order_by(Article.published_at.desc()).all()

    results = []
    for a in articles:
        # Region filter
        if region and region not in (a.regions or []):
            continue
        # Asset class filter
        if asset_class and asset_class not in (a.asset_classes or []):
            continue

        # Get linked themes
        theme_links = (
            db.query(ArticleTheme)
            .filter(ArticleTheme.article_id == a.id)
            .all()
        )
        theme_ids = [tl.theme_id for tl in theme_links]
        theme_names = []
        for tid in theme_ids:
            theme = db.query(Theme).filter(Theme.id == tid).first()
            if theme:
                theme_names.append(theme.name)

        results.append({
            "id": a.id,
            "title": a.title,
            "source": a.source,
            "url": a.url,
            "published_at": a.published_at.isoformat() if a.published_at else None,
            "snippet": a.snippet,
            "regions": a.regions or [],
            "asset_classes": a.asset_classes or [],
            "sentiment": a.sentiment,
            "themes": theme_names,
            "tickers": a.tickers or [],
        })

        if len(results) >= limit:
            break

    return {
        "query": q,
        "total": len(results),
        "results": results,
    }
