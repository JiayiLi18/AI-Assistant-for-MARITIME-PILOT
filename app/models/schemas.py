 # Pydantic request / response models
from pydantic import BaseModel, Field
from typing import List, Dict

class ChatRequest(BaseModel):
    messages: List[Dict]           # standard OpenAI chat format
    form: Dict = Field(default={}) # current form values (key → value)

class ChatResponse(BaseModel):
    reply: str                     # AI text (or function acknowledgement)
    updated_fields: Dict = Field(default={})
