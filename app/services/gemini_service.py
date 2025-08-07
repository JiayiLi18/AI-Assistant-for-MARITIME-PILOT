# Gemini service wrapper
# This module handles all interactions with the Google Gemini API, including chat completions
# and function calling for form field updates

import os
import json
import google.generativeai as genai
from dotenv import load_dotenv
from app.core.prompts import get_prompt_by_role

# Load environment variables and initialize Gemini client
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Define the function schema for suggesting form field updates
# This schema is used by the Gemini API to structure its function calls
suggest_fields = {
    "name": "suggest_fields",
    "description": "Updates form fields while providing a natural, conversational response to the user.",
    "parameters": {
        "type": "object",
        "properties": {
            "reply": {
                "type": "string",
                "description": "Natural, conversational response to the user. Should explain what you're updating and why, ask follow-up questions, and maintain the conversation flow."
            },
            "updates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "suggestion": {"type": "string"}
                    },
                    "required": ["field", "suggestion"]
                }
            }
        },
        "required": ["reply", "updates"]
    }
}

async def initialize_form(ai_role: str = "co-worker"):
    """
    Initialize form with fixed fields that don't need user confirmation
    
    Args:
        ai_role: The AI role to use for selecting the appropriate prompt
        
    Returns:
        The AI's first message with suggested initial field values
    """
    system_prompt = get_prompt_by_role(ai_role)
    
    # Create Gemini model instance
    model = genai.GenerativeModel('gemini-1.5-flash')
    
    # Prepare the conversation
    messages = [
        {"role": "user", "parts": [system_prompt]},
        {"role": "user", "parts": ["Please use the suggest_fields function to fill in all the fixed fields with the default values shown in the form description. Even if the fields have default values, you MUST call suggest_fields to populate them."]}
    ]
    
    # Create chat session
    chat = model.start_chat(history=[])
    
    # Generate response
    response = await chat.send_message_async(
        messages[-1]["parts"][0],
        generation_config=genai.types.GenerationConfig(
            temperature=0.7,
            top_p=0.8,
            top_k=40,
            max_output_tokens=2048,
        ),
        tools=[suggest_fields]
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
    
    # Create Gemini model instance
    model = genai.GenerativeModel('gemini-1.5-flash')
    
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
    
    # Create chat session with system prompt
    chat = model.start_chat(history=[])
    
    # Convert messages to Gemini format
    gemini_messages = []
    for msg in messages:
        if msg["role"] == "user":
            gemini_messages.append({"role": "user", "parts": [msg["content"]]})
        elif msg["role"] == "assistant":
            gemini_messages.append({"role": "model", "parts": [msg["content"]]})
    
    # Add system prompt as first message
    if gemini_messages:
        # Insert system prompt before the first user message
        gemini_messages.insert(0, {"role": "user", "parts": [combined_system_prompt]})
    else:
        gemini_messages.append({"role": "user", "parts": [combined_system_prompt]})
    
    # Send the last message (which should be the user's input)
    if gemini_messages:
        last_message = gemini_messages[-1]["parts"][0]
        response = await chat.send_message_async(
            last_message,
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                top_p=0.8,
                top_k=40,
                max_output_tokens=2048,
            ),
            tools=[suggest_fields]
        )
    else:
        # Fallback if no messages
        response = await chat.send_message_async(
            "Please help me with the form.",
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                top_p=0.8,
                top_k=40,
                max_output_tokens=2048,
            ),
            tools=[suggest_fields]
        )
    
    # Convert Gemini response to OpenAI-like format
    return convert_gemini_response_to_openai_format(response)

def convert_gemini_response_to_openai_format(gemini_response):
    """
    Convert Gemini API response to OpenAI-like format for compatibility
    
    Args:
        gemini_response: Response from Gemini API
        
    Returns:
        OpenAI-like response object
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
    
    # Extract content from Gemini response
    content = None
    if hasattr(gemini_response, 'text'):
        content = gemini_response.text
    
    # Check for function calls in Gemini response
    tool_calls = None
    if hasattr(gemini_response, 'candidates') and gemini_response.candidates:
        candidate = gemini_response.candidates[0]
        if hasattr(candidate, 'content') and candidate.content:
            for part in candidate.content.parts:
                if hasattr(part, 'function_call'):
                    # Convert Gemini function call to OpenAI format
                    function_call = part.function_call
                    tool_calls = [
                        MockToolCall(
                            MockFunction(
                                json.dumps(function_call.args)
                            )
                        )
                    ]
                    break
    
    return MockMessage(content=content, tool_calls=tool_calls) 