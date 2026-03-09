"""
GET /api/alerts — list alerts with optional severity filter
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Alert, Theme

router = APIRouter(prefix="/api", tags=["alerts"])


@router.get("/alerts")
def get_alerts(
    limit: int = Query(20, ge=1, le=100),
    severity: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Alert).order_by(Alert.triggered_at.desc())
    if severity:
        q = q.filter(Alert.severity == severity)
    alerts = q.limit(limit).all()

    result = []
    for a in alerts:
        theme_name = None
        if a.theme_id:
            theme = db.query(Theme).filter(Theme.id == a.theme_id).first()
            if theme:
                theme_name = theme.name
        result.append({
            "id": a.id,
            "theme_id": a.theme_id,
            "theme_name": theme_name,
            "alert_type": a.alert_type.value if a.alert_type else None,
            "severity": a.severity.value if a.severity else "medium",
            "title": a.title,
            "message": a.message,
            "data": a.data or {},
            "read": a.read,
            "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        })
    return result
