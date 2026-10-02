from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    typesafe_api_key: SecretStr = SecretStr("")
    typesafe_model: str = "jev-latest"
    model_confidence_floor: float = Field(default=0.65, ge=0, le=1)

    @property
    def assessment_available(self) -> bool:
        return bool(self.typesafe_api_key.get_secret_value())
