from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from rolelens.config import Settings
from rolelens.storage import Store


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def database(url: str) -> Store:
    return Store(url)


def get_store(settings: Annotated[Settings, Depends(get_settings)]) -> Store:
    return database(settings.database_url)
