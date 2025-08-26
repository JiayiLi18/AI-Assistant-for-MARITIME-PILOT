# Voice WebSocket Router
# This module handles WebSocket connections for real-time voice communication
# between the frontend and OpenAI's Realtime API

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
import json
import logging
import asyncio
import base64
from typing import Dict, Any, Optional
from app.services.voice_service import voice_service

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter()

class VoiceWebSocketManager:
    """
    Manages WebSocket connections for voice communication
    
    Handles:
    - Client WebSocket connections from frontend
    - OpenAI Realtime API connections
    - Audio streaming in both directions
    - Function calling for form updates
    """
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_configs: Dict[str, Dict[str, Any]] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str, ai_role: str = "co-worker", form_data: Optional[Dict[str, Any]] = None):
        """
        Accept a new WebSocket connection from frontend
        
        Args:
            websocket: FastAPI WebSocket instance
            client_id: Unique identifier for the client
            ai_role: AI role for personalized prompts
            form_data: Current form state
        """
        logger.info(f"[VOICE_ROUTER] Accepting WebSocket connection for client: {client_id}")
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.connection_configs[client_id] = {
            "ai_role": ai_role,
            "form_data": form_data or {}
        }
        
        # Set up OpenAI voice service callbacks for this connection
        voice_service.on_audio_received = lambda audio: (
            logger.info(f"[VOICE_ROUTER] Audio received callback triggered for client {client_id}: {len(audio)} bytes"),
            asyncio.create_task(self._send_audio_to_client(client_id, audio))
        )[-1]
        voice_service.on_function_call = lambda data: (
            logger.info(f"[VOICE_ROUTER] Function call callback triggered for client {client_id}: {data}"),
            asyncio.create_task(self._handle_function_call(client_id, data))
        )[-1]
        voice_service.on_transcript = lambda text: (
            logger.info(f"[VOICE_ROUTER] Transcript callback triggered for client {client_id}: {text}"),
            asyncio.create_task(self._send_transcript_to_client(client_id, text))
        )[-1]
        voice_service.on_error = lambda error: (
            logger.error(f"[VOICE_ROUTER] Error callback triggered for client {client_id}: {error}"),
            asyncio.create_task(self._send_error_to_client(client_id, error))
        )[-1]
        
        # Initialize voice service with chained architecture
        logger.info(f"[VOICE_ROUTER] Initializing voice service for client: {client_id}")
        connection_success = await voice_service.connect()
        if not connection_success:
            logger.error(f"[VOICE_ROUTER] Failed to initialize voice service for client: {client_id}")
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Failed to initialize voice service"
            }))
            return
        
        # Update AI context with role and form data
        await self._update_ai_context(client_id)
        
        # Function calling will be enabled when form context is first updated
        
        logger.info(f"[VOICE_ROUTER] Voice WebSocket connected successfully for client: {client_id}")
    
    async def disconnect(self, client_id: str):
        """
        Disconnect a client and clean up resources
        
        Args:
            client_id: Client identifier to disconnect
        """
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        
        if client_id in self.connection_configs:
            del self.connection_configs[client_id]
        
        # If no more active connections, disconnect voice service
        if not self.active_connections:
            await voice_service.disconnect()
        
        logger.info(f"[VOICE_ROUTER] Voice WebSocket disconnected for client: {client_id}")
    
    async def handle_client_message(self, client_id: str, message: Dict[str, Any]):
        """
        Handle incoming messages from frontend clients
        
        Args:
            client_id: Client identifier
            message: Parsed JSON message from client
        """
        message_type = message.get("type")
        logger.info(f"[VOICE_ROUTER] Received message from client {client_id}: type={message_type}")
        
        if message_type == "audio_chunk":
            # Note: Individual audio chunks are not used in chained architecture
            # Audio should be sent as complete messages via text_message with base64 prefix
            logger.warning(f"[VOICE_ROUTER] audio_chunk not supported in chained architecture, use batch audio instead")
        
        elif message_type == "audio_end":
            # Note: audio_end is not needed in chained architecture
            logger.warning(f"[VOICE_ROUTER] audio_end not supported in chained architecture")
        
        elif message_type == "text_message":
            # Process text message using chained architecture
            text = message.get("text", "")
            logger.info(f"[VOICE_ROUTER] Processing text message: {text[:100]}...")
            
            # Check if this is a batch audio message
            if text.startswith("[VOICE_AUDIO_BASE64]"):
                # Extract audio data and process as audio using chained architecture
                audio_b64 = text[len("[VOICE_AUDIO_BASE64]"):]
                logger.info(f"[VOICE_ROUTER] Processing batch audio message, base64 length: {len(audio_b64)}")
                try:
                    audio_data = base64.b64decode(audio_b64)
                    logger.info(f"[VOICE_ROUTER] Decoded audio: {len(audio_data)} bytes")
                    
                    # Use new chained architecture processing
                    response = await voice_service.process_audio_message(audio_data)
                    
                    # Send audio response back to client if available
                    if response.get("audio"):
                        audio_b64 = base64.b64encode(response["audio"]).decode('utf-8')
                        await self._send_to_client(client_id, "audio_chunk", {"audio": audio_b64, "format": "mp3"})
                    
                    logger.info(f"[VOICE_ROUTER] Successfully processed batch audio: {len(audio_data)} bytes -> {len(response.get('text', ''))} chars response")
                except Exception as e:
                    logger.error(f"[VOICE_ROUTER] Error processing batch audio: {e}")
            else:
                # Regular text message using chained architecture
                logger.info(f"[VOICE_ROUTER] Processing regular text message")
                try:
                    response = await voice_service.process_text_message(text)
                    
                    # Send audio response back to client if available
                    if response.get("audio"):
                        audio_b64 = base64.b64encode(response["audio"]).decode('utf-8')
                        await self._send_to_client(client_id, "audio_chunk", {"audio": audio_b64, "format": "mp3"})
                    
                    logger.info(f"[VOICE_ROUTER] Text message processed: {len(response.get('text', ''))} chars response")
                except Exception as e:
                    logger.error(f"[VOICE_ROUTER] Error processing text message: {e}")
        
        elif message_type == "form_update":
            # Update form context
            form_data = message.get("form_data", {})
            logger.info(f"[VOICE_ROUTER] Updating form context for client {client_id}")
            self.connection_configs[client_id]["form_data"] = form_data
            await self._update_ai_context(client_id)
        
        elif message_type == "role_change":
            # Update AI role
            ai_role = message.get("ai_role", "co-worker")
            logger.info(f"[VOICE_ROUTER] Changing AI role to {ai_role} for client {client_id}")
            self.connection_configs[client_id]["ai_role"] = ai_role
            await self._update_ai_context(client_id)
        
        else:
            logger.warning(f"[VOICE_ROUTER] Unknown message type from client {client_id}: {message_type}")
    
    async def _update_ai_context(self, client_id: str):
        """
        Update OpenAI context with current role and form data
        
        Args:
            client_id: Client identifier
        """
        if client_id not in self.connection_configs:
            return
        
        config = self.connection_configs[client_id]
        ai_role = config.get("ai_role", "co-worker")
        form_data = config.get("form_data", {})
        
        # Update AI role using the integrated method
        voice_service.update_ai_role(ai_role)
        
        # Update form context (this will enable tools if form_data is not empty)
        await voice_service.update_form_context(form_data)
    
    async def _send_to_client(self, client_id: str, message_type: str, data: Dict[str, Any]):
        """
        Generic method to send messages to a specific client
        
        Args:
            client_id: Target client
            message_type: Type of message
            data: Message data
        """
        if client_id not in self.active_connections:
            return
        
        websocket = self.active_connections[client_id]
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        
        try:
            message = {"type": message_type, **data}
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Error sending {message_type} to client {client_id}: {e}")
    
    async def _send_audio_to_client(self, client_id: str, audio_data: bytes):
        """
        Send audio data to a specific client
        
        Args:
            client_id: Target client
            audio_data: PCM16 audio data
        """
        audio_b64 = base64.b64encode(audio_data).decode('utf-8')
        # In chained architecture we return MP3 from TTS, mark format explicitly
        await self._send_to_client(client_id, "audio_chunk", {"audio": audio_b64, "format": "mp3"})
    
    async def _handle_function_call(self, client_id: str, function_data: Dict[str, Any]):
        """
        Handle function calls from OpenAI and forward to client, then send tool result back to Realtime.
        Expected function_data: {"call_id": str, "name": "suggest_fields", "reply": str, "updates": [{field, suggestion}, ...]}
        """
        # 1) 透传给前端（你原有逻辑）
        await self._send_to_client(client_id, "function_call", {"data": function_data})

        # 2) 本地更新缓存（你原有逻辑）
        if "updates" in function_data and client_id in self.connection_configs:
            config = self.connection_configs[client_id]
            form_data = config.get("form_data", {})
            for update in function_data["updates"]:
                field = update.get("field")
                suggestion = update.get("suggestion")
                if field and suggestion is not None:
                    form_data[field] = suggestion
            config["form_data"] = form_data

        # 3) 回传 tool 输出给 Realtime（关键新增）
        call_id = function_data.get("call_id")
        if call_id:
            # 这里的输出可以是工具"执行结果"。为了和文字版一致，我们把 AI 的 reply 与实际应用的 updates 一并返回
            tool_output = {
                "ok": True,
                "applied_updates": function_data.get("updates", []),
                "reply": function_data.get("reply", "")
            }
            # 发送给 Realtime，促使模型在语音里继续说下去（会结合 reply 内容）
            await voice_service.send_tool_result(call_id, tool_output, trigger_followup=True)
    
    async def _send_transcript_to_client(self, client_id: str, transcript: str):
        """
        Send transcript data to client
        
        Args:
            client_id: Target client
            transcript: Transcribed text
        """
        await self._send_to_client(client_id, "transcript", {"text": transcript})
    
    async def _send_error_to_client(self, client_id: str, error: str):
        """
        Send error message to client
        
        Args:
            client_id: Target client
            error: Error message
        """
        await self._send_to_client(client_id, "error", {"message": error})

# Global WebSocket manager instance
ws_manager = VoiceWebSocketManager()

@router.websocket("/voice/{client_id}")
async def voice_websocket_endpoint(websocket: WebSocket, client_id: str):
    """
    WebSocket endpoint for voice communication
    
    Args:
        websocket: WebSocket connection
        client_id: Unique client identifier
    """
    logger.info(f"Voice WebSocket connection attempt from client: {client_id}")
    
    try:
        # Accept connection and set up voice service
        await ws_manager.connect(websocket, client_id)
        
        # Listen for messages from client
        while True:
            try:
                # Receive message from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle the message
                await ws_manager.handle_client_message(client_id, message)
                
            except WebSocketDisconnect:
                logger.info(f"Client {client_id} disconnected")
                break
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from client {client_id}: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON format"
                }))
            except Exception as e:
                logger.error(f"Error handling message from client {client_id}: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error", 
                    "message": f"Server error: {str(e)}"
                }))
    
    except Exception as e:
        logger.error(f"Voice WebSocket error for client {client_id}: {e}")
    
    finally:
        # Clean up connection
        await ws_manager.disconnect(client_id)
