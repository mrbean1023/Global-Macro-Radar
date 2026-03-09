"""
GET /api/heatmap — regional heat scores computed from themes
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.models.models import Theme, Article

router = APIRouter(prefix="/api", tags=["heatmap"])

ALL_REGIONS = ["US", "EU", "UK", "JP", "ASIA", "ME", "EM", "CN", "LATAM"]


@router.get("/heatmap")
def get_heatmap(db: Session = Depends(get_db)):
    themes = db.query(Theme).all()

    region_data: dict[str, dict] = {}
    for r in ALL_REGIONS:
        region_data[r] = {
            "region": r,
            "heat_score": 0,
            "hot_theme_count": 0,
            "top_themes": [],
            "article_count_7d": 0,
        }

    for theme in themes:
        for region in (theme.regions or []):
            if region in region_data:
                rd = region_data[region]
                rd["heat_score"] = max(rd["heat_score"], theme.score)
                if theme.status and theme.status.value == "hot":
                    rd["hot_theme_count"] += 1
                rd["top_themes"].append(theme.name)

    # Count articles per region (last 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    articles = db.query(Article).filter(Article.published_at >= week_ago).all()
    for a in articles:
        for region in (a.regions or []):
            if region in region_data:
                region_data[region]["article_count_7d"] += 1

    return {
        "regions": list(region_data.values()),
        "generated_at": datetime.utcnow().isoformat(),
    }
