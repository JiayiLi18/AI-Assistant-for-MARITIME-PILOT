# OpenAI service wrapper
# This module handles all interactions with the OpenAI API, including chat completions
# and function calling for form field updates

import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
from app.core.prompts import get_prompt_by_role

# Load environment variables and initialize OpenAI client
load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Define the function schema for suggesting form field updates
# This schema is used by the OpenAI API to structure its function calls
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

async def chat_completion(messages, form=None, is_first_message=False, ai_role: str = "co-worker"):
    """
    Enhanced chat completion with automatic field initialization
    
    Args:
        messages: List of conversation messages
        form: Current form state dictionary
        is_first_message: Whether this is the first message in the conversation
        ai_role: The AI role to use for selecting the appropriate prompt
    
    Returns:
        OpenAI chat completion response with potential function calls
    """
    # Get the appropriate system prompt based on role
    system_prompt = get_prompt_by_role(ai_role)
    
    # Add system prompt and current form state to messages
    system_messages = [{"role": "system", "content": system_prompt}]
    
    if form:
        system_messages.append({
            "role": "system", 
            "content": f"Current form values: {form}"
        })
    
    # For first message, add instruction to focus on unfilled fields
    if is_first_message:
        system_messages.append({
            "role": "system",
            "content": "Focus on gathering information for fields that require user input or confirmation. No need to confirm already filled fields."
        })
    
    # Combine all messages and make the API call
    all_messages = system_messages + messages

    resp = await client.chat.completions.create(
        model="gpt-4o",
        messages=all_messages,
        tools=[{
            "type": "function",
            "function": suggest_fields
        }],
        tool_choice="auto"
    )
    result = resp.choices[0].message
    print(f"[OPENAI] Chat response - Tool calls: {bool(result.tool_calls)}, Messages: {len(messages)}")
    return result
