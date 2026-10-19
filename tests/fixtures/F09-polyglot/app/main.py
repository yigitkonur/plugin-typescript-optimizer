from fastapi import FastAPI

from app.models import Item

app = FastAPI()


@app.get("/items/{item_id}")
def read_item(item_id: int) -> Item:
    return Item(id=item_id, name=f"item-{item_id}")
