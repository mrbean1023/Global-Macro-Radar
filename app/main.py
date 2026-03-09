"""
Macro Intelligence Platform — FastAPI entry point.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.core.database import engine, Base

# Import models so they register with Base.metadata
import app.models.models  # noqa: F401

from app.routers import themes, brief, heatmap, alerts, narratives, chat, chain, admin
from app.routers import calendar, search

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup
    Base.metadata.create_all(bind=engine)

    # Start background scheduler for auto-ingestion
    from app.services.scheduler import start_scheduler, stop_scheduler
    try:
        start_scheduler(interval_minutes=30)
    except Exception as e:
        logging.getLogger("startup").warning(f"Scheduler start failed: {e}")

    yield

    # Shutdown scheduler on exit
    try:
        stop_scheduler()
    except Exception:
        pass


app = FastAPI(
    title="Macro Intelligence Platform",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(themes.router)
app.include_router(brief.router)
app.include_router(heatmap.router)
app.include_router(alerts.router)
app.include_router(narratives.router)
app.include_router(chat.router)
app.include_router(chain.router)
app.include_router(admin.router)
app.include_router(calendar.router)
app.include_router(search.router)


# ── Serve frontend in production (Docker build) ─────────────────────────────
if STATIC_DIR.exists():
    # Serve JS/CSS/assets
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        """SPA catch-all: serve index.html for any non-API route."""
        file = STATIC_DIR / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
else:
    @app.get("/")
    def root():
        return {"message": "Macro Intelligence Platform API", "docs": "/docs"}
