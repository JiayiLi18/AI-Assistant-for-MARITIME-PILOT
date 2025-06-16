# wrapper around OpenAI ChatCompletion
import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
from app.core.prompts import SYSTEM_PROMPT

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# function schema
suggest_fields = {
    "name": "suggest_fields",
    "description": "Proposes values for multiple form fields at once.",
    "parameters": {
        "type": "object",
        "properties": {
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
        "required": ["updates"]
    }
}

async def chat_completion(messages, form=None):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    if form:
        messages.append({
            "role": "system",
            "content": f"Current form values: {form}"
        })

    resp = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=[{
            "type": "function",
            "function": suggest_fields
        }],
        tool_choice="auto"
    )
    return resp.choices[0].message
