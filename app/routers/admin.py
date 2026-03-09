"""
POST /api/admin/ingest  — trigger ingestion pipeline
GET  /api/admin/health  — health check with counts
GET  /api/admin/ingest-status — last ingestion stats
"""
import asyncio
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Article, Theme, Alert, Event

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/ingest")
async def ingest():
    """Trigger the full ingestion pipeline (NewsAPI + FRED + NLP)."""
    from app.services.ingestion import run_full_pipeline
    try:
        stats = await run_full_pipeline()
        return {"status": "ok", "message": "Ingestion complete", "stats": stats}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    article_count = db.query(Article).count()
    theme_count = db.query(Theme).count()
    alert_count = db.query(Alert).count()
    event_count = db.query(Event).count()
    return {
        "status": "ok",
        "article_count": article_count,
        "theme_count": theme_count,
        "alert_count": alert_count,
        "event_count": event_count,
    }


@router.get("/ingest-status")
def ingest_status():
    """Return stats from the last pipeline run."""
    from app.services.scheduler import get_last_run_stats
    stats = get_last_run_stats()
    if not stats:
        return {"status": "no_runs", "message": "No ingestion has been run yet"}
    return stats
