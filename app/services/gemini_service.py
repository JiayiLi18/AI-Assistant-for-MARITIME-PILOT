# Gemini service wrapper
import os
import json
from google import genai
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv
from app.core.prompts import get_prompt_by_role

# Load environment variables and initialize Gemini client
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Define the structured output schema using Pydantic models
class FieldUpdate(BaseModel):
    field: str
    suggestion: str

class FormResponse(BaseModel):
    reply: str
    updates: List[FieldUpdate]

async def initialize_form(ai_role: str = "co-worker"):
    """
    Initialize form with fixed fields that don't need user confirmation
    
    Args:
        ai_role: The AI role to use for selecting the appropriate prompt
        
    Returns:
        The AI's first message with suggested initial field values
    """
    system_prompt = get_prompt_by_role(ai_role)
    
    # Prepare the prompt
    prompt = f"{system_prompt}\n"
    
    # Generate response with structured output
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config={
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 40,
            "max_output_tokens": 2048,
            "response_mime_type": "application/json",
            "response_schema": FormResponse,
        },
    )
    
    # Convert Gemini response to OpenAI-like format
    return convert_gemini_response_to_openai_format(response)

async def chat_completion(messages, form=None, is_first_message=False, ai_role: str = "co-worker"):
    """
    Enhanced chat completion with automatic field initialization
    
    Args:
        messages: List of conversation messages
        form: Current form state dictionary
        is_first_message: Whether this is the first message in the conversation
        ai_role: The AI role to use for selecting the appropriate prompt
    
    Returns:
        Gemini chat completion response with potential function calls
    """
    # Get the appropriate system prompt based on role
    system_prompt = get_prompt_by_role(ai_role)
    
    # Prepare system messages
    system_messages = [system_prompt]
    
    if form:
        system_messages.append(f"Current form values: {form}")
    
    # For first message, add instruction to focus on unfilled fields
    if is_first_message:
        system_messages.append(
            "Focus on gathering information for fields that require user input or confirmation. No need to confirm already filled fields."
        )
    
    # Combine system messages
    combined_system_prompt = "\n\n".join(system_messages)
    
    # Build conversation history
    conversation_history = []
    for msg in messages:
        if msg.role == "user":
            conversation_history.append({"role": "user", "parts": [msg.content]})
        elif msg.role == "assistant":
            conversation_history.append({"role": "model", "parts": [msg.content]})
    
    # Send the system prompt and user message
    prompt = f"{combined_system_prompt}\n\nUser: {messages[-1].content if messages else 'Please help me with the form.'}"
    
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config={
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 40,
            "max_output_tokens": 2048,
            "response_mime_type": "application/json",
            "response_schema": FormResponse,
        },
    )
    
    # Convert Gemini response to OpenAI-like format
    return convert_gemini_response_to_openai_format(response)

def convert_gemini_response_to_openai_format(gemini_response):
    """
    Convert Gemini API response to OpenAI-like format for compatibility
    """
    class MockMessage:
        def __init__(self, content=None, tool_calls=None):
            self.content = content
            self.tool_calls = tool_calls
    
    class MockToolCall:
        def __init__(self, function):
            self.function = function
    
    class MockFunction:
        def __init__(self, arguments):
            self.arguments = arguments
    
    # Extract structured output from Gemini response
    content = None
    tool_calls = None
    
    # Use the parsed response if available
    if hasattr(gemini_response, 'parsed') and gemini_response.parsed:
        structured_data = gemini_response.parsed
        # Convert Pydantic model to dict for JSON serialization
        if hasattr(structured_data, 'model_dump'):
            structured_dict = structured_data.model_dump()
        else:
            structured_dict = structured_data.dict()
        
        tool_calls = [
            MockToolCall(
                MockFunction(
                    json.dumps(structured_dict)
                )
            )
        ]
        # Extract reply from structured data for content
        if isinstance(structured_dict, dict) and 'reply' in structured_dict:
            content = structured_dict['reply']
    elif hasattr(gemini_response, 'text') and gemini_response.text:
        # Fallback to text response if no structured output
        try:
            # Try to parse as JSON first
            structured_dict = json.loads(gemini_response.text)
            tool_calls = [
                MockToolCall(
                    MockFunction(
                        json.dumps(structured_dict)
                    )
                )
            ]
            if isinstance(structured_dict, dict) and 'reply' in structured_dict:
                content = structured_dict['reply']
            else:
                content = gemini_response.text
        except json.JSONDecodeError:
            # If not JSON, use as regular text content
            content = gemini_response.text
    
    return MockMessage(content=content, tool_calls=tool_calls) 