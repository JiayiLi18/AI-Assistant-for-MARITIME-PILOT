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

# Human-friendly field metadata for better user guidance
FIELD_INFO = {
    # 1. Report Information
    "report-number": ("Report Information", "Report Number"),
    "report-date": ("Report Information", "Date"),
    "observation-time": ("Report Information", "Time of Observation"),
    "location": ("Report Information", "Location"),
    # 2. Vessel and Pilot Details
    "vessel-name": ("1. Vessel and Pilot Details", "Vessel Name"),
    "imo-number": ("1. Vessel and Pilot Details", "IMO Number"),
    "vessel-type": ("1. Vessel and Pilot Details", "Type of Vessel"),
    "pilot-id": ("1. Vessel and Pilot Details", "Pilot Name/ID"),
    # 3. Safety Observations
    "hazards-description": ("2. Safety Observations", "Potential hazards observed"),
    # 4. Pilotage Recommendations
    "pilotage-comments": ("3. Pilotage Practices & Recommendations", "Comments on Pilotage Procedures"),
    "improvements": ("3. Pilotage Practices & Recommendations", "Any Suggested Improvements"),
    # 5. Work-Related Stress
    "workload": ("4. Work-Related Stress & Fatigue", "Workload Assessment (1-5, 5 = very high)"),
    "additional-comment": ("4. Work-Related Stress & Fatigue", "Additional Comments"),
    # 6. Submission
    "submitted-by": ("Submission Details", "Submitted by"),
    "submission-date": ("Submission Details", "Date of Submission"),
}

def format_updates(updated_fields):
    """Format field updates grouped by section with compact listing"""
    if not updated_fields:
        return ""

    # Group updates by section, preserving input order
    section_to_items = {}
    standalone_items = []

    for field, value in updated_fields.items():
        section, label = FIELD_INFO.get(field, ("", field))
        item_text = f"**{label}**: {value}"
        if section:
            section_to_items.setdefault(section, []).append(item_text)
        else:
            standalone_items.append(f"• **{item_text}**")

    lines = []
    for section, items in section_to_items.items():
        lines.append(f"• **{section}**:\n" + "\n".join(items))

    # Append any standalone items (rare)
    lines.extend(standalone_items)

    return "I've updated the following fields:\n" + "\n".join(lines)


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
            field = update["field"]
            value = update["suggestion"]
            if field == "workload":
                # Normalize to string digits '1'-'5' for frontend consistency
                try:
                    if isinstance(value, (int, float)):
                        value = str(int(value))
                    else:
                        value = str(value).strip()
                except Exception:
                    value = str(value)
            updated[field] = value
        
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


