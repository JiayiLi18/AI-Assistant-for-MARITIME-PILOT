"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Send, Bot, Ship, ChevronDown, ChevronUp } from "lucide-react"
import VoiceControls from "./VoiceControls"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import axios from "axios"
import { getApiUrl, API_CONFIG } from "@/config/api"

interface Message {
  id: number;
  sender: "user" | "ai";
  content: string;
  timestamp: string;
}

interface ChatResponse {
  reply: string;
  updated_fields?: Record<string, any>;
  is_ai_update?: boolean;
}

type AIRole = "co-worker" | "butler" | "coach"
type AIProvider = "openai" | "gemini"

export default function MaritimePilotReport() {
  // Human-friendly mapping for field guidance (keep in sync with backend)
  const FIELD_INFO: Record<string, { section: string; label: string }> = {
    // 1. Report Information
    "report-number": { section: "Report Information", label: "Report Number" },
    "report-date": { section: "Report Information", label: "Date" },
    "observation-time": { section: "Report Information", label: "Time of Observation" },
    "location": { section: "Report Information", label: "Location" },
    // 2. Vessel and Pilot Details
    "vessel-name": { section: "Vessel and Pilot Details", label: "Vessel Name" },
    "imo-number": { section: "Vessel and Pilot Details", label: "IMO Number" },
    "vessel-type": { section: "Vessel and Pilot Details", label: "Type of Vessel" },
    "pilot-id": { section: "Vessel and Pilot Details", label: "Pilot Name/ID" },
    // 3. Safety Observations
    "hazards-description": { section: "Safety Observations", label: "Hazards" },

    // 5. Pilotage Recommendations
    "pilotage-comments": { section: "Pilotage Practices & Recommendations", label: "Pilotage Comments" },
    "improvements": { section: "Pilotage Practices & Recommendations", label: "Improvements" },
    // 6. Work-Related Stress
    "workload": { section: "Work-Related Stress & Fatigue", label: "Workload" },
    "additional-comment": { section: "Work-Related Stress & Fatigue", label: "Additional Comments" },
    // 7. Submission
    "submitted-by": { section: "Submission Details", label: "Submitted by" },
    "submission-date": { section: "Submission Details", label: "Date of Submission" },
  }
  const [aiRole, setAIRole] = useState<AIRole>("co-worker")
  const [aiProvider, setAIProvider] = useState<AIProvider>("openai")
  const [newMessage, setNewMessage] = useState("")
  const [formValues, setFormValues] = useState<Record<string, any>>({})
  const [messagesByRole, setMessagesByRole] = useState<Record<AIRole, Message[]>>({
    "co-worker": [],
    "butler": [],
    "coach": []
  })
  const [isInitialized, setIsInitialized] = useState(false)
  const [lastCheckedForm, setLastCheckedForm] = useState<Record<string, any>>({})
  const [recentlyUpdatedFields, setRecentlyUpdatedFields] = useState<Set<string>>(new Set())
  const [debounceTimer, setDebounceTimer] = useState<number | null>(null)
  const [modelDropdownRef, setModelDropdownRef] = useState<HTMLDivElement | null>(null)
  const [showNotification, setShowNotification] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    reportInfo: true,
    vesselDetails: true,
    safetyObs: true,
    incidentReporting: false,
    pilotageRecommendations: false,
    stressFatigue: false,
    submission: false,
    modelDropdown: false,
  })
  const [isWaitingByRole, setIsWaitingByRole] = useState<Record<AIRole, boolean>>({
    "co-worker": false,
    "butler": false,
    "coach": false
  })
  const [hasStarted, setHasStarted] = useState(false)
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false)
  
  // 添加聊天区域的ref用于自动滚动
  const chatContainerRef = useRef<HTMLDivElement>(null)
  
  const isWaiting = isWaitingByRole[aiRole]

  const messages = messagesByRole[aiRole]

  const getTimestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })

  // 自动滚动到聊天区域底部
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }

  // 当消息更新时自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      // 使用 setTimeout 确保DOM更新完成后再滚动
      setTimeout(scrollToBottom, 100)
    }
  }, [messages.length])

  // 当等待状态结束时也滚动到底部（AI回复完成）
  useEffect(() => {
    if (!isWaiting && messages.length > 0) {
      setTimeout(scrollToBottom, 100)
    }
  }, [isWaiting, messages.length])

  const getDefaultUpdatedFields = (): Record<string, any> => ({
    // 1. Report Information
    "report-number": "MPR-2026-001234",
    "report-date": "15-03-2026", // DD-MM-YYYY
    "observation-time": "02:30 PM",
    "location": "Helsinki Harbor, Finnish Archipelago",
    // 2. Vessel and Pilot Details
    "vessel-name": "Beatrice 4",
    "imo-number": "9876543",
    "vessel-type": "Cargo Ship",
    "pilot-id": "Jake Anderson / P-2026",
    // 7. Submission
    "submitted-by": "Jake Anderson",
    "submission-date": "15-03-2026"
  })

  const formatUpdates = (updated: Record<string, any>): string => {
    const entries = Object.entries(updated)
    if (entries.length === 0) return ""

    // Group by section preserving insertion order
    const sectionToItems = new Map<string, string[]>()
    const standalone: string[] = []

    for (const [field, value] of entries) {
      const info = FIELD_INFO[field] || { section: "", label: field }
      const item = `${info.label}: ${value}`
      if (info.section) {
        if (!sectionToItems.has(info.section)) sectionToItems.set(info.section, [])
        sectionToItems.get(info.section)!.push(item)
      } else {
        standalone.push(`• **${item}**`)
      }
    }

    const lines: string[] = []
    for (const [section, items] of sectionToItems.entries()) {
      lines.push(`**${section}**:\n` + items.join('\n'))
    }
    lines.push(...standalone)

    return `I've updated the following fields:\n${lines.join("\n")}`
  }

  const buildWelcomeMessages = (role: AIRole, updated: Record<string, any>): { m1: string; m2: string } => {
    const updatesBlock = `---\n\n${formatUpdates(updated)}\n\n---`
    const pendingBlock = [
      'Fields to complete:',
      '**2. Safety Observations**:',
      '  - Potential hazards observed\n',
      '**4. Pilotage Practices & Recommendations**:',
      '  - Comments on Pilotage Procedures\n',
      '  - Any Suggested Improvements\n',
      '**Work-Related Stress & Fatigue**:',
      '  - Workload Assessment (1-5, 5 = very high)\n',
      '  - Additional Comments\n',
    ].join('\n')

    if (role === "butler") {
      const m1 = "Hey Jake! I've auto-filled your Maritime Pilot Report with all the standard info to save you time.\n\n"
      const m2 = (
        "Here's what I've completed:\n\n" +
        `${updatesBlock}\n\n` +
        "\n\nCould you check these following fields for me?\n" +
        `${pendingBlock}\n\n`
      )
      return { m1, m2 }
    }

    if (role === "coach") {
      const m1 = "Hello Jake. I'm here to support you as you reflect on this pilotage experience and complete your Maritime Pilot Report.\n\n"
      const m2 = (
        "I've gathered some of the basic information we know:\n\n" +
        `${updatesBlock}\n\n` +
        "\n\nRather than rushing through the remaining fields, I'd love to create space for you to reflect on this journey. Each experience offers opportunities for growth and deeper understanding of your craft.\n\n" +
        "When you're ready, we can explore together what stood out to you about this pilotage—what challenged you, what went well, or what insights emerged. There's no hurry; we'll move at whatever pace feels right for you.\n\n" +
        "What would you like to share about this experience?"
      )
      return { m1, m2 }
    }

    // co-worker (default)
    const m1 = "Hey Jake. I've finished my task and I'm ready to start filling the Maritime Pilot Report now.\n\n"
    const m2 = (
      "I've filled all the information I know here.\n\n" +
      `${updatesBlock}\n\n` +
      "Once you're available, could you check these following fields?\n" +
      `${pendingBlock}\n\n`
    )
    return { m1, m2 }
  }

  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef && !modelDropdownRef.contains(event.target as Node)) {
        setOpenSections(prev => ({ ...prev, modelDropdown: false }));
      }
    };

    if (openSections.modelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openSections.modelDropdown, modelDropdownRef]);

  const monitoredFields = [
    // Report Information
    "report-number",
    "report-date", 
    "observation-time",
    "location",
    // Vessel and Pilot Details
    "vessel-name",
    "imo-number",
    "vessel-type",
    "pilot-id",
    // Safety Observations
    "hazards-description",
    // Pilotage Recommendations
    "pilotage-comments",
    "improvements",
    "additional-comment"
  ]



  // Debounced form change detection - sends API after 10 seconds of no changes
  useEffect(() => {
    if (!isInitialized || aiRole === 'co-worker') return;
    
    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    // Check if there are any changes in monitored fields
    const changedFields: string[] = [];
    monitoredFields.forEach(field => {
      const currentValue = formValues[field]?.trim() || "";
      const lastValue = lastCheckedForm[field]?.trim() || "";
      
      if (currentValue !== lastValue) {
        changedFields.push(field);
      }
    });
    
    // If there are changes, set a new timer to send API after 5 seconds
    if (changedFields.length > 0) {
      console.log("Detected field changes, will do final check in 5 seconds:", changedFields);
      
      const timer = setTimeout(async () => {
        // Double-check if there are still actual changes before sending API
        const finalChangedFields: string[] = [];
        monitoredFields.forEach(field => {
          const currentValue = formValues[field]?.trim() || "";
          const lastValue = lastCheckedForm[field]?.trim() || "";
          
          if (currentValue !== lastValue) {
            finalChangedFields.push(field);
          }
        });
        
        // Only send API if there are still actual changes
        if (finalChangedFields.length === 0) {
          return;
        }
        
        console.log("Confirmed field changes, sending to API:", finalChangedFields);
        console.log("📡 [FRONTEND] CALL_API_AFTER_FORM_UPDATE", {
          fields: finalChangedFields,
          role: aiRole,
          provider: aiProvider,
          time: new Date().toISOString()
        });
        
        // Update last checked values before sending API
        const newLastChecked = { ...lastCheckedForm };
        finalChangedFields.forEach(field => {
          newLastChecked[field] = formValues[field];
        });
        setLastCheckedForm(newLastChecked);
        
        try {
          setIsWaitingByRole(prev => ({ ...prev, [aiRole]: true }));
                  const requestData = {
          messages: messagesByRole[aiRole].map(msg => ({
            role: msg.sender === "user" ? "user" : "assistant",
            content: msg.content
          })).concat([{
            role: "user",
            content: `I've updated the following fields: ${finalChangedFields.join(", ")}`
          }]),
          form: formValues,
          is_ai_update: false,
          ai_role: aiRole,
          ai_provider: aiProvider
        };

        console.log("🚀 [FRONTEND] Sending form check to /chat:", requestData);
        console.log("[FRONTEND] Payload (form check):\n" + JSON.stringify(requestData, null, 2));

        const res = await axios.post<ChatResponse>(getApiUrl(API_CONFIG.ENDPOINTS.CHAT), requestData);

        console.log("📥 [FRONTEND] Received form check from /chat:", res.data);
        console.log("[FRONTEND] Response (form check):\n" + JSON.stringify(res.data, null, 2));

          if (res.data.reply && res.data.reply.trim()) {
            const aiMessage = {
              id: messagesByRole[aiRole].length + 1,
              sender: "ai" as const,
              content: res.data.reply,
              timestamp: getTimestamp(),
            };

            setMessagesByRole(prev => ({
              ...prev,
              [aiRole]: [...prev[aiRole], aiMessage]
            }));
            setShowNotification(true);
            // Auto-hide notification after 5 seconds
            setTimeout(() => {
              setShowNotification(false);
            }, 5000);
            
            // 滚动到底部显示AI回复
            setTimeout(scrollToBottom, 100)
          }
        } catch (err) {
          console.error("Error in form check:", err);
        } finally {
          setIsWaitingByRole(prev => ({ ...prev, [aiRole]: false }));
        }
      }, 5000);
      
      setDebounceTimer(timer);
    }
    
    // Cleanup function
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [formValues, isInitialized, aiRole, aiProvider]); // React to formValues changes

  useEffect(() => {
    if (!hasStarted) return;
    // Local init per role/provider
    const currentRoleMessages = messagesByRole[aiRole]
    const currentRoleInitialized = currentRoleMessages.length > 0
    if (currentRoleInitialized) return

    console.log(`Initializing form locally for role: ${aiRole}, provider: ${aiProvider}...`)
    const updated = getDefaultUpdatedFields()
    const { m1, m2 } = buildWelcomeMessages(aiRole, updated)

    // Set initial form values and baseline
    setFormValues(updated)
    setLastCheckedForm(updated)
    setRecentlyUpdatedFields(new Set(Object.keys(updated)))

    // Seed two welcome messages
    const initMessages: Message[] = [
      { id: 1, sender: "ai", content: m1, timestamp: getTimestamp() },
      { id: 2, sender: "ai", content: m2, timestamp: getTimestamp() },
    ]
    setMessagesByRole(prev => ({ ...prev, [aiRole]: initMessages }))
    setIsInitialized(true)
  }, [aiRole, aiProvider, hasStarted])

  // Handle voice-related functions
  const handleVoiceFormUpdate = (updates: Record<string, any>) => {
    console.log("[VOICE] Form updates received:", updates);
    
    // Update form values
    const newValues = {
      ...formValues,
      ...updates
    };
    setFormValues(newValues);
    setLastCheckedForm(newValues);
    
    // Highlight updated fields
    const updatedFieldNames = Object.keys(updates);
    setRecentlyUpdatedFields(new Set(updatedFieldNames));
    
    // Show notification
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
    }, 5000);
  };

  const handleVoiceTranscript = (text: string) => {
    console.log("[VOICE] Transcript received:", text)
    
    // Add transcript as user message to chat
    const userMessage = {
      id: messages.length + 1,
      sender: "user" as const,
      content: `🎤 ${text}`,
      timestamp: getTimestamp(),
    };

    setMessagesByRole(prev => ({
      ...prev,
      [aiRole]: [...prev[aiRole], userMessage]
    }));
    
    // 滚动到底部显示新消息
    setTimeout(scrollToBottom, 100)
  };

  const handleVoiceReply = (reply: string) => {
    console.log("[VOICE] Voice reply received:", reply)
    
    // Add AI voice response to chat
    const aiMessage = {
      id: messages.length + 1,
      sender: "ai" as const,
      content: `🔊 ${reply}`,
      timestamp: getTimestamp(),
    };

    setMessagesByRole(prev => ({
      ...prev,
      [aiRole]: [...prev[aiRole], aiMessage]
    }));
    
    // 滚动到底部显示新消息
    setTimeout(scrollToBottom, 100)
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset? This will clear all chat histories and form values.')) {
      // Clear debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        setDebounceTimer(null);
      }
      
      setMessagesByRole({
        "co-worker": [],
        "butler": [],
        "coach": []
      });
      setFormValues({});
      setNewMessage("");
      setLastCheckedForm({});
      setRecentlyUpdatedFields(new Set());
      setAIProvider("openai"); // Reset to default provider
      setShowNotification(false);
      setIsInitialized(false);
      setIsWaitingByRole({ "co-worker": false, "butler": false, "coach": false });
      setHasStarted(false);
      setIsVoiceEnabled(false);
    }
  };

  const getRoleDisplayName = (role: AIRole) => {
    switch (role) {
      case "co-worker":
        return "1"
      case "butler":
        return "2"
      case "coach":
        return "3"
    }
  }

  const getRoleDescription = (role: AIRole) => {
    switch (role) {
      case "co-worker":
        return ""
      case "butler":
        return ""
      case "coach":
        return ""
    }
  }

  const handleRoleChange = (newRole: AIRole) => {
    if (newRole === aiRole) return; // 如果选择的是当前role，不做任何操作
    
    const currentRoleHasContent = messagesByRole[aiRole].length > 0 || Object.keys(formValues).length > 0;
    
    if (currentRoleHasContent) {
      const confirmMessage = `Switching to ${newRole} will start a new session and clear all current chat history and form data. Are you sure you want to continue?`;
      
      if (window.confirm(confirmMessage)) {
        // 用户确认，清空当前内容并切换到新role
        setMessagesByRole({
          "co-worker": [],
          "butler": [],
          "coach": []
        });
        setFormValues({});
        setLastCheckedForm({});
        setRecentlyUpdatedFields(new Set());
        setIsInitialized(false);
        setAIRole(newRole);
        setIsWaitingByRole({ "co-worker": false, "butler": false, "coach": false });
        setHasStarted(false);
      }
      // 如果用户取消，不做任何操作，保持当前role
    } else {
      // 当前没有内容，直接切换
      setIsInitialized(false);
      setAIRole(newRole);
      setIsWaitingByRole({ "co-worker": false, "butler": false, "coach": false });
      setHasStarted(false);
    }
  };

  const handleProviderChange = (newProvider: AIProvider) => {
    setAIProvider(newProvider);
  };

  const handleInputChange = (id: string, value: string) => {
    console.log("[FRONTEND] Field change:", { field: id, value });
    setFormValues(prev => ({
      ...prev,
      [id]: value
    }));
  };

  const handleFieldClick = (fieldId: string) => {
    // Remove highlighting when user clicks on a highlighted field
    if (recentlyUpdatedFields.has(fieldId)) {
      setRecentlyUpdatedFields(prev => {
        const newSet = new Set(prev);
        newSet.delete(fieldId);
        return newSet;
      });
    }
  };

  const getFieldClassName = (fieldId: string, baseClassName: string) => {
    const isHighlighted = recentlyUpdatedFields.has(fieldId);
    return isHighlighted ? `${baseClassName} border-2 border-blue-500 bg-blue-50 transition-all duration-300` : `${baseClassName} bg-gray-100`;
  }

  const handleSendMessage = async () => {
    if (!hasStarted) return;
    if (!newMessage.trim()) return;

    const userMessage = {
      id: messages.length + 1,
      sender: "user" as const,
      content: newMessage,
      timestamp: getTimestamp(),
    };

    setMessagesByRole(prev => ({
      ...prev,
      [aiRole]: [...prev[aiRole], userMessage]
    }));
    setNewMessage("");

    // 滚动到底部显示用户消息
    setTimeout(scrollToBottom, 100)

    try {
      setIsWaitingByRole(prev => ({ ...prev, [aiRole]: true }));
      const requestData = {
        messages: messagesByRole[aiRole].concat(userMessage).map(msg => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.content
        })),
        form: formValues,
        is_ai_update: true,
        ai_role: aiRole,
        ai_provider: aiProvider
      };
      
      console.log("🚀 [FRONTEND] Sending to /chat:", requestData);
      console.log("[FRONTEND] Payload (chat):\n" + JSON.stringify(requestData, null, 2));
      
      const res = await axios.post<ChatResponse>(getApiUrl(API_CONFIG.ENDPOINTS.CHAT), requestData);

      console.log("📥 [FRONTEND] Received from /chat:", res.data);
      console.log("[FRONTEND] Response (chat):\n" + JSON.stringify(res.data, null, 2));

      const aiMessage = {
        id: messages.length + 2,
        sender: "ai" as const,
        content: res.data.reply,
        timestamp: getTimestamp(),
      };

      setMessagesByRole(prev => ({
        ...prev,
        [aiRole]: [...prev[aiRole], aiMessage]
      }));
      setShowNotification(true);
      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        setShowNotification(false);
      }, 5000);

      // 滚动到底部显示AI回复
      setTimeout(scrollToBottom, 100)

      if (res.data.updated_fields) {
        const newValues = {
          ...formValues,
          ...res.data.updated_fields
        };
        setFormValues(newValues);
        // Also update lastCheckedForm to prevent triggering form check
        setLastCheckedForm(newValues);
        
        // Highlight recently updated fields
        const updatedFieldNames = Object.keys(res.data.updated_fields);
        setRecentlyUpdatedFields(new Set(updatedFieldNames));
      }
    } catch (err) {
      console.error("Error in chat request:", err);
      const errorMessage = {
        id: messages.length + 2,
        sender: "ai" as const,
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: getTimestamp(),
      };
      setMessagesByRole(prev => ({
        ...prev,
        [aiRole]: [...prev[aiRole], errorMessage]
      }));
    } finally {
      setIsWaitingByRole(prev => ({ ...prev, [aiRole]: false }));
    }
  };

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }))
  }

  return (
    <div className="h-screen bg-slate-100 flex">
      <div className="w-1/2 bg-white border-r border-slate-300 flex flex-col m-2 mr-1 rounded-lg shadow-sm relative">
        <div className="bg-white border-b border-slate-200 p-4 rounded-t-lg flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800">Chap {getRoleDisplayName(aiRole)}</h2>
                <p className="text-slate-500 text-sm">{getRoleDescription(aiRole)}</p>
              </div>
              {/* AI Provider Selector */}
              <div className="relative ml-auto" ref={setModelDropdownRef}>
                <button
                  onClick={() => setOpenSections(prev => ({ ...prev, modelDropdown: !prev.modelDropdown }))}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors"
                >
                  {aiProvider === "gemini" ? "Gemini" : "OpenAI"}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {openSections.modelDropdown && (
                  <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-10 min-w-[100px]">
                    <button
                      onClick={() => {
                        handleProviderChange("openai");
                        setOpenSections(prev => ({ ...prev, modelDropdown: false }));
                      }}
                      className={`w-full px-3 py-2 text-xs text-left hover:bg-slate-50 ${aiProvider === "openai" ? "bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
                    >
                      GPT-4o
                    </button>
                    <button
                      onClick={() => {
                        handleProviderChange("gemini");
                        setOpenSections(prev => ({ ...prev, modelDropdown: false }));
                      }}
                      className={`w-full px-3 py-2 text-xs text-left hover:bg-slate-50 ${aiProvider === "gemini" ? "bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
                    >
                      Gemini 2.0 Flash
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={() => {
                  if (!hasStarted) setHasStarted(true)
                }}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={hasStarted}
              >
                Start
              </Button>
              <Button 
                onClick={handleReset}
                variant="outline" 
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid w-full grid-cols-3 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => handleRoleChange("co-worker")}
                className={`px-3 py-2 text-xs rounded-md transition-colors ${
                  aiRole === "co-worker" 
                    ? "bg-white text-slate-900 shadow-sm" 
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Role 1
              </button>
              <button
                onClick={() => handleRoleChange("butler")}
                className={`px-3 py-2 text-xs rounded-md transition-colors ${
                  aiRole === "butler" 
                    ? "bg-white text-slate-900 shadow-sm" 
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Role 2
              </button>
              <button
                onClick={() => handleRoleChange("coach")}
                className={`px-3 py-2 text-xs rounded-md transition-colors ${
                  aiRole === "coach" 
                    ? "bg-white text-slate-900 shadow-sm" 
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Role 3
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                {message.timestamp} · {message.sender === "user" ? "You" : "Chap"}
              </div>
              <div
                className={`p-3 ${
                  message.sender === "user"
                    ? "rounded-lg max-w-[80%] bg-slate-100 text-slate-800 ml-auto"
                    : "rounded-lg max-w-[80%] text-slate-800"
                }`}
              >
                {message.content.split('\n\n').map((section, index, sections) => {
                  // Find the start and end indices of the update block
                  const updateStartIndex = sections.findIndex((s, i) => 
                    s.trim() === '---' && 
                    sections[i + 1] && 
                    (sections[i + 1].includes("I've updated") || sections[i + 1].includes("The following fields were updated"))
                  );
                  
                  const updateEndIndex = sections.findIndex((s, i) => 
                    i > updateStartIndex && s.trim() === '---'
                  );
                  
                  const isInUpdateBlock = 
                    message.sender === "ai" &&
                    updateStartIndex !== -1 &&
                    index > updateStartIndex &&
                    (updateEndIndex === -1 || index < updateEndIndex);
                  
                  return (
                    <div
                      key={index}
                      className={isInUpdateBlock ? "markdown-content-blue mb-4" : "markdown-content mb-4"}
                    >
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          p: ({node, ...props}) => <p className="whitespace-pre-line" {...props} />
                        }}
                      >
                        {section}
                      </ReactMarkdown>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {isWaiting && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                {getTimestamp()} · Chap
              </div>
              <div className="p-3 rounded-lg max-w-[80%] text-slate-800">
                <div className="inline-flex items-center gap-2 text-slate-500 text-sm">
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
                  <span>Waiting for reply…</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 flex-shrink-0 sticky bottom-0 bg-white">
          <div className="p-4">
            <div className="space-y-3">
              {/* Voice Instructions - 移到右侧避免位移 */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500 px-1">
                  {hasStarted ? "Hold down the microphone button to record your voice message." : "Click Start to begin using voice recording."}
                </div>
                {/* 录音状态指示器 - 右侧显示 */}
                {isVoiceEnabled && hasStarted && (
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div>
                    <span>Voice enabled</span>
                  </div>
                )}
              </div>
              
              <div className="flex gap-2 items-center bg-slate-50 border border-slate-200 rounded-full px-3 py-3">
                {/* Voice Control Button */}
                <VoiceControls
                  isEnabled={true}
                  aiRole={aiRole}
                  formData={formValues}
                  onFormUpdate={handleVoiceFormUpdate}
                  onTranscript={handleVoiceTranscript}
                  onVoiceReply={handleVoiceReply}
                  onVoiceToggle={() => setIsVoiceEnabled(!isVoiceEnabled)}
                  compactMode={true}
                  hasStarted={hasStarted}
                />
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={hasStarted ? "Type your message..." : "Click Start to begin"}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
                  disabled={!hasStarted}
                />
                <Button onClick={handleSendMessage} size="sm" className="rounded-full p-2 bg-indigo-600 hover:bg-indigo-900" disabled={!hasStarted}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-1/2 flex flex-col m-2 ml-1">
        <div className="bg-[#1E258A] text-white p-4 rounded-t-lg flex-shrink-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Ship className="w-5 h-5" />
            Maritime Pilot Report
          </h1>
          <p className="text-blue-200 text-sm mt-1">Post-Pilotage Documentation</p>
        </div>

        <div className="flex-1 bg-[#1E258A] rounded-b-lg shadow-sm overflow-y-auto">
          <div className="p-4 space-y-4">
            <Collapsible open={openSections.reportInfo} onOpenChange={() => toggleSection("reportInfo")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">Report Information</h3>
                {openSections.reportInfo ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="report-number" className="text-sm font-medium text-slate-700">
                      Report Number
                    </Label>
                    <Input id="report-number" className={getFieldClassName("report-number", "mt-1")} value={formValues["report-number"] || ""} onChange={(e) => handleInputChange("report-number", e.target.value)} onClick={() => handleFieldClick("report-number")} />
                  </div>
                  <div>
                    <Label htmlFor="report-date" className="text-sm font-medium text-slate-700">
                      Date
                    </Label>
                    <Input 
                      id="report-date" 
                      type="text"
                      placeholder="MM/DD/YYYY"
                      className={getFieldClassName("report-date", "mt-1")} 
                      value={formValues["report-date"] || ""} 
                      onChange={(e) => handleInputChange("report-date", e.target.value)} 
                      onClick={() => handleFieldClick("report-date")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="observation-time" className="text-sm font-medium text-slate-700">
                      Time of Observation
                    </Label>
                    <Input 
                      id="observation-time" 
                      type="text"
                      placeholder="HH:MM AM/PM"
                      className={getFieldClassName("observation-time", "mt-1")} 
                      value={formValues["observation-time"] || ""} 
                      onChange={(e) => handleInputChange("observation-time", e.target.value)} 
                      onClick={() => handleFieldClick("observation-time")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                      Location
                    </Label>
                    <Input id="location" className={getFieldClassName("location", "mt-1")} value={formValues["location"] || ""} onChange={(e) => handleInputChange("location", e.target.value)} onClick={() => handleFieldClick("location")} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.vesselDetails} onOpenChange={() => toggleSection("vesselDetails")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">1. Vessel and Pilot Details</h3>
                {openSections.vesselDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="vessel-name" className="text-sm font-medium text-slate-700">
                      Vessel Name
                    </Label>
                    <Input id="vessel-name" className={getFieldClassName("vessel-name", "mt-1")} value={formValues["vessel-name"] || ""} onChange={(e) => handleInputChange("vessel-name", e.target.value)} onClick={() => handleFieldClick("vessel-name")} />
                  </div>
                  <div>
                    <Label htmlFor="imo-number" className="text-sm font-medium text-slate-700">
                      IMO Number
                    </Label>
                    <Input id="imo-number" className={getFieldClassName("imo-number", "mt-1")} value={formValues["imo-number"] || ""} onChange={(e) => handleInputChange("imo-number", e.target.value)} onClick={() => handleFieldClick("imo-number")} />
                  </div>
                  <div>
                    <Label htmlFor="vessel-type" className="text-sm font-medium text-slate-700">
                      Type of Vessel
                    </Label>
                    <Input id="vessel-type" className={getFieldClassName("vessel-type", "mt-1")} value={formValues["vessel-type"] || ""} onChange={(e) => handleInputChange("vessel-type", e.target.value)} onClick={() => handleFieldClick("vessel-type")} />
                  </div>
                  <div>
                    <Label htmlFor="pilot-id" className="text-sm font-medium text-slate-700">
                      Pilot Name/ID
                    </Label>
                    <Input id="pilot-id" className={getFieldClassName("pilot-id", "mt-1")} value={formValues["pilot-id"] || ""} onChange={(e) => handleInputChange("pilot-id", e.target.value)} onClick={() => handleFieldClick("pilot-id")} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.safetyObs} onOpenChange={() => toggleSection("safetyObs")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">2. Safety Observations</h3>
                {openSections.safetyObs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="hazards-description" className="text-sm font-medium text-slate-700">
                      Potential hazards observed (if any, otherwise write "None"):
                    </Label>
                    <Textarea
                      id="hazards-description"
                      placeholder="Describe any potential hazards or write 'None'..."
                      className={getFieldClassName("hazards-description", "mt-1")}
                      rows={3}
                      value={formValues["hazards-description"] || ""}
                      onChange={(e) => handleInputChange("hazards-description", e.target.value)}
                      onClick={() => handleFieldClick("hazards-description")}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.pilotageRecommendations} onOpenChange={() => toggleSection("pilotageRecommendations")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">3. Pilotage Practices & Recommendations</h3>
                {openSections.pilotageRecommendations ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pilotage-comments" className="text-sm font-medium text-slate-700">
                      Comments on Pilotage Procedures:
                    </Label>
                    <Textarea id="pilotage-comments" placeholder="Comments..." className={getFieldClassName("pilotage-comments", "mt-1")} rows={3} value={formValues["pilotage-comments"] || ""} onChange={(e) => handleInputChange("pilotage-comments", e.target.value)} onClick={() => handleFieldClick("pilotage-comments")} />
                  </div>
                  <div>
                    <Label htmlFor="improvements" className="text-sm font-medium text-slate-700">
                      Any Suggested Improvements:
                    </Label>
                    <Textarea id="improvements" placeholder="Suggest improvements..." className={getFieldClassName("improvements", "mt-1")} rows={3} value={formValues["improvements"] || ""} onChange={(e) => handleInputChange("improvements", e.target.value)} onClick={() => handleFieldClick("improvements")} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.stressFatigue} onOpenChange={() => toggleSection("stressFatigue")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">4. Work-Related Stress & Fatigue</h3>
                {openSections.stressFatigue ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="workload" className="text-sm font-medium text-slate-700">
                      Workload Assessment (1-5, 1 = very low, 5 = very high)
                    </Label>
                    <div
                      className={getFieldClassName("workload", "mt-1 p-2 rounded-md") + " bg-white"}
                      onClick={() => handleFieldClick("workload")}
                    >
                      <div className="flex gap-3">
                        {[1,2,3,4,5].map((n) => (
                          <label key={n} className="inline-flex items-center gap-1 text-sm text-slate-700">
                            <input
                              type="radio"
                              name="workload"
                              value={n}
                              checked={String(formValues["workload"] || "") === String(n)}
                              onChange={() => handleInputChange("workload", String(n))}
                            />
                            <span>{n}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="additional-comment" className="text-sm font-medium text-slate-700">
                      Additional Comments (Optional)
                    </Label>
                    <Textarea
                      id="additional-comment"
                      placeholder="Feel free to share any additional thoughts about stress factors or work conditions..."
                      className={getFieldClassName("additional-comment", "mt-1")}
                      rows={3}
                      value={formValues["additional-comment"] || ""}
                      onChange={(e) => handleInputChange("additional-comment", e.target.value)}
                      onClick={() => handleFieldClick("additional-comment")}
                    />
                    <p className="text-sm text-slate-500 mt-1">Your privacy is important. Share only what you're comfortable with.</p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.submission} onOpenChange={() => toggleSection("submission")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">Submission Details</h3>
                {openSections.submission ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="submitted-by" className="text-sm font-medium text-slate-700">
                      Submitted by
                    </Label>
                    <Input id="submitted-by" className={getFieldClassName("submitted-by", "mt-1")} value={formValues["submitted-by"] || ""} onChange={(e) => handleInputChange("submitted-by", e.target.value)} onClick={() => handleFieldClick("submitted-by")} />
                  </div>
                  <div>
                    <Label htmlFor="submission-date" className="text-sm font-medium text-slate-700">
                      Date of Submission
                    </Label>
                    <Input id="submission-date" className={getFieldClassName("submission-date", "mt-1")} value={formValues["submission-date"] || ""} onChange={(e) => handleInputChange("submission-date", e.target.value)} onClick={() => handleFieldClick("submission-date")} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex gap-3 pt-4">
              <Button 
                onClick={handleReset}
                className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-800"
              >
                Submit Report
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Notification popup */}
      {showNotification && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
          <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-slate-700">New message from Chap</span>
          </div>
        </div>
      )}
    </div>
  )
} 