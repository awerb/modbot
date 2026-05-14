from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SimulateMessageIn(BaseModel):
    member_id: str
    text: str
    is_forwarded: bool = False
    group_id: Optional[str] = None


class WebhookIn(BaseModel):
    # Loose shape; Evolution-style payload variants accepted
    event: Optional[str] = None
    instance: Optional[str] = None
    data: Optional[dict] = None
