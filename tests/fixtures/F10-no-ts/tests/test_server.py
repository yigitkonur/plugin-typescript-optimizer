from app.server import app


def test_health():
    assert app.test_client().get("/health").json == {"status": "ok"}
