"""
All SQLAlchemy ORM models for the Macro Intelligence Platform.
"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    String, Text, Float, Integer, Boolean, DateTime,
    ForeignKey, JSON, Index, Enum as SAEnum
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.core.database import Base


class ThemeStatus(str, enum.Enum):
    hot = "hot"
    stable = "stable"
    cooling = "cooling"


class AlertType(str, enum.Enum):
    velocity_spike = "velocity_spike"
    cross_region = "cross_region"
    risk_threshold = "risk_threshold"
    new_narrative = "new_narrative"


class AlertSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


# ── Article ───────────────────────────────────────────────────────────────────
class Article(Base):
    __tablename__ = "articles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime)
    snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    full_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # NLP outputs
    regions: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    entities: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    tickers: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    asset_classes: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    sentiment: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # -1 to +1
    embedding_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    theme_links: Mapped[List["ArticleTheme"]] = relationship(back_populates="article")

    __table_args__ = (
        Index("ix_articles_published_at", "published_at"),
        Index("ix_articles_processed", "processed"),
    )


# ── Theme ─────────────────────────────────────────────────────────────────────
class Theme(Base):
    __tablename__ = "themes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ThemeStatus] = mapped_column(SAEnum(ThemeStatus), default=ThemeStatus.stable)

    # Computed scores (updated by worker)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    delta: Mapped[float] = mapped_column(Float, default=0.0)         # 7d score change
    velocity: Mapped[float] = mapped_column(Float, default=0.0)      # articles/day
    sentiment_avg: Mapped[float] = mapped_column(Float, default=0.0)
    mention_count_7d: Mapped[int] = mapped_column(Integer, default=0)
    mention_count_30d: Mapped[int] = mapped_column(Integer, default=0)

    # Taxonomy
    regions: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    asset_classes: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    tags: Mapped[Optional[List]] = mapped_column(JSON, default=list)

    # Centroid vector id in FAISS
    centroid_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    article_links: Mapped[List["ArticleTheme"]] = relationship(back_populates="theme")
    trend_points: Mapped[List["TrendPoint"]] = relationship(back_populates="theme", order_by="TrendPoint.date")
    insights: Mapped[List["Insight"]] = relationship(back_populates="theme")
    alerts: Mapped[List["Alert"]] = relationship(back_populates="theme")


# ── Article ↔ Theme join table ────────────────────────────────────────────────
class ArticleTheme(Base):
    __tablename__ = "article_themes"

    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"), primary_key=True)
    theme_id: Mapped[str] = mapped_column(ForeignKey("themes.id"), primary_key=True)
    relevance_score: Mapped[float] = mapped_column(Float, default=1.0)

    article: Mapped["Article"] = relationship(back_populates="theme_links")
    theme: Mapped["Theme"] = relationship(back_populates="article_links")


# ── TrendPoint ────────────────────────────────────────────────────────────────
class TrendPoint(Base):
    __tablename__ = "trend_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    theme_id: Mapped[str] = mapped_column(ForeignKey("themes.id"))
    date: Mapped[datetime] = mapped_column(DateTime)
    score: Mapped[float] = mapped_column(Float)
    mention_count: Mapped[int] = mapped_column(Integer, default=0)
    velocity: Mapped[float] = mapped_column(Float, default=0.0)
    sentiment_avg: Mapped[float] = mapped_column(Float, default=0.0)

    theme: Mapped["Theme"] = relationship(back_populates="trend_points")

    __table_args__ = (
        Index("ix_trend_theme_date", "theme_id", "date"),
    )


# ── Insight ───────────────────────────────────────────────────────────────────
class Insight(Base):
    __tablename__ = "insights"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    theme_id: Mapped[Optional[str]] = mapped_column(ForeignKey("themes.id"), nullable=True)
    event_id: Mapped[Optional[str]] = mapped_column(ForeignKey("events.id"), nullable=True)

    summary: Mapped[str] = mapped_column(Text)
    risk_implications: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    # [{asset_class, direction, rationale, confidence}]
    evidence_article_ids: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    narrative_tags: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    key_data_points: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    theme: Mapped[Optional["Theme"]] = relationship(back_populates="insights")


# ── MacroEvent ────────────────────────────────────────────────────────────────
class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64))   # cpi_print, cb_speech, geopolitical
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime)
    article_ids: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    chain_reactions: Mapped[Optional[List]] = mapped_column(JSON, default=list)
    # [{step, description, asset_impacts, confidence}]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    insights: Mapped[List["Insight"]] = relationship()

    __table_args__ = (
        Index("ix_events_occurred_at", "occurred_at"),
    )


# ── Alert ─────────────────────────────────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    theme_id: Mapped[Optional[str]] = mapped_column(ForeignKey("themes.id"), nullable=True)
    alert_type: Mapped[AlertType] = mapped_column(SAEnum(AlertType))
    severity: Mapped[AlertSeverity] = mapped_column(SAEnum(AlertSeverity), default=AlertSeverity.medium)
    title: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    theme: Mapped[Optional["Theme"]] = relationship(back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_triggered_at", "triggered_at"),
    )


# ── DailyBrief ────────────────────────────────────────────────────────────────
class DailyBrief(Base):
    __tablename__ = "daily_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[datetime] = mapped_column(DateTime, unique=True)
    bullets: Mapped[List] = mapped_column(JSON)          # list of strings
    top_theme_ids: Mapped[List] = mapped_column(JSON)    # ordered list
    narrative_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
