# Chat Router Module
# This module handles all chat-related endpoints and form field management
# It processes both AI-generated and user-direct form updates

from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.services.openai_service import chat_completion as openai_chat_completion
from app.services.gemini_service import chat_completion as gemini_chat_completion
import json
import logging

from typing import List
from pydantic import BaseModel

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s'  # Only show the message without timestamp and level
)
logger = logging.getLogger(__name__)



router = APIRouter()

def format_updates(updated_fields):
    """Simple format for field updates"""
    if not updated_fields:
        return ""
    
    updates_list = []
    for field, value in updated_fields.items():
        updates_list.append(f"• **{field}**: {value}")
    
    return "Updated fields:\n" + "\n".join(updates_list)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Handle chat messages and form updates
    
    This endpoint handles two types of updates:
    1. Direct updates from the frontend UI
    2. AI-generated updates from chat messages
    """
    ai_role = req.ai_role or "co-worker"
    is_first_message = not req.messages
    
    logger.info(f"[CHAT] AI Role: {ai_role}, AI Provider: {req.ai_provider}, First Message: {is_first_message}, Messages Count: {len(req.messages)}")
    
    # Choose AI provider and process chat message
    if req.ai_provider == "gemini":
        ai_msg = await gemini_chat_completion(
            req.messages, 
            form=req.form,
            is_first_message=is_first_message,
            ai_role=ai_role
        )
    else:
        ai_msg = await openai_chat_completion(
            req.messages, 
            form=req.form,
            is_first_message=is_first_message,
            ai_role=ai_role
        )
    
    # Initialize response variables
    updated = {}
    has_updates = False
    
    # Process any field updates from the chat
    if ai_msg.tool_calls:
        logger.info(f"[CHAT] Tool calls found - processing field updates")
        tool_call = ai_msg.tool_calls[0]
        data = json.loads(tool_call.function.arguments)
        updated = {}
        
        # Process AI suggestions directly (frontend already validated changes)
        for update in data["updates"]:
            updated[update["field"]] = update["suggestion"]
        
        has_updates = bool(updated)
        logger.info(f"[CHAT] Updated {len(updated)} fields: {list(updated.keys())}")
        
        # Use the reply from tool call for conversational response
        if "reply" in data and data["reply"].strip():
            reply = data["reply"]  # Use the conversational reply from tool call
            # Always append update information when fields are updated
            if updated:
                updates_text = format_updates(updated)
                reply += f"\n\n---\n\n{updates_text}\n\n---"
        elif ai_msg.content and ai_msg.content.strip():
            reply = ai_msg.content  # Fall back to main content
            # Always append update information when fields are updated
            if updated:
                updates_text = format_updates(updated)
                reply += f"\n\n---\n\n{updates_text}\n\n---"
        else:
            # Last resort: use default with update details
            updates_text = format_updates(updated)
            reply = f"I've updated the form based on our conversation.\n\n{updates_text}"
    else:
        logger.info(f"[CHAT] No tool calls found - using text response only")
        # No tool calls, just use the conversation response
        reply = ai_msg.content if ai_msg.content else ""
    
    return ChatResponse(
        reply=reply,
        updated_fields=updated,
        has_updates=has_updates
    )


