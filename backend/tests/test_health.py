"""Tests for /health and /ready endpoints."""
from unittest.mock import AsyncMock, patch


def test_health_always_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"


def test_health_no_auth_required(client):
    """Health endpoint must be accessible without credentials."""
    resp = client.get("/health")
    assert resp.status_code == 200


def test_ready_returns_200_when_services_up(client):
    """When DB and Redis are available, /ready should return 200."""
    from unittest.mock import MagicMock
    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__ = lambda s: mock_conn
    mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    with patch("app.core.database.engine", mock_engine), \
         patch(
             "app.services.redis_service.redis_service.get",
             new_callable=AsyncMock,
             return_value=None,
         ):
        resp = client.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_ready_returns_503_when_redis_down(client):
    """When Redis is unavailable, /ready should return 503."""
    with patch(
        "app.services.redis_service.redis_service.get",
        new_callable=AsyncMock,
        side_effect=ConnectionError("Redis unavailable"),
    ):
        resp = client.get("/ready")
    assert resp.status_code == 503
    data = resp.json()
    assert data["status"] == "not ready"
    assert len(data["errors"]) > 0
