"""
GET /api/brief — latest daily brief
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import DailyBrief

router = APIRouter(prefix="/api", tags=["brief"])


@router.get("/brief")
def get_brief(db: Session = Depends(get_db)):
    brief = db.query(DailyBrief).order_by(DailyBrief.date.desc()).first()
    if not brief:
        return {
            "bullets": [],
            "narrative_summary": None,
            "top_theme_ids": [],
            "date": None,
            "generated_at": None,
        }
    return {
        "bullets": brief.bullets or [],
        "narrative_summary": brief.narrative_summary,
        "top_theme_ids": brief.top_theme_ids or [],
        "date": brief.date.isoformat() if brief.date else None,
        "generated_at": brief.generated_at.isoformat() if brief.generated_at else None,
    }
