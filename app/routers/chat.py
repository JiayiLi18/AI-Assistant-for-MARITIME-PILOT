# /chat endpoint
from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.services.openai_service import chat_completion
import json
import logging
from collections import defaultdict

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Define form sections
FORM_SECTIONS = {
    "report-number": "Report Information",
    "report-date": "Report Information",
    "observation-time": "Report Information",
    "location": "Report Information",
    
    "vessel-name": "Vessel and Pilot Details",
    "imo-number": "Vessel and Pilot Details",
    "vessel-type": "Vessel and Pilot Details",
    "pilot-id": "Vessel and Pilot Details",
    "boarding-time": "Vessel and Pilot Details",
    "disembarking-time": "Vessel and Pilot Details",
    
    "hazards-description": "Safety Observations",
    "visibility": "Safety Observations",
    "sea-state": "Safety Observations",
    "wind-conditions": "Safety Observations",
    
    "transfer-method": "Pilot Transfer Arrangements",
    "transfer-location": "Pilot Transfer Arrangements",
    "transfer-issues": "Pilot Transfer Arrangements",
    
    "incident-details": "Incident Reporting",
    
    "pilotage-comments": "Pilotage Recommendations",
    "improvements": "Pilotage Recommendations",
    
    "workload": "Work-Related Stress"
}

router = APIRouter()

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # logger.debug(f"Received chat request with form data: {req.form}")
    
    ai_msg = await chat_completion(req.messages, form=req.form)
    logger.debug(f"AI response: {ai_msg}")
    
    # if AI called suggest_fields()
    if ai_msg.tool_calls:
        # Get the first tool call (we only have one tool)
        tool_call = ai_msg.tool_calls[0]
        data = json.loads(tool_call.function.arguments)
        logger.debug(f"Function call data: {data}")
        
        # Process multiple field updates
        updated = {}
        updates_by_section = defaultdict(list)
        
        for update in data["updates"]:
            field = update["field"]
            suggestion = update["suggestion"]
            updated[field] = suggestion
            
            # Group updates by section
            section = FORM_SECTIONS.get(field, "Other")
            updates_by_section[section].append(f"*{field}*: **{suggestion}**")
        
        # Format message with sections
        sections_text = []
        for section, updates in updates_by_section.items():
            section_updates = "\n  • " + "\n  • ".join(updates)
            sections_text.append(f"In {section}:{section_updates}")
            
        # Combine AI's conversation message with the updates
        conversation_part = ai_msg.content if ai_msg.content else ""
        updates_part = "\n\nI've updated the following information:\n" + "\n".join(sections_text)
        
        reply = conversation_part + updates_part if conversation_part else "I've updated the following information:\n" + "\n".join(sections_text)
            
        return ChatResponse(
            reply=reply,
            updated_fields=updated
        )

    return ChatResponse(reply=ai_msg.content)
