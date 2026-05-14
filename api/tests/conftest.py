"""Pytest fixtures. Integration tests use TEST_DATABASE_URL if set, else skip."""
import os
import pytest


def pytest_collection_modifyitems(config, items):
    """Skip integration tests when no TEST_DATABASE_URL is configured."""
    if os.getenv("TEST_DATABASE_URL"):
        return
    skip_db = pytest.mark.skip(reason="set TEST_DATABASE_URL to a Postgres URL to run integration tests")
    for item in items:
        if "needs_db" in item.keywords:
            item.add_marker(skip_db)


@pytest.fixture(scope="session")
def db_url():
    return os.getenv("TEST_DATABASE_URL")


@pytest.fixture()
def client(db_url, monkeypatch):
    """FastAPI TestClient bound to TEST_DATABASE_URL. Wipes group data per test."""
    monkeypatch.setenv("DATABASE_URL", db_url)
    # Reload modules that read DATABASE_URL at import time
    import importlib
    from app import db as db_module
    importlib.reload(db_module)
    from app import models, seed as seed_module, main as main_module
    importlib.reload(models)
    importlib.reload(seed_module)
    importlib.reload(main_module)

    from fastapi.testclient import TestClient
    main_module.Base.metadata.drop_all(bind=db_module.engine)
    main_module.Base.metadata.create_all(bind=db_module.engine)
    main_module._ensure_phase2_columns()
    with TestClient(main_module.app) as c:
        yield c
