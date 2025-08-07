"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Send, Bot, Ship, ChevronDown, ChevronUp } from "lucide-react"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import axios from "axios"

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
  const [aiRole, setAIRole] = useState<AIRole>("co-worker")
  const [aiProvider, setAIProvider] = useState<AIProvider>("gemini")
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

  const messages = messagesByRole[aiRole]

  const getTimestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })

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
    "visibility",
    "sea-state",
    "wind-conditions",
    // Incident Reporting
    "incident-details",
    // Pilotage Recommendations
    "pilotage-comments",
    "improvements"
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
        
        // Update last checked values before sending API
        const newLastChecked = { ...lastCheckedForm };
        finalChangedFields.forEach(field => {
          newLastChecked[field] = formValues[field];
        });
        setLastCheckedForm(newLastChecked);
        
        try {
                  const res = await axios.post<ChatResponse>("http://localhost:8000/chat", {
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
        });

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
          }
        } catch (err) {
          console.error("Error in form check:", err);
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
    const initializeForm = async () => {
      if (!isInitialized) {
        try {
          console.log("Initializing form...");
          const res = await axios.post<ChatResponse[]>("http://localhost:8000/initialize", {
            ai_role: aiRole,
            ai_provider: aiProvider
          });

          // Get the last response for form updates
          const lastResponse = res.data[res.data.length - 1];
          if (lastResponse.updated_fields) {
            setFormValues(lastResponse.updated_fields);
            // Also set these as the baseline for change detection
            setLastCheckedForm(lastResponse.updated_fields);
            
            // Highlight fields that were auto-filled during initialization
            const updatedFieldNames = Object.keys(lastResponse.updated_fields);
            setRecentlyUpdatedFields(new Set(updatedFieldNames));
          }

          // Convert all responses to messages
          const initMessages = res.data.map((response, index) => ({
            id: index + 1,
            sender: "ai" as const,
            content: response.reply,
            timestamp: getTimestamp(),
          }));

          setMessagesByRole(prev => ({
            ...prev,
            [aiRole]: initMessages
          }));
          setIsInitialized(true);
        } catch (err) {
          console.error("Error initializing form:", err);
          const errorMessage = {
            id: 1,
            sender: "ai" as const,
            content: "Sorry, I encountered an error during initialization. Please try refreshing the page.",
            timestamp: getTimestamp(),
          };
          setMessagesByRole(prev => ({
            ...prev,
            [aiRole]: [errorMessage]
          }));
        }
      }
    };

    initializeForm();
  }, [isInitialized, aiRole, aiProvider]);

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
      setIsInitialized(false);
      setAIProvider("openai"); // Reset to default provider
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
    setAIRole(newRole);
  };

  const handleProviderChange = (newProvider: AIProvider) => {
    setAIProvider(newProvider);
  };

  const handleInputChange = (id: string, value: string) => {
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

    try {
      const res = await axios.post<ChatResponse>("http://localhost:8000/chat", {
        messages: messagesByRole[aiRole].concat(userMessage).map(msg => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.content
        })),
        form: formValues,
        is_ai_update: true,
        ai_role: aiRole,
        ai_provider: aiProvider
      });


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
      <div className="w-1/3 bg-white border-r border-slate-300 flex flex-col m-2 mr-1 rounded-lg shadow-sm">
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
            </div>
            <Button 
              onClick={handleReset}
              variant="outline" 
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              Reset Chat
            </Button>
          </div>

          <div className="space-y-3">
            <Tabs 
              value={aiRole} 
              onValueChange={(value) => handleRoleChange(value as AIRole)} 
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3 bg-slate-100">
                <TabsTrigger value="co-worker" className="text-xs">
                  Role 1
                </TabsTrigger>
                <TabsTrigger value="butler" className="text-xs">
                  Role 2
                </TabsTrigger>
                <TabsTrigger value="coach" className="text-xs">
                  Role 3
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
        </div>

        <div className="p-4 border-t border-slate-200 flex-shrink-0">
          <div className="flex gap-2 items-center bg-slate-50 border border-slate-200 rounded-full px-3 py-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder=""
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="relative" ref={setModelDropdownRef}>
              <button
                onClick={() => setOpenSections(prev => ({ ...prev, modelDropdown: !prev.modelDropdown }))}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors"
              >
                {aiProvider === "gemini" ? "Gemini" : "OpenAI"}
                <ChevronDown className="w-3 h-3" />
              </button>
              {openSections.modelDropdown && (
                <div className="absolute bottom-full right-0 mb-1 bg-white border border-slate-200 rounded-md shadow-lg z-10 min-w-[100px]">
                  <button
                    onClick={() => {
                      handleProviderChange("openai");
                      setOpenSections(prev => ({ ...prev, modelDropdown: false }));
                    }}
                    className={`w-full px-3 py-2 text-xs text-left hover:bg-slate-50 ${aiProvider === "openai" ? "bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
                  >
                    GPT-4o-mini
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
            <Button onClick={handleSendMessage} size="sm" className="rounded-full p-2 bg-indigo-600 hover:bg-indigo-900">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="w-2/3 flex flex-col m-2 ml-1">
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
                  <div>
                    <Label className="text-sm font-medium text-slate-700 mb-2 block">Environmental Conditions:</Label>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="visibility" className="text-sm text-slate-600">
                          Visibility
                        </Label>
                        <Input id="visibility" className={getFieldClassName("visibility", "mt-1")} value={formValues["visibility"] || ""} onChange={(e) => handleInputChange("visibility", e.target.value)} onClick={() => handleFieldClick("visibility")} />
                      </div>
                      <div>
                        <Label htmlFor="sea-state" className="text-sm text-slate-600">
                          Sea State
                        </Label>
                        <Input id="sea-state" className={getFieldClassName("sea-state", "mt-1")} value={formValues["sea-state"] || ""} onChange={(e) => handleInputChange("sea-state", e.target.value)} onClick={() => handleFieldClick("sea-state")} />
                      </div>
                      <div>
                        <Label htmlFor="wind-conditions" className="text-sm text-slate-600">
                          Wind Speed & Direction
                        </Label>
                        <Input id="wind-conditions" className={getFieldClassName("wind-conditions", "mt-1")} value={formValues["wind-conditions"] || ""} onChange={(e) => handleInputChange("wind-conditions", e.target.value)} onClick={() => handleFieldClick("wind-conditions")} />
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.incidentReporting} onOpenChange={() => toggleSection("incidentReporting")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">3. Incident or Near-Miss Reporting</h3>
                {openSections.incidentReporting ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="incident-details" className="text-sm font-medium text-slate-700">
                      Incident or Near-Miss Details (if any occurred, otherwise write "None"):
                    </Label>
                    <Textarea 
                      id="incident-details" 
                      placeholder="Provide full details of any incident or near-miss, or write 'None'..." 
                      className={getFieldClassName("incident-details", "mt-1")} 
                      rows={4} 
                      value={formValues["incident-details"] || ""} 
                      onChange={(e) => handleInputChange("incident-details", e.target.value)} 
                      onClick={() => handleFieldClick("incident-details")}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={openSections.pilotageRecommendations} onOpenChange={() => toggleSection("pilotageRecommendations")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">4. Pilotage Practices & Recommendations</h3>
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
                <h3 className="font-medium text-slate-800">Work-Related Stress & Fatigue</h3>
                {openSections.stressFatigue ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="workload" className="text-sm font-medium text-slate-700">
                      Workload Assessment (1-5, 5 = very high)
                    </Label>
                    <Input
                      id="workload"
                      type="text"
                      placeholder="e.g., 3 or High workload due to heavy traffic"
                      className={getFieldClassName("workload", "mt-1")}
                      value={formValues["workload"] || ""}
                      onChange={(e) => handleInputChange("workload", e.target.value)}
                      onClick={() => handleFieldClick("workload")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="stress-feedback" className="text-sm font-medium text-slate-700">
                      Additional Comments (Optional)
                    </Label>
                    <Textarea
                      id="stress-feedback"
                      placeholder="Feel free to share any additional thoughts about stress factors or work conditions..."
                      className={getFieldClassName("stress-feedback", "mt-1")}
                      rows={3}
                      value={formValues["stress-feedback"] || ""}
                      onChange={(e) => handleInputChange("stress-feedback", e.target.value)}
                      onClick={() => handleFieldClick("stress-feedback")}
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
                    <Input id="submission-date" type="date" className={getFieldClassName("submission-date", "mt-1")} value={formValues["submission-date"] || ""} onChange={(e) => handleInputChange("submission-date", e.target.value)} onClick={() => handleFieldClick("submission-date")} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex gap-3 pt-4">
              <Button className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-800">Submit Report</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 