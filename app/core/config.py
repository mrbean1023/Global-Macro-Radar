"""
Application settings loaded from environment variables / .env file.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./data/macro.db"
    OPENAI_API_KEY: str = ""
    NEWSAPI_KEY: str = ""
    FRED_API_KEY: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
