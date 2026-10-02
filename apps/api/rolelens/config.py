from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    typesafe_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    openai_jd_model: str = Field(default="gpt-6-luna", min_length=1, max_length=100)
    workspace_api_key: SecretStr = SecretStr("")
    jd_requests_per_minute: int = Field(default=6, ge=1, le=60)
    typesafe_model: str = "jev-latest"
    model_confidence_floor: float = Field(default=0.65, ge=0, le=1)
    database_url: str = "sqlite:///./data/rolelens.db"
    intake_api_key: SecretStr = SecretStr("")
    worker_lease_seconds: int = Field(default=90, ge=30, le=900)
    worker_max_attempts: int = Field(default=4, ge=1, le=10)

    @property
    def assessment_available(self) -> bool:
        return bool(self.typesafe_api_key.get_secret_value())
