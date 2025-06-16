"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Send, Bot, Ship, Mic, ChevronDown, ChevronUp } from "lucide-react"
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
}

type AIRole = "co-worker" | "butler" | "coach"

export default function MaritimePilotReport() {
  const [aiRole, setAIRole] = useState<AIRole>("co-worker")
  const [newMessage, setNewMessage] = useState("")
  const [formValues, setFormValues] = useState<Record<string, any>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    reportInfo: true,
    vesselDetails: true,
    safetyObs: true,
    transferArrangements: false,
    incidentReporting: false,
    pilotageRecommendations: false,
    stressFatigue: false,
    submission: false,
  })

  // Reset function to clear chat history and form values
  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset? This will clear all chat history and form values.')) {
      setMessages([]);
      setFormValues({});
      setNewMessage("");
    }
  };

  const getRoleDescription = (role: AIRole) => {
    switch (role) {
      case "co-worker":
        return "Maritime Pilot AI Support"
      case "butler":
        return "Task assistance & well-being"
      case "coach":
        return "Self-reflection & goal setting"
    }
  }

  const handleRoleChange = (newRole: AIRole): boolean => {
    if (messages.length > 0) {
      const shouldChange = window.confirm('Changing roles will clear the current chat history. Continue?');
      if (shouldChange) {
        setAIRole(newRole);
        setMessages([]);
        setFormValues({});
        setNewMessage("");
      }
      return shouldChange;
    }
    setAIRole(newRole);
    return true;
  }

  const handleInputChange = (id: string, value: string) => {
    console.log(`Updating field ${id} with value: ${value}`);
    setFormValues(prev => ({
      ...prev,
      [id]: value
    }));
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const userMessage = {
      id: messages.length + 1,
      sender: "user" as const,
      content: newMessage,
      timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
    };

    setMessages(prev => [...prev, userMessage]);
    setNewMessage("");

    try {
      console.log("Sending chat request with form values:", formValues);
      const res = await axios.post<ChatResponse>("http://localhost:8000/chat", {
        messages: messages.concat(userMessage).map(msg => ({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.content
        })),
        form: formValues
      });

      console.log("Received response:", res.data);

      const aiMessage = {
        id: messages.length + 2,
        sender: "ai" as const,
        content: res.data.reply,
        timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      };

      setMessages(prev => [...prev, aiMessage]);

      // Handle form updates if any
      if (res.data.updated_fields) {
        console.log("Updating form fields:", res.data.updated_fields);
        setFormValues(prev => {
          const newValues = {
            ...prev,
            ...res.data.updated_fields
          };
          console.log("New form values:", newValues);
          return newValues;
        });
      }
    } catch (err) {
      console.error("Error in chat request:", err);
      const errorMessage = {
        id: messages.length + 2,
        sender: "ai" as const,
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      };
      setMessages(prev => [...prev, errorMessage]);
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
      {/* AI Assistant Panel */}
      <div className="w-1/3 bg-white border-r border-slate-300 flex flex-col m-2 mr-1 rounded-lg shadow-sm">
        <div className="bg-white border-b border-slate-200 p-4 rounded-t-lg flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800">Chap {aiRole.charAt(0).toUpperCase() + aiRole.slice(1)}</h2>
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

          {/* Role Switcher */}
          <Tabs 
            value={aiRole} 
            onValueChange={(value) => {
              const shouldChange = handleRoleChange(value as AIRole);
              if (!shouldChange) {
                // Force the tab back to the current value if the change was cancelled
                const tabsList = document.querySelector('[role="tablist"]');
                if (tabsList) {
                  const currentTab = tabsList.querySelector(`[data-value="${aiRole}"]`);
                  if (currentTab) {
                    (currentTab as HTMLElement).click();
                  }
                }
              }
            }} 
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3 bg-slate-100">
              <TabsTrigger value="co-worker" className="text-xs">
                Co-worker
              </TabsTrigger>
              <TabsTrigger value="butler" className="text-xs">
                Butler
              </TabsTrigger>
              <TabsTrigger value="coach" className="text-xs">
                Coach
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Chat Messages */}
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
                    : "text-slate-800 max-w-[80%]"
                }`}
              >
                <p className="text-sm whitespace-pre-line">{message.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="p-4 border-t border-slate-200 flex-shrink-0">
          <div className="flex gap-2 items-center bg-slate-50 border border-slate-200 rounded-full px-3 py-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Ask anything"
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button size="sm" variant="ghost" className="rounded-full p-2">
              <Mic className="w-4 h-4 text-indigo-800" />
            </Button>
            <Button onClick={handleSendMessage} size="sm" className="rounded-full p-2 bg-indigo-600 hover:bg-indigo-900">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Report Form Panel */}
      <div className="w-2/3 flex flex-col m-2 ml-1">
        <div className="bg-indigo-950 text-white p-4 rounded-t-lg flex-shrink-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Ship className="w-5 h-5" />
            Maritime Pilot Report
          </h1>
          <p className="text-blue-200 text-sm mt-1">Post-Pilotage Documentation</p>
        </div>

        <div className="flex-1 bg-white rounded-b-lg shadow-sm overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Report Information */}
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
                    <Input id="report-number" className="mt-1" value={formValues["report-number"] || ""} onChange={(e) => handleInputChange("report-number", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="report-date" className="text-sm font-medium text-slate-700">
                      Date
                    </Label>
                    <Input 
                      id="report-date" 
                      type="text"
                      placeholder="MM/DD/YYYY"
                      className="mt-1" 
                      value={formValues["report-date"] || ""} 
                      onChange={(e) => handleInputChange("report-date", e.target.value)} 
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
                      className="mt-1" 
                      value={formValues["observation-time"] || ""} 
                      onChange={(e) => handleInputChange("observation-time", e.target.value)} 
                    />
                  </div>
                  <div>
                    <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                      Location
                    </Label>
                    <Input id="location" className="mt-1" value={formValues["location"] || ""} onChange={(e) => handleInputChange("location", e.target.value)} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 1. Vessel and Pilot Details */}
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
                    <Input id="vessel-name" className="mt-1" value={formValues["vessel-name"] || ""} onChange={(e) => handleInputChange("vessel-name", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="imo-number" className="text-sm font-medium text-slate-700">
                      IMO Number
                    </Label>
                    <Input id="imo-number" className="mt-1" value={formValues["imo-number"] || ""} onChange={(e) => handleInputChange("imo-number", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="vessel-type" className="text-sm font-medium text-slate-700">
                      Type of Vessel
                    </Label>
                    <Input id="vessel-type" className="mt-1" value={formValues["vessel-type"] || ""} onChange={(e) => handleInputChange("vessel-type", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="pilot-id" className="text-sm font-medium text-slate-700">
                      Pilot Name/ID
                    </Label>
                    <Input id="pilot-id" className="mt-1" value={formValues["pilot-id"] || ""} onChange={(e) => handleInputChange("pilot-id", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="boarding-time" className="text-sm font-medium text-slate-700">
                      Pilot Boarding Time
                    </Label>
                    <Input 
                      id="boarding-time" 
                      type="text"
                      placeholder="HH:MM AM/PM"
                      className="mt-1" 
                      value={formValues["boarding-time"] || ""} 
                      onChange={(e) => handleInputChange("boarding-time", e.target.value)} 
                    />
                  </div>
                  <div>
                    <Label htmlFor="disembarking-time" className="text-sm font-medium text-slate-700">
                      Pilot Disembarking Time
                    </Label>
                    <Input 
                      id="disembarking-time" 
                      type="text"
                      placeholder="HH:MM AM/PM"
                      className="mt-1" 
                      value={formValues["disembarking-time"] || ""} 
                      onChange={(e) => handleInputChange("disembarking-time", e.target.value)} 
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 2. Safety Observations */}
            <Collapsible open={openSections.safetyObs} onOpenChange={() => toggleSection("safetyObs")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">2. Safety Observations</h3>
                {openSections.safetyObs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-700">
                      Were there any potential hazards observed?
                    </Label>
                    <RadioGroup defaultValue="yes" className="mt-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id="hazards-yes" />
                        <Label htmlFor="hazards-yes" className="text-sm">
                          Yes
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id="hazards-no" />
                        <Label htmlFor="hazards-no" className="text-sm">
                          No
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div>
                    <Label htmlFor="hazards-description" className="text-sm font-medium text-slate-700">
                      If yes, describe:
                    </Label>
                    <Textarea
                      id="hazards-description"
                      placeholder="Describe any potential hazards..."
                      className="mt-1"
                      rows={3}
                      value={formValues["hazards-description"] || ""}
                      onChange={(e) => handleInputChange("hazards-description", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700 mb-2 block">Environmental Conditions:</Label>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="visibility" className="text-sm text-slate-600">
                          Visibility
                        </Label>
                        <Input id="visibility" className="mt-1" value={formValues["visibility"] || ""} onChange={(e) => handleInputChange("visibility", e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="sea-state" className="text-sm text-slate-600">
                          Sea State
                        </Label>
                        <Input id="sea-state" className="mt-1" value={formValues["sea-state"] || ""} onChange={(e) => handleInputChange("sea-state", e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="wind-conditions" className="text-sm text-slate-600">
                          Wind Speed & Direction
                        </Label>
                        <Input id="wind-conditions" className="mt-1" value={formValues["wind-conditions"] || ""} onChange={(e) => handleInputChange("wind-conditions", e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 3. Pilot Transfer Arrangements */}
            <Collapsible
              open={openSections.transferArrangements}
              onOpenChange={() => toggleSection("transferArrangements")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">3. Pilot Transfer Arrangements</h3>
                {openSections.transferArrangements ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="transfer-method" className="text-sm font-medium text-slate-700">
                        Transfer Method
                      </Label>
                      <Input id="transfer-method" className="mt-1" value={formValues["transfer-method"] || ""} onChange={(e) => handleInputChange("transfer-method", e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="transfer-location" className="text-sm font-medium text-slate-700">
                        Transfer Location
                      </Label>
                      <Input id="transfer-location" className="mt-1" value={formValues["transfer-location"] || ""} onChange={(e) => handleInputChange("transfer-location", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Any Issues or Non-compliance Noted?</Label>
                    <RadioGroup className="mt-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id="transfer-issues-yes" />
                        <Label htmlFor="transfer-issues-yes" className="text-sm">
                          Yes
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id="transfer-issues-no" />
                        <Label htmlFor="transfer-issues-no" className="text-sm">
                          No
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 4. Incident or Near-Miss Reporting */}
            <Collapsible open={openSections.incidentReporting} onOpenChange={() => toggleSection("incidentReporting")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">4. Incident or Near-Miss Reporting</h3>
                {openSections.incidentReporting ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Any Incident or Near-Miss Occurred?</Label>
                    <RadioGroup className="mt-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id="incident-yes" />
                        <Label htmlFor="incident-yes" className="text-sm">
                          Yes
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id="incident-no" />
                        <Label htmlFor="incident-no" className="text-sm">
                          No
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div>
                    <Label htmlFor="incident-details" className="text-sm font-medium text-slate-700">
                      If yes, provide full details:
                    </Label>
                    <Textarea id="incident-details" placeholder="Provide full details..." className="mt-1" rows={4} value={formValues["incident-details"] || ""} onChange={(e) => handleInputChange("incident-details", e.target.value)} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 5. Pilotage Practices & Recommendations */}
            <Collapsible
              open={openSections.pilotageRecommendations}
              onOpenChange={() => toggleSection("pilotageRecommendations")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">5. Pilotage Practices & Recommendations</h3>
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
                    <Textarea id="pilotage-comments" placeholder="Comments..." className="mt-1" rows={3} value={formValues["pilotage-comments"] || ""} onChange={(e) => handleInputChange("pilotage-comments", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="improvements" className="text-sm font-medium text-slate-700">
                      Any Suggested Improvements:
                    </Label>
                    <Textarea id="improvements" placeholder="Suggest improvements..." className="mt-1" rows={3} value={formValues["improvements"] || ""} onChange={(e) => handleInputChange("improvements", e.target.value)} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 6. Work-Related Stress & Fatigue */}
            <Collapsible open={openSections.stressFatigue} onOpenChange={() => toggleSection("stressFatigue")}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-50 rounded-lg hover:bg-slate-100">
                <h3 className="font-medium text-slate-800">6. Work-Related Stress & Fatigue</h3>
                {openSections.stressFatigue ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 p-4 bg-white border border-slate-200 rounded-lg">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Fatigue Symptoms Noted?</Label>
                    <RadioGroup className="mt-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id="fatigue-yes" />
                        <Label htmlFor="fatigue-yes" className="text-sm">
                          Yes
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id="fatigue-no" />
                        <Label htmlFor="fatigue-no" className="text-sm">
                          No
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div>
                    <Label htmlFor="workload" className="text-sm font-medium text-slate-700">
                      Workload Assessment (1-5, 5 = very high)
                    </Label>
                    <Select>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select workload level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Very Low</SelectItem>
                        <SelectItem value="2">2 - Low</SelectItem>
                        <SelectItem value="3">3 - Moderate</SelectItem>
                        <SelectItem value="4">4 - High</SelectItem>
                        <SelectItem value="5">5 - Very High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Submission Details */}
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
                    <Input id="submitted-by" className="mt-1" value={formValues["submitted-by"] || ""} onChange={(e) => handleInputChange("submitted-by", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="submission-date" className="text-sm font-medium text-slate-700">
                      Date of Submission
                    </Label>
                    <Input id="submission-date" type="date" className="mt-1" value={formValues["submission-date"] || ""} onChange={(e) => handleInputChange("submission-date", e.target.value)} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button className="flex-1 bg-green-600 hover:bg-green-700">Submit Report</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 