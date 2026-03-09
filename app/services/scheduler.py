"""
Background scheduler for automatic data ingestion.
Uses APScheduler to run the pipeline at regular intervals.
"""
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger("scheduler")

scheduler = AsyncIOScheduler()
_last_run_stats = {}


async def _run_pipeline_job():
    """Wrapper that runs the ingestion pipeline as a scheduled job."""
    global _last_run_stats
    from app.services.ingestion import run_full_pipeline
    try:
        logger.info("Scheduled ingestion triggered")
        stats = await run_full_pipeline()
        _last_run_stats = {
            "status": "success",
            "stats": stats,
            "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Scheduled ingestion failed: {e}", exc_info=True)
        _last_run_stats = {
            "status": "error",
            "error": str(e),
            "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
        }


def start_scheduler(interval_minutes: int = 30):
    """Start the background scheduler."""
    scheduler.add_job(
        _run_pipeline_job,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="ingestion_pipeline",
        replace_existing=True,
        name="Macro Data Ingestion Pipeline",
    )
    scheduler.start()
    logger.info(f"Scheduler started — ingestion every {interval_minutes} minutes")


def stop_scheduler():
    """Stop the background scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def get_last_run_stats() -> dict:
    """Return stats from the last pipeline run."""
    return _last_run_stats
