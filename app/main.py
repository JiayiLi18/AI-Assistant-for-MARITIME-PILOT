"""
# FastAPI entry-point
# This is the main application file that sets up the FastAPI server and middleware
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import chat


app = FastAPI()

# Configure CORS (Cross-Origin Resource Sharing) middleware
# This allows the frontend to make requests to the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default port for local development
        "https://maritime-pilot-ai-assistant.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
