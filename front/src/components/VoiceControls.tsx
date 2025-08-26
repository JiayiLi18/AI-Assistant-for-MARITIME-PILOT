"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Mic } from "lucide-react"
import { voiceService, VoiceCallbacks } from "@/services/voiceService"
import VoiceWaveIcon from "@/components/ui/voice-wave-icon"

interface VoiceControlsProps {
  isEnabled: boolean;
  aiRole: string;
  formData: Record<string, any>;
  onFormUpdate?: (updates: Record<string, any>) => void;
  onTranscript?: (text: string) => void;
  onVoiceReply?: (reply: string) => void;
  onVoiceToggle?: () => void;
  compactMode?: boolean;
  hasStarted?: boolean;
}

export default function VoiceControls({
  isEnabled,
  aiRole,
  formData,
  onFormUpdate,
  onTranscript,
  onVoiceReply,
  onVoiceToggle,
  compactMode = false,
  hasStarted = false
}: VoiceControlsProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
  
  // Set up voice service callbacks
  useEffect(() => {
    const callbacks: VoiceCallbacks = {
      onConnectionChange: (connected) => {
        setIsConnected(connected)
        setConnectionStatus(connected ? 'connected' : 'disconnected')
        if (!connected) {
          setIsRecording(false)
          setIsPlaying(false)
        }
      },
      
      onRecordingStateChange: (recording) => {
        setIsRecording(recording)
      },
      
      onPlayingStateChange: (playing) => {
        setIsPlaying(playing)
      },
      
      onFunctionCall: (data) => {
        console.log('[VoiceControls] Function call received:', data)
        
        // Handle voice reply
        if (data.reply && onVoiceReply) {
          onVoiceReply(data.reply)
        }
        
        // Handle form updates
        if (data.updates && data.updates.length > 0 && onFormUpdate) {
          const updates: Record<string, any> = {}
          data.updates.forEach(update => {
            updates[update.field] = update.suggestion
          })
          onFormUpdate(updates)
        }
      },
      
      onTranscript: (text) => {
        console.log('[VoiceControls] Transcript received:', text)
        
        if (text.startsWith('[AI]: ')) {
          // This is an AI voice response transcript
          const aiText = text.substring(6); // Remove '[AI]: ' prefix
          if (onVoiceReply) {
            onVoiceReply(aiText)
          }
        } else if (text.startsWith('[AI_TEXT]: ')) {
          // This is AI text response (from chained architecture)
          const aiText = text.substring(11); // Remove '[AI_TEXT]: ' prefix
          if (onVoiceReply) {
            onVoiceReply(aiText)
          }
        } else {
          // This is user transcript
          if (onTranscript) {
            onTranscript(text)
          }
        }
      },
      
      onError: (errorMsg) => {
        console.error('[VoiceControls] Voice error:', errorMsg)
        setConnectionStatus('error')
        
        // Auto-clear error after 5 seconds
        setTimeout(() => {
          if (!isConnected) {
            setConnectionStatus('disconnected')
          }
        }, 5000)
      },
      
      onAudioReceived: (_audioData) => {
        setIsPlaying(true)
        // Playing state is managed by the voice service
        setTimeout(() => {
          if (!voiceService.getIsPlaying()) {
            setIsPlaying(false)
          }
        }, 100)
      }
    }
    
    voiceService.setCallbacks(callbacks)
  }, [onFormUpdate, onTranscript, onVoiceReply])
  
  // Update form context when form data changes
  useEffect(() => {
    if (isConnected && formData) {
      voiceService.updateFormContext(formData)
    }
  }, [formData, isConnected])
  
  // Update AI role when it changes
  useEffect(() => {
    if (isConnected && aiRole) {
      voiceService.changeRole(aiRole)
    }
  }, [aiRole, isConnected])
  
  // Auto-connect when hasStarted becomes true
  useEffect(() => {
    const autoConnect = async () => {
      if (hasStarted && !isConnected && connectionStatus === 'disconnected') {
        console.log('[VoiceControls] Auto-connecting to voice service after start...')
        await handleConnect()
      }
    }
    
    if (hasStarted) {
      // Small delay to ensure component is ready
      const timer = setTimeout(autoConnect, 500)
      return () => clearTimeout(timer)
    }
  }, [hasStarted]) // Depend on hasStarted
  
  const handleConnect = async () => {
    if (isConnected) {
      voiceService.disconnect()
      return
    }
    
    setConnectionStatus('connecting')
    
    try {
      const success = await voiceService.connect()
      if (!success) {
        setConnectionStatus('error')
        console.error('[VoiceControls] Failed to connect to voice service')
      }
    } catch (err) {
      setConnectionStatus('error')
      console.error('[VoiceControls] Connection failed:', err)
    }
  }
  
  const handleRecordingStart = async () => {
    if (!isConnected) {
      console.warn('[VoiceControls] Cannot record - not connected to voice service')
      return
    }
    
    console.log('[VoiceControls] Starting recording, isPlaying:', isPlaying, 'isRecording:', isRecording)
    
    // Always hard-stop audio playback when starting recording
    console.log('[VoiceControls] HARD STOP any ongoing audio playback...')
    voiceService.stopAllAudioNow()
    
    if (!isRecording) {
      const success = await voiceService.startRecording()
      if (!success) {
        console.error('[VoiceControls] Failed to start recording')
      }
    }
  }

  const handleRecordingStop = () => {
    if (isConnected && isRecording) {
      voiceService.stopRecording()
    }
  }
  

  
  if (!isEnabled) {
    return null
  }
  
  // Remove the instructionsOnly mode to avoid complexity
  
  // Compact mode for inline use in chat input
  if (compactMode) {
    const handleVoiceMouseDown = async () => {
      if (!hasStarted) {
        return
      }
      
      if (!isConnected) {
        // Auto-connect first
        await handleConnect()
        if (onVoiceToggle) {
          onVoiceToggle()
        }
        // Wait a bit for connection to establish
        setTimeout(async () => {
          if (voiceService.getIsConnected()) {
            await handleRecordingStart()
          }
        }, 500)
      } else {
        // Start recording immediately
        await handleRecordingStart()
      }
    }

    const handleVoiceMouseUp = () => {
      if (hasStarted && isRecording) {
        handleRecordingStop()
      }
    }

    const handleVoiceMouseLeave = () => {
      // Stop recording if mouse leaves while recording
      if (hasStarted && isRecording) {
        handleRecordingStop()
      }
    }

    return (
      <Button
        onMouseDown={handleVoiceMouseDown}
        onMouseUp={handleVoiceMouseUp}
        onMouseLeave={handleVoiceMouseLeave}
        onTouchStart={handleVoiceMouseDown}
        onTouchEnd={handleVoiceMouseUp}
        size="sm"
        disabled={!hasStarted}
        className={`rounded-full p-2 select-none ${
          !hasStarted
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : isRecording 
            ? 'bg-indigo-600 hover:bg-indigo-700 text-white animate-pulse' 
            : isConnected
            ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
            : 'bg-gray-200 hover:bg-gray-300 text-white'
        }`}
        title={
          !hasStarted ? 'Click Start to begin' :
          isRecording ? 'Recording... Release to stop' :
          isConnected ? 'Hold to record' :
          'Connect and hold to record'
        }
      >
        {isRecording ? <VoiceWaveIcon className="w-4 h-4" isAnimating={true} /> : <Mic className="w-4 h-4" />}
      </Button>
    )
  }
  
  // For non-compact mode, return null since we don't need the full panel anymore
  return null
}
