"""
GET /api/calendar — macro economic events calendar
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.models.models import Event

router = APIRouter(prefix="/api", tags=["calendar"])


@router.get("/calendar")
def get_calendar(
    days_back: int = Query(30, ge=1, le=365),
    days_forward: int = Query(30, ge=0, le=365),
    region: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Return macro events for the calendar view.
    Groups events by date.
    """
    now = datetime.utcnow()
    start = now - timedelta(days=days_back)
    end = now + timedelta(days=days_forward)

    q = db.query(Event).filter(
        Event.occurred_at >= start,
        Event.occurred_at <= end,
    )
    if region:
        q = q.filter(Event.region == region)

    events = q.order_by(Event.occurred_at.desc()).all()

    # Group by date
    date_groups: dict[str, list] = {}
    for e in events:
        date_key = e.occurred_at.strftime("%Y-%m-%d")
        if date_key not in date_groups:
            date_groups[date_key] = []
        date_groups[date_key].append({
            "id": e.id,
            "event_type": e.event_type,
            "title": e.title,
            "description": e.description,
            "region": e.region,
            "occurred_at": e.occurred_at.isoformat(),
            "chain_reactions": e.chain_reactions or [],
        })

    return {
        "events": date_groups,
        "total_count": len(events),
        "date_range": {
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    }
