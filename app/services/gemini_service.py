# Gemini service wrapper
import os
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv
from app.core.prompts import get_prompt_by_role

# Load environment variables and initialize Gemini client
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Define the function declaration for form field updates
suggest_fields_function = {
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
                        "field": {
                            "type": "string",
                            "description": "The form field name to update"
                        },
                        "suggestion": {
                            "type": "string", 
                            "description": "The suggested value for the field"
                        }
                    },
                    "required": ["field", "suggestion"]
                },
                "description": "List of form fields to update with their suggested values"
            }
        },
        "required": ["reply", "updates"]
    }
}

# Configure tools for function calling
tools = types.Tool(function_declarations=[suggest_fields_function])
config = types.GenerateContentConfig(tools=[tools])

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
    
    # Add instruction to use function calling
    system_messages.append(
        "Use the suggest_fields function to provide your response with field updates when relevant information is discussed."
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
    
    # Build the complete prompt
    user_message = messages[-1].content if messages else 'Please help me with the form.'
    prompt = f"{combined_system_prompt}\n\nUser: {user_message}"
    
    # Generate response with function calling
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=config,
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
    
    # Try to access function call directly from the response
    function_call = None
    
    # Method 1: Check if function_call is a direct attribute of the response
    if hasattr(gemini_response, 'function_call') and gemini_response.function_call:
        function_call = gemini_response.function_call
    
    # Method 2: Check candidates
    if not function_call and gemini_response.candidates:
        # Check if function_call is a direct attribute of the candidate
        if hasattr(gemini_response.candidates[0], 'function_call') and gemini_response.candidates[0].function_call:
            function_call = gemini_response.candidates[0].function_call
        
        # Check content
        elif hasattr(gemini_response.candidates[0], 'content') and gemini_response.candidates[0].content:
            content = gemini_response.candidates[0].content
            
            # Check if function_call is a direct attribute of content
            if hasattr(content, 'function_call') and content.function_call:
                function_call = content.function_call
            
            # Check parts
            elif hasattr(content, 'parts') and content.parts:
                for i, part in enumerate(content.parts):
                    if hasattr(part, 'function_call') and part.function_call:
                        function_call = part.function_call
                        break
    
    if function_call:
        # Create tool calls in OpenAI format
        tool_calls = [
            MockToolCall(
                MockFunction(
                    json.dumps(function_call.args)
                )
            )
        ]
        
        # Extract reply from function call arguments
        content = function_call.args.get('reply', '') if function_call.args else ''
        
        return MockMessage(content=content, tool_calls=tool_calls)
    
    # Fallback to text response if no function call
    content = gemini_response.text if hasattr(gemini_response, 'text') else ''
    return MockMessage(content=content, tool_calls=None) 