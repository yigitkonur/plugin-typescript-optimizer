from app.models import Item


def test_item():
    assert Item(id=1, name="a").name == "a"
