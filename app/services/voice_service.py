# Voice service for OpenAI Chained Architecture (STT + Chat + TTS)
# This module handles voice interactions using separate speech-to-text, chat, and text-to-speech APIs

import os
import json
import asyncio
import base64
import io
from typing import Optional, Callable, Dict, Any
from dotenv import load_dotenv
import logging
from openai import AsyncOpenAI
from app.services.openai_service import suggest_fields, chat_completion
from app.core.prompts import get_prompt_by_role

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

class VoiceService:
    """
    Service for handling voice interactions using OpenAI's Chained Architecture
    
    This service manages:
    - Speech-to-Text using Whisper API
    - Chat completions with function calling
    - Text-to-Speech using TTS API
    - Form context and conversation history
    """
    
    def __init__(self):
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        if not self.openai_api_key:
            logger.error("[VOICE_SERVICE] OPENAI_API_KEY not found in environment variables")
        else:
            logger.info(f"[VOICE_SERVICE] OPENAI_API_KEY loaded successfully (length: {len(self.openai_api_key)})")
        
        # Initialize OpenAI client
        self.client = AsyncOpenAI(api_key=self.openai_api_key)
        
        # Service state
        self.is_connected = False
        self.current_ai_role = "co-worker"
        self.conversation_history = []
        self.form_context = {}
        
        # TTS configuration
        self.tts_voice = "alloy"  # alloy, echo, fable, onyx, nova, shimmer
        
        # Callbacks for handling events
        self.on_audio_received: Optional[Callable[[bytes], None]] = None
        self.on_function_call: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_transcript: Optional[Callable[[str], None]] = None
        self.on_error: Optional[Callable[[str], None]] = None
    
    def _get_voice_instructions(self, ai_role: str) -> str:
        """
        Generate voice-specific instructions based on AI role
        
        Args:
            ai_role: The AI role (co-worker, butler, coach)
            
        Returns:
            Combined instructions for voice interaction
        """
        base_prompt = get_prompt_by_role(ai_role)
        voice_instructions = (
            "你正在通过语音与用户交流。请保持自然、简洁的对话风格。"
            "如果需要更新表单字段，请使用suggest_fields函数。"
            "始终提供自然的语音回复，同时处理表单更新。"
        )
        return f"{base_prompt}\n\n{voice_instructions}"
    
    def update_ai_role(self, ai_role: str):
        """
        Update the AI role
        
        Args:
            ai_role: New AI role
        """
        self.current_ai_role = ai_role
        logger.info(f"[VOICE_SERVICE] Updated AI role to: {ai_role}")
    
    async def connect(self) -> bool:
        """
        Initialize the voice service (no WebSocket needed for chained architecture)
        
        Returns:
            bool: True if service is ready
        """
        try:
            # Test OpenAI API connection
            if not self.openai_api_key:
                raise Exception("OpenAI API key not found")
            
            self.is_connected = True
            logger.info("[VOICE_SERVICE] Voice service initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Failed to initialize voice service: {e}")
            self.is_connected = False
            if self.on_error:
                self.on_error(f"Service initialization failed: {str(e)}")
            return False
    
    async def disconnect(self):
        """Disconnect the voice service"""
        self.is_connected = False
        self.conversation_history = []
        logger.info("[VOICE_SERVICE] Voice service disconnected")
    
    async def transcribe_audio(self, audio_data: bytes) -> str:
        """
        Convert audio to text using Whisper API
        
        Args:
            audio_data: Raw PCM16 audio data
            
        Returns:
            Transcribed text
        """
        try:
            # 调试：检查音频数据
            logger.info(f"[VOICE_SERVICE] Audio data: {len(audio_data)} bytes, first 20 bytes: {audio_data[:20].hex()}")
            
            # Create WAV file in memory with proper headers for PCM16 data
            audio_file = self._create_wav_file(audio_data)
            
            # Call Whisper API with improved parameters
            logger.info(f"[VOICE_SERVICE] Transcribing audio: {len(audio_data)} bytes")
            transcript = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="en",  # 明确指定英语，提高识别准确性
                prompt="This is a maritime pilot report in English. Please transcribe clearly and accurately.",
                response_format="text"  # 直接返回文本格式
            )
            
            # 调试：检查API响应
            logger.info(f"[VOICE_SERVICE] Whisper API response type: {type(transcript)}, content: {transcript}")
            
            # 处理不同的响应格式
            if isinstance(transcript, str):
                # 如果response_format="text"，直接返回字符串
                transcribed_text = transcript.strip()
            elif hasattr(transcript, 'text'):
                # 如果返回的是对象，获取text属性
                transcribed_text = transcript.text.strip()
            else:
                # 其他情况，尝试转换为字符串
                transcribed_text = str(transcript).strip()
            
            # 验证转录结果
            if not transcribed_text or transcribed_text.lower() in ['', 'null', 'none']:
                logger.warning("[VOICE_SERVICE] Whisper returned empty or invalid transcript")
                return ""
            
            # 检查是否包含韩语等非预期语言（可能是噪音导致的误识别）
            if any(char in transcribed_text for char in ['뉴스', '김재경', '입니다', '안녕하세요']):
                logger.warning(f"[VOICE_SERVICE] Detected Korean text, likely noise: {transcribed_text}")
                return ""
            
            logger.info(f"[VOICE_SERVICE] Transcription completed: {transcribed_text}")
            
            # 通知前端用户说了什么
            if self.on_transcript:
                self.on_transcript(transcribed_text)
            
            return transcribed_text
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Transcription failed: {e}")
            logger.error(f"[VOICE_SERVICE] Exception type: {type(e)}")
            logger.error(f"[VOICE_SERVICE] Exception details: {str(e)}")
            if self.on_error:
                self.on_error(f"语音识别失败: {str(e)}")
            return ""
    
    def _format_updates(self, updated_fields: Dict[str, Any]) -> str:
        """Format field updates grouped by section with compact listing"""
        if not updated_fields:
            return ""

        # Field info mapping (keep in sync with frontend and chat router)
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
            "hazards-description": ("2. Safety Observations", "Hazards"),
            # 4. Pilotage Recommendations
            "pilotage-comments": ("3. Pilotage Practices & Recommendations", "Pilotage Comments"),
            "improvements": ("3. Pilotage Practices & Recommendations", "Improvements"),
            # 5. Work-Related Stress
            "workload": ("4. Work-Related Stress & Fatigue", "Workload"),
            "additional-comment": ("4. Work-Related Stress & Fatigue", "Additional Comments"),
            # 6. Submission
            "submitted-by": ("Submission Details", "Submitted by"),
            "submission-date": ("Submission Details", "Date of Submission"),
        }

        # Group updates by section, preserving input order
        section_to_items = {}
        standalone_items = []

        for field, value in updated_fields.items():
            # Normalize workload to string for consistent display
            if field == "workload" and isinstance(value, (int, float)):
                value = str(int(value))
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

    def _create_wav_file(self, pcm_data: bytes) -> io.BytesIO:
        """Create a proper WAV file from PCM16 data"""
        wav_file = io.BytesIO()
        
        # WAV file header - 使用16kHz采样率，Whisper推荐
        sample_rate = 16000
        channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * channels * bits_per_sample // 8
        block_align = channels * bits_per_sample // 8
        data_size = len(pcm_data)
        
        # Write WAV header
        wav_file.write(b'RIFF')
        wav_file.write((36 + data_size).to_bytes(4, 'little'))
        wav_file.write(b'WAVE')
        wav_file.write(b'fmt ')
        wav_file.write((16).to_bytes(4, 'little'))
        wav_file.write((1).to_bytes(2, 'little'))  # PCM format
        wav_file.write(channels.to_bytes(2, 'little'))
        wav_file.write(sample_rate.to_bytes(4, 'little'))
        wav_file.write(byte_rate.to_bytes(4, 'little'))
        wav_file.write(block_align.to_bytes(2, 'little'))
        wav_file.write(bits_per_sample.to_bytes(2, 'little'))
        wav_file.write(b'data')
        wav_file.write(data_size.to_bytes(4, 'little'))
        wav_file.write(pcm_data)
        
        wav_file.seek(0)
        wav_file.name = "audio.wav"
        return wav_file
    
    async def generate_chat_response(self, user_text: str) -> Dict[str, Any]:
        """
        Generate chat response with function calling
        
        Args:
            user_text: User's message text
            
        Returns:
            Response containing text and potential function calls
        """
        try:
            # Add user message to history
            self.conversation_history.append({"role": "user", "content": user_text})
            
            # Call chat completion with form context
            logger.info(f"[VOICE_SERVICE] Generating chat response for: {user_text[:100]}...")
            response = await chat_completion(
                messages=self.conversation_history.copy(),
                form=self.form_context,
                ai_role=self.current_ai_role
            )
            
            # Process the response
            result = {
                "text": response.content or "",
                "function_calls": []
            }
            
            logger.info(f"[VOICE_SERVICE] Raw response content: {response.content}")
            logger.info(f"[VOICE_SERVICE] Tool calls present: {bool(response.tool_calls)}")
            
            # Handle function calls first to get the complete response
            updated_fields = {}
            ai_reply_text = response.content or ""
            
            if response.tool_calls:
                for tool_call in response.tool_calls:
                    if tool_call.function.name == "suggest_fields":
                        try:
                            function_args = json.loads(tool_call.function.arguments)
                            result["function_calls"].append({
                                "call_id": tool_call.id,
                                "name": tool_call.function.name,
                                "reply": function_args.get("reply", ""),
                                "updates": function_args.get("updates", [])
                            })
                            
                            # Use the reply from function call if response.content is empty
                            if not ai_reply_text and function_args.get("reply"):
                                ai_reply_text = function_args.get("reply", "")
                            
                            # Collect updated fields for formatting
                            for update in function_args.get("updates", []):
                                field = update.get("field")
                                suggestion = update.get("suggestion")
                                if field and suggestion is not None:
                                    updated_fields[field] = suggestion
                            
                            logger.info(f"[VOICE_SERVICE] Function call processed: {function_args}")
                        except Exception as e:
                            logger.error(f"[VOICE_SERVICE] Function call parsing error: {e}")
            
            # Update result with the actual AI reply text
            result["text"] = ai_reply_text
            
            # Add assistant message to history (use the AI reply text)
            self.conversation_history.append({"role": "assistant", "content": ai_reply_text})
            
            return result
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Chat completion failed: {e}")
            if self.on_error:
                self.on_error(f"AI回复生成失败: {str(e)}")
            return {"text": "抱歉，我现在无法回复您的问题。", "function_calls": []}
    
    async def synthesize_speech(self, text: str) -> bytes:
        """
        Convert text to speech using TTS API
        
        Args:
            text: Text to convert to speech
            
        Returns:
            Audio data in MP3 format
        """
        try:
            logger.info(f"[VOICE_SERVICE] Synthesizing speech: {text[:100]}...")
            
            response = await self.client.audio.speech.create(
                model="tts-1",  # 使用更经济的模型，也可以用tts-1-hd获得更好质量
                voice=self.tts_voice,
                input=text,
                response_format="mp3"
            )
            
            audio_data = response.content
            logger.info(f"[VOICE_SERVICE] Speech synthesis completed: {len(audio_data)} bytes")
            
            return audio_data
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Speech synthesis failed: {e}")
            if self.on_error:
                self.on_error(f"语音合成失败: {str(e)}")
            return b""
    
    async def process_audio_message(self, audio_data: bytes) -> Dict[str, Any]:
        """
        Complete voice processing pipeline: STT -> Chat -> TTS
        
        Args:
            audio_data: Raw audio data from user
            
        Returns:
            Dict containing response text, audio, and function calls
        """
        try:
            # Step 1: Speech to Text
            logger.info("[VOICE_SERVICE] Starting voice processing pipeline...")
            user_text = await self.transcribe_audio(audio_data)
            
            if not user_text:
                return {"text": "", "audio": b"", "function_calls": []}
            
            # Step 2: Generate response
            chat_response = await self.generate_chat_response(user_text)
            
            # Step 3: Format complete response with field updates
            updated_fields = {}
            if chat_response["function_calls"]:
                for func_call in chat_response["function_calls"]:
                    for update in func_call.get("updates", []):
                        field = update.get("field")
                        suggestion = update.get("suggestion")
                        if field and suggestion is not None:
                            updated_fields[field] = suggestion
            
            # Create complete text response (for display)
            ai_text = chat_response["text"] or ""
            complete_text = ai_text
            if updated_fields:
                updates_text = self._format_updates(updated_fields)
                complete_text += f"\n\n---\n\n{updates_text}\n\n---"
            
            # Step 4: Text to Speech (use AI reply text only, not the formatted updates)
            audio_response = b""
            if ai_text:
                audio_response = await self.synthesize_speech(ai_text)
            
            logger.info(f"[VOICE_SERVICE] TTS using text: {ai_text[:100] if ai_text else 'NO TEXT'}...")
            logger.info(f"[VOICE_SERVICE] Complete text for display: {complete_text[:100] if complete_text else 'NO TEXT'}...")
            
            # Call on_function_call callback for form updates, but modify it to avoid message duplication
            if chat_response["function_calls"] and self.on_function_call:
                for func_call in chat_response["function_calls"]:
                    # Remove the 'reply' field to prevent duplicate message display
                    func_call_data = func_call.copy()
                    func_call_data.pop('reply', None)  # Remove reply to avoid duplicate message
                    self.on_function_call(func_call_data)
            
            # Send complete AI text response (including updates) as transcript - this is the only message
            if complete_text and self.on_transcript:
                self.on_transcript(f"[AI_TEXT]: {complete_text}")
            
            if audio_response and self.on_audio_received:
                self.on_audio_received(audio_response)
            
            result = {
                "text": complete_text,
                "audio": audio_response,
                "function_calls": chat_response["function_calls"]
            }
            
            logger.info(f"[VOICE_SERVICE] Voice processing completed: {len(result['text'])} chars, {len(result['audio'])} bytes audio")
            return result
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Voice processing pipeline failed: {e}")
            if self.on_error:
                self.on_error(f"语音处理失败: {str(e)}")
            return {"text": "", "audio": b"", "function_calls": []}
    
    async def process_text_message(self, text: str) -> Dict[str, Any]:
        """
        Process text message and generate voice response
        
        Args:
            text: User's text message
            
        Returns:
            Dict containing response text, audio, and function calls
        """
        try:
            logger.info(f"[VOICE_SERVICE] Processing text message: {text[:100]}...")
            
            # Generate response
            chat_response = await self.generate_chat_response(text)
            
            # Format complete response with field updates
            updated_fields = {}
            if chat_response["function_calls"]:
                for func_call in chat_response["function_calls"]:
                    for update in func_call.get("updates", []):
                        field = update.get("field")
                        suggestion = update.get("suggestion")
                        if field and suggestion is not None:
                            updated_fields[field] = suggestion
            
            # Create complete text response (for display)
            ai_text = chat_response["text"] or ""
            complete_text = ai_text
            if updated_fields:
                updates_text = self._format_updates(updated_fields)
                complete_text += f"\n\n---\n\n{updates_text}\n\n---"
            
            # Convert response to speech (use AI reply text only, not the formatted updates)
            audio_response = b""
            if ai_text:
                audio_response = await self.synthesize_speech(ai_text)
            
            # Call on_function_call callback for form updates, but modify it to avoid message duplication
            if chat_response["function_calls"] and self.on_function_call:
                for func_call in chat_response["function_calls"]:
                    # Remove the 'reply' field to prevent duplicate message display
                    func_call_data = func_call.copy()
                    func_call_data.pop('reply', None)  # Remove reply to avoid duplicate message
                    self.on_function_call(func_call_data)
            
            # Send complete AI text response (including updates) as transcript - this is the only message
            if complete_text and self.on_transcript:
                self.on_transcript(f"[AI_TEXT]: {complete_text}")
            
            if audio_response and self.on_audio_received:
                self.on_audio_received(audio_response)
            
            result = {
                "text": complete_text,
                "audio": audio_response,
                "function_calls": chat_response["function_calls"]
            }
            
            logger.info(f"[VOICE_SERVICE] Text processing completed: {len(result['text'])} chars, {len(result['audio'])} bytes audio")
            return result
            
        except Exception as e:
            logger.error(f"[VOICE_SERVICE] Text processing failed: {e}")
            if self.on_error:
                self.on_error(f"文本处理失败: {str(e)}")
            return {"text": "", "audio": b"", "function_calls": []}
    
    async def update_form_context(self, form_data: Dict[str, Any]):
        """
        Update the AI context with current form data
        
        Args:
            form_data: Current form field values
        """
        self.form_context = form_data.copy() if form_data else {}
        logger.info(f"[VOICE_SERVICE] Updated form context: {len(self.form_context)} fields")
    
    # Compatibility methods for existing router
    async def send_audio_chunk(self, audio_data: bytes):
        """Compatibility method - not used in chained architecture"""
        logger.warning("[VOICE_SERVICE] send_audio_chunk called but not supported in chained architecture")
    
    async def commit_audio(self):
        """Compatibility method - not used in chained architecture"""
        logger.warning("[VOICE_SERVICE] commit_audio called but not supported in chained architecture")
    
    async def send_text_message(self, text: str):
        """
        Process text message using chained architecture
        
        Args:
            text: Text message to process
        """
        await self.process_text_message(text)
    
    async def send_tool_result(self, call_id: str, output: Any, trigger_followup: bool = True):
        """Compatibility method - not used in chained architecture"""
        logger.warning(f"[VOICE_SERVICE] send_tool_result called but not supported in chained architecture: {call_id}")

# 已移除旧的WebSocket实时API代码，现在使用链式架构：STT -> Chat -> TTS

# Global voice service instance
voice_service = VoiceService()
