# Chat Router Module
# This module handles all chat-related endpoints and form field management
# It processes both AI-generated and user-direct form updates

from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.services.openai_service import chat_completion as openai_chat_completion, initialize_form as openai_initialize_form
from app.services.gemini_service import chat_completion as gemini_chat_completion, initialize_form as gemini_initialize_form
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

class InitializeRequest(BaseModel):
    """Request model for initialize endpoint"""
    ai_role: str = "co-worker"
    ai_provider: str = "gemini"  # "openai" or "gemini"

@router.post("/initialize", response_model=List[ChatResponse])
async def initialize(req: InitializeRequest = InitializeRequest()):
    """
    Initialize the form with fixed fields
    
    Args:
        req: Request containing the AI role to use ("co-worker", "butler", "coach")
              and AI provider ("openai" or "gemini")
        
    Returns a list of responses:
    1. Welcome message
    2. Initial form state and list of fields that need to be filled
    """
    logger.info(f"[INITIALIZE] AI Role: {req.ai_role}, AI Provider: {req.ai_provider}")
    
    # Choose AI provider
    if req.ai_provider == "gemini":
        logger.info(f"[INITIALIZE] Using Gemini service for role: {req.ai_role}")
        init_msg = await gemini_initialize_form(req.ai_role)
    else:
        logger.info(f"[INITIALIZE] Using OpenAI service for role: {req.ai_role}")
        init_msg = await openai_initialize_form(req.ai_role)
    if init_msg.tool_calls:
        tool_call = init_msg.tool_calls[0]
        data = json.loads(tool_call.function.arguments)
        # For initialization, accept all suggested values without filtering
        # since we're starting with an empty form
        updated = {update["field"]: update["suggestion"] for update in data["updates"]}
        
        # Simple approach: just list unfilled fields
        all_possible_fields = [
            "report-number", "report-date", "observation-time", "location",
            "vessel-name", "imo-number", "vessel-type", "pilot-id",
            "hazards-description", "visibility", "sea-state", "wind-conditions",
            "incident-details", "pilotage-comments", "improvements",
            "workload", "stress-feedback", "submitted-by", "submission-date"
        ]
        
        filled_fields = set(updated.keys())
        unfilled_fields = [f for f in all_possible_fields if f not in filled_fields]
        
        unfilled_sections_text = [f"Fields to complete: {', '.join(unfilled_fields)}"] if unfilled_fields else []
        
        # Prepare welcome messages based on role
        if req.ai_role == "butler":
            welcome_msg_1 = "Hey Jake! I've auto-filled your Maritime Pilot Report with all the standard info to save you time.\n\n"
            welcome_msg_2 = (
                "Here's what I've completed:\n\n"
                f"{format_updates(updated)}\n\n"
                "\n\nI just need quick input on these remaining items:\n" + 
                "\n".join(f"• {text}" for text in unfilled_sections_text) +
                "\n\nJust give me the basics and I'll auto-suggest the rest!"
            )
        elif req.ai_role == "coach":
            welcome_msg_1 = "Hello Jake. I'm here to support you as you reflect on this pilotage experience and complete your Maritime Pilot Report.\n\n"
            welcome_msg_2 = (
                "I've gathered some of the basic information we know:\n\n"
                f"{format_updates(updated)}\n\n"
                "\n\nRather than rushing through the remaining fields, I'd love to create space for you to reflect on this journey. Each experience offers opportunities for growth and deeper understanding of your craft.\n\n"
                "When you're ready, we can explore together what stood out to you about this pilotage—what challenged you, what went well, or what insights emerged. There's no hurry; we'll move at whatever pace feels right for you.\n\n"
                "What would you like to share about this experience?"
            )
        else:  # co-worker (default)
            welcome_msg_1 = "Hey Jake. I've finished my task and I'm ready to start filling the Maritime Pilot Report now.\n\n"
            welcome_msg_2 = (
                "I've filled all the information I know here.\n\n"
                f"{format_updates(updated)}\n\n"
                "\n\n Once you're available, could you check these following fields? \n" + 
                "\n".join(f"• {text}" for text in unfilled_sections_text) +
                "\n\n"
            )
        
        logger.info(f"[INITIALIZE] Success - Tool calls found, updated {len(updated)} fields")
        return [
            ChatResponse(reply=welcome_msg_1, updated_fields={}),
            ChatResponse(reply=welcome_msg_2 + f"\n\n---\n\n*Powered by {req.ai_provider.upper()}*", updated_fields=updated)
        ]
    
    logger.info(f"[INITIALIZE] No tool calls found, returning default message")
    return [ChatResponse(reply="Ready to start filling the form.")]

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
        logger.info(f"[CHAT] Using Gemini service for role: {ai_role}")
        ai_msg = await gemini_chat_completion(
            req.messages, 
            form=req.form,
            is_first_message=is_first_message,
            ai_role=ai_role
        )
    else:
        logger.info(f"[CHAT] Using OpenAI service for role: {ai_role}")
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
        reply=reply + f"\n\n---\n\n*Powered by {req.ai_provider.upper()}*",
        updated_fields=updated,
        has_updates=has_updates
    )


