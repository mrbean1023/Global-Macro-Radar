"""
GET /api/narratives — AI-detected macro narratives (derived from insights)
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Insight, Theme

router = APIRouter(prefix="/api", tags=["narratives"])


@router.get("/narratives")
def get_narratives(db: Session = Depends(get_db)):
    """
    Build narrative objects from insights that have narrative_tags.
    Each distinct narrative tag becomes a narrative card.
    """
    insights = (
        db.query(Insight)
        .order_by(Insight.generated_at.desc())
        .limit(50)
        .all()
    )

    # Group by narrative tags
    tag_map: dict[str, dict] = {}
    for ins in insights:
        for tag in (ins.narrative_tags or []):
            if tag not in tag_map:
                regions = []
                if ins.theme_id:
                    theme = db.query(Theme).filter(Theme.id == ins.theme_id).first()
                    if theme:
                        regions = theme.regions or []
                tag_map[tag] = {
                    "id": tag,
                    "title": tag.replace("_", " ").title(),
                    "description": ins.summary,
                    "regions": regions,
                    "strength": 50,
                    "insight_count": 0,
                }
            tag_map[tag]["insight_count"] += 1
            # Boost strength by number of corroborating insights
            tag_map[tag]["strength"] = min(100, 50 + tag_map[tag]["insight_count"] * 10)

    return list(tag_map.values())
