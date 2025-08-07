# Pydantic models for request/response validation and serialization
# These models define the structure of data exchanged between frontend and backend

from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class Message(BaseModel):
    """Represents a single chat message in the conversation"""
    # Role can be 'user', 'assistant', 'system', or 'tool'
    role: str
    # The actual message content
    content: str



class ChatRequest(BaseModel):
    """Request model for chat endpoints"""
    # List of conversation messages
    messages: List[Message]
    # Current state of the form
    form: Dict[str, Any]
    # Whether the update comes from AI or user
    is_ai_update: bool = True
    # AI role for selecting appropriate prompt ("co-worker", "butler", "coach")
    ai_role: Optional[str] = "co-worker"

class ChatResponse(BaseModel):
    """Response model for chat endpoints"""
    # AI's text response or function acknowledgement
    reply: str
    # Fields that were updated in this response
    updated_fields: Optional[Dict[str, Any]] = None
    # Whether any updates were actually performed
    has_updates: Optional[bool] = False
