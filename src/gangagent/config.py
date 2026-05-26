from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    gemini_api_key: str | None = None

    gang_default_provider: str = Field(default="claude")
    gang_default_model: str = Field(default="claude-sonnet-4-5-20250929")


def load_settings() -> Settings:
    return Settings()
