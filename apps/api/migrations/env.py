from alembic import context

from rolelens.config import Settings
from rolelens.storage import Store, metadata

store = Store(Settings().database_url)
with store.engine.connect() as connection:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()
