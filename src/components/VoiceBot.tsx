"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  X,
  Volume2,
  VolumeX,
  Send,
  Trash2,
  Save,
  ArrowLeft,
  ClipboardList,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  MessageSquare,
  Plus,
  ChevronRight,
  TrendingUp,
  Bell,
  Zap,
  Menu,
  MoreHorizontal,
  User,
  Bot,
} from "lucide-react";
import {
  usePOStore,
  getMissingFields,
  type NavData,
  type NavLine,
  type POState,
} from "@/store/usePOStore";
import { SYSTEM_INSTRUCTION, PO_TOOLS } from "@/services/aiConfig";

import { INITIAL_NAV_DATA } from "@/services/navData";
import GoogleTranslate from "@/components/GoogleTranslate";

// --- Constants ---
const MODEL_NAME = "gemini-2.5-flash-native-audio-latest";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SDK_URL = "https://cdn.jsdelivr.net/npm/@google/genai@1.34.0/+esm";
const VOICE_WAVE_BARS = [
  0.52, 0.78, 0.66, 0.94, 0.58, 0.86, 0.62, 0.9, 0.7, 0.84, 0.6, 0.76,
];
const STATUS_LABELS = {
  idle: "Idle",
  initializing: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
} as const;
const DEFAULT_BATCH_SUMMARY_REQUEST = {
  Company_Id: "275",
  nature_id: "5",
  Location_Id: "1",
} as const;

const INVENTORY_ITEMS = [
  {
    itemName: "Hammer",
    sku: "SKU-4421",
    quantity: 8,
    unit: "units",
    reorderPoint: 15,
    vendor: "Bosch",
  },
  {
    itemName: "Safety Gloves",
    sku: "SKU-1180",
    quantity: 42,
    unit: "pairs",
    reorderPoint: 25,
    vendor: "SafeWorks",
  },
  {
    itemName: "Layer Feed",
    sku: "SKU-7602",
    quantity: 320,
    unit: "bags",
    reorderPoint: 150,
    vendor: "AgriFeeds",
  },
] as const;

const PENDING_APPROVALS = [
  {
    id: "PO-1048",
    vendor: "Bosch",
    amount: "INR 24,500",
    age: "2 days",
    owner: "Procurement Manager",
  },
  {
    id: "PO-1051",
    vendor: "AgriFeeds",
    amount: "INR 18,900",
    age: "1 day",
    owner: "Finance",
  },
  {
    id: "PO-1052",
    vendor: "Qutoma Farm",
    amount: "INR 8,750",
    age: "today",
    owner: "Operations",
  },
] as const;

type VoiceStatus = keyof typeof STATUS_LABELS;

type RealtimeInputPayload = {
  media: {
    data: string;
    mimeType: string;
  };
};

type ToolCallRequest = {
  id?: string;
  name: string;
  args: Record<string, unknown> & {
    field?: string;
    field_name?: string;
    value?: string;
    batch_no?: string;
    item_name?: string;
    item?: string;
    sku?: string;
    quantity?: number | string;
    vendor_name?: string;
    vendor?: string;
    supplier?: string;
    message?: string;
    channel?: string;
  };
};

type ToolCallResponse = {
  success?: boolean;
  message?: string;
  po_number?: string;
  error?: string;
  data?: unknown;
};

type LiveFunctionResponse = {
  id?: string;
  name: string;
  response: Record<string, unknown>;
};

type BatchSummary = {
  batch_id: number;
  batch_no: string;
  start_date: string;
  opening_stocks: number;
  remaining_stocks: number;
  last_entry_date: string;
  remark: string;
  status: string;
};

type BatchSummaryGroup = {
  nob_id: string;
  nature_of_business: string;
  line_of_business: string;
  lob_id: string;
  batches: BatchSummary[];
};

type LiveMessage = {
  serverContent?: {
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data: string;
        };
      }>;
    };
  };
  toolCall?: {
    functionCalls: ToolCallRequest[];
  };
};

type LiveSession = {
  close: () => void;
  send?: (payload: unknown) => void;
  sendMessage?: (payload: unknown) => void;
  sendClientContent?: (payload: {
    turns: Array<{ role: "user"; parts: Array<{ text: string }> }>;
    turnComplete: boolean;
  }) => void | Promise<void>;
  sendToolResponse?: (payload: {
    functionResponses: LiveFunctionResponse[];
  }) => void | Promise<void>;
  sendRealtimeInput?: (payload: RealtimeInputPayload) => void;
};

type LiveConnection = {
  readyState?: number;
  send?: (payload: unknown) => void;
  sendMessage?: (payload: unknown) => void;
};

type LiveSessionWithConnection = LiveSession & {
  conn?: LiveConnection;
  readyState?: number;
};

type GoogleGenAIConstructor = new (config: { apiKey: string }) => {
  live: {
    connect: (config: {
      model: string;
      config: {
        systemInstruction: string;
        tools: typeof PO_TOOLS;
        responseModalities: string[];
        inputAudioTranscription: Record<string, never>;
        outputAudioTranscription: Record<string, never>;
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: string;
            };
          };
        };
      };
      callbacks: {
        onopen?: () => void;
        onmessage?: (message: LiveMessage) => void | Promise<void>;
        onerror?: (error: Error) => void;
        onclose?: (event?: { code?: number; reason?: string }) => void;
      };
    }) => Promise<LiveSession>;
  };
};

const PO_FIELDS: Array<
  "vendor" | "item" | "quantity" | "price" | "deliveryDate"
> = ["vendor", "item", "quantity", "price", "deliveryDate"];

const NUMERIC_FIELDS = new Set(["quantity", "price"]);

function textValue(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function intValue(value: unknown) {
  return parseInt(textValue(value), 10) || 0;
}

function floatValue(value: unknown) {
  return parseFloat(textValue(value)) || 0;
}

function displayValue(value: unknown, fallback = "-") {
  const text = textValue(value).trim();
  return text || fallback;
}

function normalizeBatchLookup(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "");
}

function getBatchSummaryGroups(payload: unknown): BatchSummaryGroup[] {
  const data = payload as {
    data?: {
      data?: { summarry?: unknown; summary?: unknown };
      summarry?: unknown;
      summary?: unknown;
    };
    summarry?: unknown;
    summary?: unknown;
  };
  const rawGroups =
    data.data?.data?.summarry ??
    data.data?.data?.summary ??
    data.data?.summarry ??
    data.data?.summary ??
    data.summarry ??
    data.summary;

  if (!Array.isArray(rawGroups)) return [];

  return rawGroups.map((group) => {
    const record = group as Record<string, unknown>;
    const rawBatches = Array.isArray(record.batches) ? record.batches : [];

    return {
      nob_id: textValue(record.nob_id),
      nature_of_business: textValue(record.nature_of_business),
      line_of_business: textValue(record.line_of_business, "Other"),
      lob_id: textValue(record.lob_id),
      batches: rawBatches.map((batch) => {
        const batchRecord = batch as Record<string, unknown>;
        return {
          batch_id: intValue(batchRecord.batch_id),
          batch_no: textValue(batchRecord.batch_no),
          start_date: textValue(batchRecord.start_date),
          opening_stocks: intValue(batchRecord.opening_stocks),
          remaining_stocks: intValue(batchRecord.remaining_stocks),
          last_entry_date: textValue(batchRecord.last_entry_date),
          remark: textValue(batchRecord.remark),
          status: textValue(batchRecord.status),
        };
      }).filter((batch) => batch.batch_id || batch.batch_no),
    };
  }).filter((group) => group.batches.length > 0);
}

function findBatchSummary(
  groups: BatchSummaryGroup[],
  value: unknown,
): BatchSummary | null {
  const lookup = normalizeBatchLookup(value);
  if (!lookup) return null;

  for (const group of groups) {
    const found = group.batches.find((batch) => {
      const id = normalizeBatchLookup(batch.batch_id);
      const batchNo = normalizeBatchLookup(batch.batch_no);
      return (
        id === lookup ||
        batchNo === lookup ||
        batchNo.startsWith(lookup) ||
        lookup.startsWith(batchNo)
      );
    });

    if (found) return found;
  }

  return null;
}

function getDataEntryDetails(result: unknown): NavData | null {
  const payload = result as { data?: unknown };
  const data = payload.data as NavData | undefined;

  if (data?.data?.header || data?.data?.line) return data;
  return null;
}

function normalizeActionLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findInventoryItem(query: string) {
  const lookup = normalizeActionLookup(query);
  if (!lookup) return null;

  return (
    INVENTORY_ITEMS.find((item) => {
      const itemName = normalizeActionLookup(item.itemName);
      const sku = normalizeActionLookup(item.sku);
      return (
        itemName === lookup ||
        sku === lookup ||
        itemName.includes(lookup) ||
        lookup.includes(itemName) ||
        sku.includes(lookup)
      );
    }) ?? null
  );
}

function formatStockItem(item: (typeof INVENTORY_ITEMS)[number]) {
  const status = item.quantity <= item.reorderPoint ? "low" : "healthy";
  return `${item.itemName} (${item.sku}) has ${item.quantity} ${item.unit}; reorder point ${item.reorderPoint}. Status: ${status}.`;
}

function buildStockLevelsResponse(itemName: string): ToolCallResponse {
  const requestedItem = itemName.trim();
  if (requestedItem) {
    const item = findInventoryItem(requestedItem);
    if (!item) {
      return {
        success: false,
        error: `I could not find stock for ${requestedItem}. Current priority: ${formatStockItem(INVENTORY_ITEMS[0])}`,
      };
    }

    return {
      success: true,
      message: formatStockItem(item),
    };
  }

  const lowStock = INVENTORY_ITEMS.filter(
    (item) => item.quantity <= item.reorderPoint,
  );
  const summary = INVENTORY_ITEMS.map(formatStockItem).join(" ");
  return {
    success: true,
    message: lowStock.length
      ? `Stock summary: ${summary} Replenishment needed for ${lowStock.map((item) => item.itemName).join(", ")}.`
      : `Stock summary: ${summary} No items are below reorder point.`,
  };
}

function buildPendingApprovalsResponse(): ToolCallResponse {
  const priorityQueue = PENDING_APPROVALS.map(
    (approval) =>
      `${approval.id} for ${approval.vendor}, ${approval.amount}, pending ${approval.age}, owner: ${approval.owner}`,
  ).join("; ");

  return {
    success: true,
    message: `There are 7 pending approvals. Priority queue: ${priorityQueue}.`,
  };
}

function buildVendorContactResponse(
  vendorName: string,
  message: string,
  channel: string,
): ToolCallResponse {
  const vendor = vendorName.trim();
  if (!vendor) {
    return {
      success: false,
      error:
        "Which vendor should I contact? Please provide the vendor name and optional message.",
    };
  }

  const preferredChannel = ["email", "phone", "whatsapp"].includes(channel)
    ? channel
    : "email";
  const contactMessage =
    message.trim() || "Please share the latest status update.";

  return {
    success: true,
    message: `Vendor contact prepared for ${vendor} via ${preferredChannel}: ${contactMessage}`,
  };
}

function getLineSelectionText(line: NavLine) {
  return displayValue(line.iteM_NAME || line.parameteR_NAME);
}

function getMissingPOFields(poState: POState) {
  return PO_FIELDS.filter((field) => !poState[field]?.trim());
}

function normalizeFieldValue(field: string, value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (!NUMERIC_FIELDS.has(field)) return normalized;
  const digitsOnly = normalized.replace(/[^\d.]/g, "");
  if (!digitsOnly || Number.isNaN(Number(digitsOnly))) return "";
  return digitsOnly;
}

function formatMessageText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[–—]/g, "-")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getLiveConnection(session: LiveSessionWithConnection): LiveConnection {
  return session.conn || session;
}

function getLiveSendTarget(session: LiveSessionWithConnection) {
  const conn = getLiveConnection(session);
  const send = session.send || session.sendMessage || conn.send || conn.sendMessage;
  return {
    conn,
    target: session.send || session.sendMessage ? session : conn,
    send,
  };
}

function isLiveConnectionClosed(conn: LiveConnection) {
  return conn.readyState === 2 || conn.readyState === 3;
}

function buildLiveToolResponse(
  call: ToolCallRequest,
  result: ToolCallResponse,
): LiveFunctionResponse {
  const response: Record<string, unknown> = {
    success: result.success !== false,
  };

  if (result.message) response.message = result.message;
  if (result.error) response.error = result.error;
  if (result.po_number) response.po_number = result.po_number;
  if (result.data !== undefined) response.data = result.data;

  return {
    ...(call.id ? { id: call.id } : {}),
    name: call.name,
    response,
  };
}

export default function VoiceBot() {
  // --- Centralized Store ---
  const {
    po,
    history: activeMessages,
    savedChats,
    viewingSavedChat,
    hydrated,
    completedCount,
    totalFields,
    updatePOField,
    startPO,
    resetPO,
    confirmPO,
    addMessage,
    appendToStreamingMessage,
    clearMessages,
    saveCurrentChat,
    startNewChat,
    loadSavedChat,
    resumeActiveChat,
    finalizeStreaming,
    startDataEntry,
    updateNavBatch,
    updateNavItemQuantity,
    resetDataEntry,
  } = usePOStore();

  const messages = viewingSavedChat
    ? viewingSavedChat.messages
    : activeMessages;

  // --- Local UI State (not persisted) ---
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [inputText, setInputText] = useState("");
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isTextSending, setIsTextSending] = useState(false);
  const [sessionResumePrompt, setSessionResumePrompt] = useState(false);
  // Use 'light' as stable SSR default; read localStorage only after mount
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [batchGroups, setBatchGroups] = useState<BatchSummaryGroup[]>([]);
  const [isBatchesLoading, setIsBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  // --- Mobile Initialization ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
        setRightPanelOpen(false);
      }
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // --- Show toast helper ---
  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3000);
  };

  // --- Theme Management: Safe client-only initialization ---
  useEffect(() => {
    const saved = localStorage.getItem("erp-theme") as "light" | "dark" | null;
    const initial =
      saved ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(initial);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && po.activeFlow === "DATA_ENTRY" && po.navData) {
      console.log("📝 DATA ENTRY UPDATED:", po.navData);
    }
  }, [po.navData, po.activeFlow, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("erp-theme", theme);
  }, [theme, mounted]);

  // --- Refs ---
  const sessionRef = useRef<LiveSession | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<GoogleGenAIConstructor | null>(null);
  const isConnectedRef = useRef(false);
  const isMutedRef = useRef(false);
  const isDisconnectingRef = useRef(false);
  const poRef = useRef(po);
  const messagesRef = useRef(messages);
  const textRequestAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // --- Auto Scroll ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    poRef.current = po;
  }, [po]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    return () => {
      textRequestAbortRef.current?.abort();
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (
        inputAudioCtxRef.current &&
        inputAudioCtxRef.current.state !== "closed"
      ) {
        inputAudioCtxRef.current.close().catch(() => undefined);
      }
      if (
        outputAudioCtxRef.current &&
        outputAudioCtxRef.current.state !== "closed"
      ) {
        outputAudioCtxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  const loadBatchSummary = useCallback(async () => {
    setIsBatchesLoading(true);
    setBatchesError(null);

    try {
      const params = new URLSearchParams(DEFAULT_BATCH_SUMMARY_REQUEST);
      const res = await fetch(`/api/navfarm/get-dataentry-summary?${params.toString()}`, {
        method: "GET",
      });
      const result = await res.json();
      const response = result as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok || response.success === false) {
        throw new Error(
          response.error ||
          response.message ||
          "NavFarm batch summary fetch failed.",
        );
      }

      const groups = getBatchSummaryGroups(result);
      setBatchGroups(groups);
      return groups;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch batches.";
      setBatchesError(message);
      return [];
    } finally {
      setIsBatchesLoading(false);
    }
  }, []);

  const fetchDataEntryDetails = useCallback(async (batchId: number | string) => {
    const params = new URLSearchParams({
      Company_Id: DEFAULT_BATCH_SUMMARY_REQUEST.Company_Id,
      batch_id: String(batchId),
    });
    const res = await fetch(`/api/navfarm/get-dataentry-details?${params.toString()}`, {
      method: "GET",
    });
    const result = await res.json();
    const response = result as {
      success?: boolean;
      error?: string;
      message?: string;
    };

    if (!res.ok || response.success === false) {
      throw new Error(
        response.error ||
        response.message ||
        "NavFarm data entry details fetch failed.",
      );
    }

    const details = getDataEntryDetails(result);
    if (!details) {
      throw new Error("NavFarm did not return data entry details for this batch.");
    }

    return details;
  }, []);

  // --- Audio Utilities ---
  const encodePcm = (float32Array: Float32Array) => {
    const l = float32Array.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const val = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = val * 32768;
    }
    return btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
  };

  const decodePcm = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++)
      bytes[i] = binaryString.charCodeAt(i);
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++)
      float32Array[i] = int16Array[i] / 32768.0;
    const buffer = ctx.createBuffer(1, float32Array.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32Array);
    return buffer;
  };

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch { }
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const loadSDK = async () => {
    if (sdkRef.current) return sdkRef.current;
    try {
      const loader = new Function("url", "return import(url)");
      const importedModule = await loader(SDK_URL);
      const GoogleGenAI =
        importedModule.GoogleGenAI ||
        importedModule.default?.GoogleGenAI ||
        importedModule;
      sdkRef.current = GoogleGenAI;
      return GoogleGenAI;
    } catch {
      throw new Error("Failed to load Gemini SDK.");
    }
  };

  // --- Session Recovery: prompt user if unfinished PO exists ---
  useEffect(() => {
    if (!hydrated) return;
    if (po.isActive && getMissingFields(po).length > 0 && messages.length > 0) {
      setSessionResumePrompt(true);
      return;
    }
    setSessionResumePrompt(false);
  }, [hydrated, messages.length, po]);

  const findNavLine = useCallback((itemName: unknown) => {
    const raw = String(itemName ?? "").trim();
    const lines = poRef.current.navData?.data?.line ?? [];
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const index = Number(raw) - 1;
      if (index >= 0 && index < lines.length) return lines[index];
    }

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    const lookup = normalize(raw);
    const exact = lines.find((line) => {
      const item = normalize(String(line.iteM_NAME || ""));
      const parameter = normalize(String(line.parameteR_NAME || ""));
      return item === lookup || parameter === lookup;
    });
    if (exact) return exact;

    if (lookup.length < 3) return null;

    return (
      lines.find((line) => {
        const item = normalize(String(line.iteM_NAME || ""));
        const parameter = normalize(String(line.parameteR_NAME || ""));
        return item.includes(lookup) || parameter.includes(lookup);
      }) ?? null
    );
  }, []);



  const handleAction = async (
    call: ToolCallRequest,
  ): Promise<ToolCallResponse> => {
    if (call.name === "start_data_entry") {
      startDataEntry(INITIAL_NAV_DATA);
      void loadBatchSummary();
      return { 
        success: true, 
        message: "Data entry flow has started. I have displayed the list of available batches. Please ask the user to select one of the batches to proceed." 
      };
    }

    if (call.name === "check_stock_levels") {
      const itemName = String(
        call.args.item_name ?? call.args.item ?? call.args.sku ?? "",
      );
      const response = buildStockLevelsResponse(itemName);
      if (response.success) showToast("Stock levels checked");
      return response;
    }

    if (call.name === "review_pending_approvals") {
      const response = buildPendingApprovalsResponse();
      showToast("Pending approvals reviewed");
      return response;
    }

    if (call.name === "contact_vendor") {
      const response = buildVendorContactResponse(
        String(
          call.args.vendor_name ?? call.args.vendor ?? call.args.supplier ?? "",
        ),
        String(call.args.message ?? ""),
        String(call.args.channel ?? "").toLowerCase(),
      );
      if (response.success) showToast("Vendor contact prepared");
      return response;
    }

    // --- NavData Tool Handlers ---
    if (call.name === "set_batch_number") {
      const batchNo = String(call.args.batch_no ?? "").trim();
      if (!batchNo) {
        return { success: false, error: "Batch number is required." };
      }

      const groups = batchGroups.length > 0 ? batchGroups : await loadBatchSummary();
      const selectedBatch = findBatchSummary(groups, batchNo);

      if (!selectedBatch) {
        return {
          success: false,
          error: `Batch ${batchNo} was not found in the NavFarm summary.`,
        };
      }

      try {
        const details = await fetchDataEntryDetails(selectedBatch.batch_id);
        const detailBatchNo = textValue(
          details.data?.header?.[0]?.batcH_NO,
          selectedBatch.batch_no,
        );
        startDataEntry(details);
        updateNavBatch(detailBatchNo);
        showToast(`Batch ${detailBatchNo} selected.`);
        return {
          success: true,
          message: `Batch ${detailBatchNo} selected. Now, please ask the user to choose a line item from the list I have displayed.`,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch batch details.";
        return { success: false, error: message };
      }
    }

    if (call.name === "check_item_exists") {
      const itemName = String(call.args.item_name ?? "").trim();
      const line = findNavLine(itemName);
      if (line) {
        const resolvedItemName = String(
          line.iteM_NAME || line.parameteR_NAME || "",
        ).trim();
        return {
          success: true, 
          message: `Item ${resolvedItemName} has been found and selected. I have updated the view. Please ask the user to provide the 'Total Units' (Quantity) for this item.` 
        };
      }
      return {
        success: false,
        error: `Item ${itemName || "selected"} not found in current data entry.`,
      };
    }

    if (call.name === "update_item_quantity") {
      const itemName = String(call.args.item_name ?? "").trim();
      const line = findNavLine(itemName);
      if (!line) {
        return {
          success: false,
          error: `Item ${itemName || "selected"} not found.`,
        };
      }

      const resolvedItemName = String(
        line.iteM_NAME || line.parameteR_NAME || "",
      ).trim();
      const quantityRaw = call.args.quantity;
      const quantity =
        typeof quantityRaw === "number"
          ? quantityRaw
          : parseFloat(String(quantityRaw));

      if (isNaN(quantity)) {
        return {
          success: false,
          error: `Invalid quantity "${quantityRaw}". Please provide a number.`,
        };
      }

      updateNavItemQuantity(resolvedItemName, quantity);
      showToast(`${resolvedItemName} quantity updated to ${quantity}`);
      return {
        success: true, 
        message: `Quantity for ${resolvedItemName} has been updated to ${quantity}. Now, ask the user if they want to post this data entry (Yes/No).` 
      };
    }

    if (call.name === "remove_item_entry") {
      const itemName = String(call.args.item_name ?? "").trim();
      const line = findNavLine(itemName);
      if (!line) {
        return {
          success: false,
          error: `Item ${itemName || "selected"} not found.`,
        };
      }

      const resolvedItemName = String(
        line.iteM_NAME || line.parameteR_NAME || "",
      ).trim();
      updateNavItemQuantity(resolvedItemName, 0);
      showToast(`Removed entry for ${resolvedItemName}`);
      return {
        success: true,
        message: `Item ${resolvedItemName} has been cleared/removed.`,
      };
    }

    if (call.name === "get_current_data_entry_state") {
      const activeFlow = poRef.current.activeFlow;
      const navData = poRef.current.navData;
      const batchNo = navData?.data?.header?.[0]?.batcH_NO || "None";
      const linesWithQty = navData?.data?.line.filter((line) => Number(line.actuaL_VALUE) > 0) || [];
      const currentItem = linesWithQty.length > 0 ? linesWithQty[linesWithQty.length - 1].iteM_NAME : "None";

      return {
        success: true,
        data: {
          active_flow: activeFlow,
          current_batch: batchNo,
          last_updated_item: currentItem,
          items_with_quantity: linesWithQty.map((line) => ({ name: line.iteM_NAME, qty: line.actuaL_VALUE }))
        },
        message: `The current active batch is ${batchNo}. ${currentItem !== "None" ? `The last item updated was ${currentItem}.` : "No items have been updated yet."}`
      };
    }

    if (call.name === "post_data_entry") {
      const navData = poRef.current.navData;
      if (!navData || !navData.data) {
        return { success: false, error: "No data entry session active." };
      }



      const h = navData.data.header[0] || {};

      const header = {
        DATAENTRY_ID: intValue(h.dataentrY_ID),
        NOB_ID: intValue(h.noB_ID),
        NATURE_OF_BUSINESS: textValue(h.naturE_OF_BUSINESS),
        LOB_ID: intValue(h.loB_ID),
        LINE_OF_BUSINESS: textValue(h.linE_OF_BUSINESS),
        BATCH_ID: textValue(h.batcH_ID),
        BATCH_NO: textValue(h.batcH_NO),
        BREED_NAME: textValue(h.breeD_NAME),
        TEMPLATE_NAME: textValue(h.templatE_NAME),
        TEMPLATE_ID: intValue(h.templatE_ID),
        LOCATION_NAME: textValue(h.locatioN_NAME),
        POSTING_DATE: textValue(h.p_DATE),
        AGE_DAYS: textValue(h.agE_DAYS, "0"),
        AGE_WEEK: textValue(h.agE_WEEK, "0"),
        OPENING_QTY: textValue(h.openinG_QTY, "0"),
        START_DATE: textValue(h.s_DATE),
        RUNNING_COST: textValue(h.runninG_COST, "0"),
        CREATED_BY: intValue("778"),
        company_id: textValue("275"),
        status: "posted",
        LOCATION: textValue(h.location),
        ENTRY_FROM: "Web",
        CURRENT_LOCATION: textValue(h.currenT_LOCATION),
        CHK_in_lat: textValue(h.chK_in_lat),
        CHK_in_long: textValue(h.chK_in_long),
        REMARK: textValue(h.remark),
      };

      const lines = navData.data.line.map((item: NavLine) => ({
        PARAMETER_TYPE: textValue(item.parameteR_TYPE),
        PARAMETER_TYPE_ID: intValue(item.parameteR_TYPE_ID),
        PARAMETER_NAME: textValue(item.parameteR_NAME),
        ACTUAL_VALUE: textValue(item.actuaL_VALUE, "0"),
        UNIT_COST: textValue(item.uniT_COST, "0"),
        DATAENTRY_TYPE_ID: intValue(item.dataentrY_TYPE_ID),
        DATAENTRY_TYPE: textValue(item.dataentrY_TYPE),
        DATAENTRY_UOM: textValue(item.dataentrY_UOM),
        OCCURRENCE: textValue(item.occurrence),
        FREQUENCY_START_DATE: textValue(item.frequencY_START_DATE, "0"),
        FREQUENCY_END_DATE: textValue(item.frequencY_END_DATE, "0"),
        ITEM_NAME: item.iteM_NAME,
        LINE_AMOUNT: floatValue(item.linE_AMOUNT),
        PARAMETER_ID: intValue(item.parameteR_ID),
        FORMULA_FLAG: textValue(item.formulA_FLAG),
        ITEM_ID: intValue(item.iteM_ID),
        Parameter_input_type: textValue(item.parameter_input_type),
        Parameter_input_format: textValue(item.parameter_input_format),
        Parameter_input_value: textValue(item.parameter_input_value),
      }));

      const updatedData = {
        header,
        lines,
        livestock: [],
      };

      console.log("🚀 FINAL MAPPED DATA ENTRY:", updatedData);
      const res = await fetch("/api/navfarm/insert-dataentry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData),
      });

      const result = await res.json();

      console.log("🚀 FINAL API RESPONSE:", result);

      if (!res.ok || !result.success) {
        return {
          success: false,
          error:
            result.error ||
            result.message ||
            result.data?.message ||
            "NavFarm data entry post failed.",
        };
      }

      showToast(`Batch ${header.BATCH_NO} posted successfully!`);

      resetDataEntry();
      return {
        success: true,
        message:
          result.message ||
          `Data entry for batch ${header.BATCH_NO} has been successfully posted.`,
      };
    }

    return { error: "Unknown tool" };
  };

  const teardownVoicePipeline = useCallback(() => {
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;

    monitorGainRef.current?.disconnect();
    monitorGainRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const disconnect = useCallback(
    (closeSession = true) => {
      if (isDisconnectingRef.current) return;
      isDisconnectingRef.current = true;

      textRequestAbortRef.current?.abort();
      textRequestAbortRef.current = null;

      setIsConnected(false);
      isConnectedRef.current = false;
      stopAllAudio();
      teardownVoicePipeline();

      if (closeSession && sessionRef.current) {
        try {
          sessionRef.current.close();
        } catch { }
      }

      sessionRef.current = null;
      setStatus("idle");
      setIsTextSending(false);

      queueMicrotask(() => {
        isDisconnectingRef.current = false;
      });
    },
    [stopAllAudio, teardownVoicePipeline],
  );

  const connect = async () => {
    if (viewingSavedChat) {
      setError(
        "You are viewing a past chat. Please return to current chat to use voice.",
      );
      return;
    }
    if (status === "initializing") {
      return;
    }
    // Ensure any existing session is closed before starting a new one
    disconnect(true);
    
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    if (!apiKey) {
      setError("API Configuration Error. Please check your .env file.");
      return;
    }
    setError(null);
    setStatus("initializing");

    try {
      const GoogleGenAI = await loadSDK();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      if (!inputAudioCtxRef.current)
        inputAudioCtxRef.current = new AudioContext({
          sampleRate: INPUT_SAMPLE_RATE,
        });
      if (!outputAudioCtxRef.current)
        outputAudioCtxRef.current = new AudioContext({
          sampleRate: OUTPUT_SAMPLE_RATE,
        });
      if (inputAudioCtxRef.current.state === "suspended")
        await inputAudioCtxRef.current.resume();
      if (outputAudioCtxRef.current.state === "suspended")
        await outputAudioCtxRef.current.resume();

      const ai = new GoogleGenAI({ apiKey });
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: PO_TOOLS,
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            isConnectedRef.current = true;
            setStatus("listening");

            const source =
              inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const monitorGain = inputAudioCtxRef.current!.createGain();
            monitorGain.gain.value = 0;
            const scriptProcessor =
              inputAudioCtxRef.current!.createScriptProcessor(2048, 1, 1);
            mediaSourceRef.current = source;
            monitorGainRef.current = monitorGain;
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              if (
                sessionRef.current &&
                isConnectedRef.current &&
                !isMutedRef.current
              ) {
                const pcmData = encodePcm(e.inputBuffer.getChannelData(0));
                try {
                  sessionRef.current.sendRealtimeInput?.({
                    media: { data: pcmData, mimeType: "audio/pcm;rate=16000" },
                  });
                } catch { }
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(monitorGain);
            monitorGain.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (msg: LiveMessage) => {
            console.log("🎙️ [Voice] Message received:", msg);

            // 1. User transcription — APPEND each chunk to one streaming message
            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text || "";
              if (text) {
                stopAllAudio();
                appendToStreamingMessage("user", text);
              }
            }

            // 2. Bot transcription — APPEND each chunk to one streaming bot message
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text || "";
              // Strip any internal tool call text that leaks through
              const isToolCallLeak =
                /TOOL\s*CALL|update_po_field|create_po|start_data_entry|set_batch_number|check_item_exists|update_item_quantity|remove_item_entry|post_data_entry|check_stock_levels|review_pending_approvals|contact_vendor|functionCall/i.test(
                  text,
                );
              if (text && !isToolCallLeak) {
                // Remove internal thinking markers if model outputs them
                const cleanText = text.replace(/^(?:thought|thinking|ok|sure|alright)[,.\s]*/i, "");
                if (cleanText) {
                  appendToStreamingMessage("bot", cleanText);
                  setStatus("speaking");
                }
              }
            }

            // 3. Tool Calls — execute silently, NEVER show in UI
            if (msg.toolCall) {
              setStatus("thinking");
              const functionCalls = msg.toolCall.functionCalls;
              console.log("🛠 [Voice] Executing tool calls...", functionCalls);
              const functionResponses = await Promise.all(
                functionCalls.map(async (call) => {
                  const response = await handleAction(call);
                  return buildLiveToolResponse(call, response);
                }),
              );
              console.log("✅ [Voice] Tool responses:", functionResponses);
              if (sessionRef.current) {
                const session = sessionRef.current as LiveSessionWithConnection;
                const { conn, send, target } = getLiveSendTarget(session);
                
                console.log("🎙️ WS STATE:", conn.readyState);
                if (isLiveConnectionClosed(conn)) {
                   console.warn("⚠️ [Voice] Connection is closing/closed. Skipping send.");
                   return;
                }

                if (typeof session.sendToolResponse === "function") {
                  try {
                    console.log("🎙️ [Voice] Sending SDK tool response:", functionResponses);
                    await session.sendToolResponse({ functionResponses });
                    if (isConnectedRef.current) setStatus("listening");
                  } catch (err) {
                    console.error("❌ [Voice] Tool response error:", err);
                  }
                } else if (typeof send === "function") {
                  const payload = { toolResponse: { functionResponses } };
                  try {
                    console.log("🎙️ [Voice] Sending fallback tool response:", payload);
                    send.call(target, payload);
                    if (isConnectedRef.current) setStatus("listening");
                  } catch (err) {
                    console.error("❌ [Voice] Fallback tool response error:", err);
                  }
                }
              }
            }

            // 4. Turn Complete — finalize streaming messages
            if (msg.serverContent?.turnComplete) {
              finalizeStreaming();
              setStatus("listening");
            }

            // 5. Audio Playback
            const modelTurn = msg.serverContent?.modelTurn;
            if (modelTurn?.parts && outputAudioCtxRef.current) {
              const ctx = outputAudioCtxRef.current;
              for (const part of modelTurn.parts) {
                if (part.inlineData) {
                  setIsSpeaking(true);
                  const buffer = await decodePcm(part.inlineData.data, ctx);
                  const source = ctx.createBufferSource();
                  source.buffer = buffer;
                  source.connect(ctx.destination);
                  const now = ctx.currentTime;
                  if (nextStartTimeRef.current < now)
                    nextStartTimeRef.current = now;
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += buffer.duration;
                  activeSourcesRef.current.add(source);
                  source.onended = () => {
                    activeSourcesRef.current.delete(source);
                    if (activeSourcesRef.current.size === 0)
                      setIsSpeaking(false);
                  };
                }
              }
            }
          },
          onerror: (e: Error) => {
            setError(`Connection lost: ${e.message}`);
            disconnect(false);
          },
          onclose: (event?: { code?: number; reason?: string }) => {
            console.warn("⚠️ [Voice] Session closed:", {
              code: event?.code,
              reason: event?.reason,
            });
            disconnect(false);
          },
        },
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      teardownVoicePipeline();
      const message =
        err instanceof Error ? err.message : "Failed to start voice session.";
      setError(message);
      setStatus("error");
    }
  };

  /**
   * Helper to send voice intents properly without breaking the audio session.
   * Treats UI interaction as conversational voice input.
   */
  const sendVoiceIntent = useCallback((text: string) => {
    if (!sessionRef.current || !isConnected) return;
    
    try {
      const session = sessionRef.current as LiveSessionWithConnection;
      const { conn, send, target } = getLiveSendTarget(session);

      if (isLiveConnectionClosed(conn)) {
        console.warn("⚠️ [Voice] WS is closing/closed (state:", conn.readyState, "). Reconnecting...");
        disconnect(true);
        setTimeout(() => connect(), 500);
        return;
      }

      const turns = [{
        role: "user" as const,
        parts: [{ text }]
      }];

      if (typeof session.sendClientContent === "function") {
        console.log("🎙️ [Voice] Sending voice intent:", text);
        void Promise.resolve(
          session.sendClientContent({
            turns,
            turnComplete: true
          }),
        ).catch((err) => {
          console.error("❌ [Voice] SDK client content error:", err);
        });
      } else if (typeof send === "function") {
        console.log("🎙️ [Voice] Sending fallback voice intent:", text);
        send.call(target, {
          clientContent: {
            turns,
            turnComplete: true
          }
        });
      }
    } catch (err) {
      console.error("❌ [Voice] Failed to send voice intent:", err);
    }
  }, [isConnected]);

  const handleSendMessage = async (messageOverride?: string) => {
    if (viewingSavedChat) return;
    const draftMessage = messageOverride ?? inputText;
    if (!draftMessage.trim() || isTextSending) return;

    stopAllAudio();

    const messageToSend = draftMessage.trim();
    setInputText("");

    // Detect PO intent and start flow
    const isPOIntent = /purchase order|create po|new po|order something/i.test(
      messageToSend,
    );
    const isDataEntryIntent = /data entry|batch|nav data|apply data/i.test(
      messageToSend,
    );
    let requestPoData: POState = poRef.current;

    if (isPOIntent && poRef.current.activeFlow !== "PO") {
      startPO();
      requestPoData = {
        ...poRef.current,
        isActive: true,
        activeFlow: "PO",
        navData: null,
        currentStep: "vendor",
        vendor: "",
        item: "",
        quantity: "",
        price: "",
        deliveryDate: "",
        sessionId: Date.now().toString(),
      };
    } else if (isDataEntryIntent && !poRef.current.isActive) {
      const navData = JSON.parse(JSON.stringify(INITIAL_NAV_DATA));
      if (navData.data?.header?.[0]) {
        navData.data.header[0].batcH_NO = "";
      }
      startDataEntry(navData);
      requestPoData = {
        ...poRef.current,
        isActive: true,
        activeFlow: "DATA_ENTRY",
        navData,
        sessionId: Date.now().toString(),
      };
      void loadBatchSummary();
      
      // If voice is active, we should also trigger the tool call internally
      if (isConnected && sessionRef.current) {
        handleAction({ name: "start_data_entry", args: {} });
      }
    }

    // Add user message to store (persisted)
    addMessage({ role: "user", text: messageToSend });
    setStatus("thinking");

    if (sessionRef.current && isConnected) {
      sendVoiceIntent(messageToSend);
      return;
    }

    // Case 2: Text Chat — call API with full conversation history
    try {
      textRequestAbortRef.current?.abort();
      const controller = new AbortController();
      textRequestAbortRef.current = controller;
      setIsTextSending(true);

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: messageToSend,
          poData: requestPoData,
          history: messagesRef.current, // send full conversation context
        }),
      });
      const data = await res.json();
      console.log("📥 [Chat] Response data:", data);

      if (!res.ok) {
        throw new Error(data.error || "Failed to reach assistant.");
      }

      // 1. Process tool calls from text chat
      if (data.toolCalls && data.toolCalls.length > 0) {
        for (const toolCall of data.toolCalls) {
          console.log(
            "🛠 [Chat] Executing tool:",
            toolCall.name,
            toolCall.args,
          );
          try {
            const result = await handleAction(toolCall);
            console.log("✅ [Chat] Tool execution result:", result);

            if (result?.success === false && result.error) {
              data.text = result.error;
            } else if (
              (!data.text || /^executing\b/i.test(data.text)) &&
              result?.message
            ) {
              data.text = result.message;
            }
          } catch (toolErr) {
            console.error("❌ [Chat] Tool execution failed:", toolErr);
          }
        }
      }

      // 2. Apply any fields parsed server-side
      if (data.parsedFields && Object.keys(data.parsedFields).length > 0) {
        console.log("🏷 [Chat] Applying parsed fields:", data.parsedFields);
        Object.entries(data.parsedFields).forEach(([field, value]) => {
          updatePOField(field as keyof typeof poRef.current, value as string);
        });
      }

      addMessage({
        role: "bot",
        text: data.text || "I could not process that request.",
      });
      setStatus("idle");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to reach assistant.";
      if (message !== "The operation was aborted.") {
        setError(message);
      }
      setStatus("error");
    } finally {
      setIsTextSending(false);
      textRequestAbortRef.current = null;
    }
  };

  const getInsights = () => [
    {
      icon: TrendingUp,
      label: "PO Volume",
      value: "↑ 12% this week",
      color: "text-emerald-500",
    },
    {
      icon: ClipboardList,
      label: "Open Orders",
      value: "7 pending approval",
      color: "text-amber-500",
    },
    {
      icon: CheckCircle2,
      label: "Completed",
      value: "23 this month",
      color: "text-blue-500",
    },
  ];

  const getAlerts = () => [
    { text: "Bosch delivery overdue by 2 days", urgent: true },
    { text: "Stock low: Hammer SKU-4421", urgent: true },
    { text: "New vendor quote received", urgent: false },
  ];

  const getActions = () => [
    "Start Data Entry",
    "Check Stock Levels",
    "Review Approvals",
    "Contact Vendor",
  ];

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-300 overflow-hidden font-sans">
      {/* ── MOBILE BACKDROPS ── */}
      <AnimatePresence>
        {isMobile && sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isMobile && rightPanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-30 backdrop-blur-sm"
            onClick={() => setRightPanelOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── LEFT SIDEBAR ── */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={isMobile ? { x: -280 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { x: 0 } : { width: 260, opacity: 1 }}
            exit={isMobile ? { x: -280 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className={`flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 overflow-hidden flex-shrink-0 z-40 ${isMobile
              ? "fixed inset-y-0 left-0 w-[280px] shadow-2xl"
              : "relative"
              }`}
          >
            {/* Logo */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
              <img
                src="https://media.licdn.com/dms/image/v2/C4D0BAQHnfBdWwg6UYA/company-logo_200_200/company-logo_200_200/0/1630577118335/prudence_technology_private_limited_logo?e=2147483647&v=beta&t=e3efGb_pZKT5QLwLW4zTPvUj1ENVmmfMzcff3AYM2wk"
                alt="Prudence Logo"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <div className="min-w-0">
                <p className="font-bold text-sm leading-none text-zinc-900 dark:text-zinc-100 truncate">
                  Prudence ERP
                </p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                  AI Assistant
                </p>
              </div>
            </div>

            {/* New Chat */}
            <div className="p-3">
              <button
                onClick={() => {
                  setInputText("");
                  setError(null);
                  setStatus("idle");
                  setSessionResumePrompt(false);
                  stopAllAudio();
                  startNewChat();
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-all hover:shadow-md"
              >
                <Plus size={16} />
                New Conversation
              </button>
            </div>

            {/* History */}
            <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-hide">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-2 py-2">
                History ({savedChats.length})
              </p>
              {savedChats.length === 0 && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 px-3 italic">
                  No saved chats
                </p>
              )}
              {savedChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => loadSavedChat(chat)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group mb-0.5 ${viewingSavedChat?.id === chat.id ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare
                      size={14}
                      className={`mt-0.5 flex-shrink-0 ${viewingSavedChat?.id === chat.id ? "text-emerald-500" : "text-zinc-400"}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {chat.title}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                        {chat.preview}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-300 dark:text-zinc-600 text-right mt-1">
                    {chat.time}
                  </p>
                </button>
              ))}
            </div>

            {/* User Profile */}
            <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3 px-2 py-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  A
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                    Admin User
                  </p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    Production Env
                  </p>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── TOP BAR ── */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 backdrop-blur-xl sticky top-0 z-20 flex-shrink-0">
          {/* Left: hamburger + Logo (when sidebar closed) */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Menu size={18} />
            </button>
            {!sidebarOpen && (
              <img
                src="https://media.licdn.com/dms/image/v2/C4D0BAQHnfBdWwg6UYA/company-logo_200_200/company-logo_200_200/0/1630577118335/prudence_technology_private_limited_logo?e=2147483647&v=beta&t=e3efGb_pZKT5QLwLW4zTPvUj1ENVmmfMzcff3AYM2wk"
                alt="Prudence"
                className="w-7 h-7 rounded-lg object-cover"
              />
            )}
          </div>

          {/* Center: Assistant Name + Status */}
          <div className="flex flex-col items-center">
            <h1 className="font-bold text-base leading-tight text-zinc-900 dark:text-zinc-100">
              AI Agent
            </h1>
            <div className="flex items-center gap-1.5">
              <div
                className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`}
              />
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-widest font-bold flex items-center gap-1">
                {status === "thinking" && (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                )}
                {STATUS_LABELS[status]}
              </p>
            </div>
          </div>

          {/* Right: Actions + Settings */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <GoogleTranslate />

            {/* Save / Clear Buttons */}
            {!viewingSavedChat && activeMessages.length > 0 && (
              <>
                <button
                  onClick={() => {
                    saveCurrentChat();
                    showToast("Chat saved!");
                  }}
                  className="p-1.5 sm:p-2 flex items-center gap-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-xs font-semibold"
                  title="Save this conversation to history"
                >
                  <Save size={15} />{" "}
                  <span className="hidden sm:inline">Save</span>
                </button>
                <button
                  onClick={() => clearMessages()}
                  className="p-1.5 sm:p-2 rounded-lg text-rose-500/70 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  title="Clear current view (does not reset PO)"
                >
                  <Trash2 size={16} />
                </button>
                <div className="w-px h-5 sm:h-6 bg-zinc-200 dark:bg-zinc-800 mx-0.5 sm:mx-1"></div>
              </>
            )}

            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-emerald-500 transition-colors"
              title={
                mounted
                  ? `Switch to ${theme === "dark" ? "light" : "dark"} mode`
                  : "Toggle theme"
              }
              suppressHydrationWarning
            >
              {!mounted ? (
                <Moon size={17} />
              ) : theme === "dark" ? (
                <Sun size={17} />
              ) : (
                <Moon size={17} />
              )}
            </button>
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex"
              title="Toggle insights panel"
            >
              <MoreHorizontal size={17} />
            </button>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold ml-1">
              A
            </div>
          </div>
        </header>

        {/* ── BODY: Chat + Right Panel ── */}
        <div className="flex flex-1 min-h-0">
          {/* ── CENTER: CHAT ── */}
          <main className="flex-1 flex flex-col relative bg-slate-50 dark:bg-zinc-950 min-w-0">
            {/* ── SESSION RECOVERY BANNER ── */}
            <AnimatePresence>
              {/* {!viewingSavedChat && sessionResumePrompt && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mx-4 mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                      You were creating a purchase order. Continue where you left off?
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setSessionResumePrompt(false)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors"
                    >
                      Continue
                    </button>
                    <button
                      onClick={() => { resetPO(); setSessionResumePrompt(false); clearMessages(); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </motion.div>
              )} */}
            </AnimatePresence>

            {/* ── READ-ONLY BANNER ── */}
            <AnimatePresence>
              {viewingSavedChat && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-100 dark:border-indigo-800 p-3 pr-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 ml-4">
                    <MessageSquare
                      size={16}
                      className="text-indigo-600 dark:text-indigo-400"
                    />
                    <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                      Viewing past chat:{" "}
                      <span className="font-bold">
                        {viewingSavedChat.title}
                      </span>{" "}
                      ({viewingSavedChat.time})
                    </span>
                  </div>
                  <button
                    onClick={resumeActiveChat}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                  >
                    <ArrowLeft size={14} /> Resume This Chat
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── TOAST NOTIFICATION ── */}
            <AnimatePresence>
              {toastMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -20, x: "-50%" }}
                  animate={{ opacity: 1, y: 16, x: "-50%" }}
                  exit={{ opacity: 0, y: -20, x: "-50%" }}
                  className="absolute top-0 left-1/2 z-50 px-4 py-2 bg-zinc-800 dark:bg-emerald-900 text-white text-sm font-semibold rounded-full shadow-lg border border-zinc-700 dark:border-emerald-700 flex items-center gap-2"
                >
                  <CheckCircle2
                    size={16}
                    className={
                      theme === "dark" ? "text-emerald-400" : "text-emerald-500"
                    }
                  />
                  {toastMessage}
                </motion.div>
              )}
            </AnimatePresence>


            {/* Voice Wave Animation */}
            {!viewingSavedChat && isConnected && (
              <div className="flex items-center justify-center gap-1 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                {VOICE_WAVE_BARS.map((heightFactor, i) => (
                  <motion.div
                    key={`${heightFactor}-${i}`}
                    className="w-1 rounded-full bg-emerald-500"
                    animate={{
                      height: isSpeaking
                        ? [4, 8 + heightFactor * 20, 4]
                        : [4, 8, 4],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.5 + i * 0.07,
                      ease: "easeInOut",
                    }}
                  />
                ))}
                <span className="ml-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {isSpeaking ? "Speaking..." : "Listening..."}
                </span>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16 py-6 space-y-6 scroll-smooth scrollbar-hide">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-20">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mb-5 shadow-lg">
                    <Bot size={28} className="text-white" />
                  </div>
                  <h3 className="text-xl md:text-2xl font-bold mb-3 text-zinc-800 dark:text-zinc-100">
                    How can I help you today?
                  </h3>
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 leading-relaxed px-4">
                    Create purchase orders, check inventory, manage vendors, or
                    ask anything ERP-related.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8 w-full">
                    {getActions().map((action) => (
                      <button
                        key={action}
                        onClick={() => void handleSendMessage(action)}
                        className="text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-600 dark:text-zinc-400 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === "user"
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white"
                        : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-emerald-500"
                        }`}
                    >
                      {msg.role === "user" ? (
                        <User size={14} />
                      ) : (
                        <Bot size={14} />
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      className={`flex flex-col max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`text-[11px] font-bold ${msg.role === "user"
                            ? "text-zinc-500 dark:text-zinc-400"
                            : "text-emerald-600 dark:text-emerald-400"
                            }`}
                        >
                          {msg.role === "user" ? "You" : "AI Assistance"}
                        </span>
                        <span className="text-[10px] text-zinc-300 dark:text-zinc-600">
                          {msg.timestamp}
                        </span>
                      </div>
                      <div
                        className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${msg.role === "user"
                          ? "bg-emerald-600 dark:bg-emerald-500 text-white rounded-tr-sm"
                          : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-sm"
                          }`}
                      >
                        {formatMessageText(msg.text)}
                        {msg.isStreaming && (
                          <span className="inline-block w-0.5 h-4 bg-emerald-400 animate-pulse ml-1 align-middle" />
                        )}

                        {/* Inline Batch List Buttons */}
                        {msg.role === "bot" &&
                          /(?:select a batch|choose a batch|available batches|बैच चुनें|बैच का चयन|उपलब्ध बैच|बैच चुनिए)/i.test(msg.text) &&
                          messages[messages.length - 1]?.id === msg.id && (
                            <div className="mt-4 grid grid-cols-1 gap-2 w-full">
                              <div className="flex items-center justify-between gap-3 mb-1">
                                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                                  Available Batches
                                </p>
                                {batchesError && (
                                  <button
                                    onClick={() => void loadBatchSummary()}
                                    className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                                  >
                                    Retry
                                  </button>
                                )}
                              </div>

                              {isBatchesLoading && (
                                <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                                  Loading NavFarm batches...
                                </div>
                              )}

                              {!isBatchesLoading && batchesError && (
                                <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
                                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                  <span>{batchesError}</span>
                                </div>
                              )}

                              {!isBatchesLoading && !batchesError && batchGroups.length === 0 && (
                                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                                  No batches found for the selected NavFarm filters.
                                </div>
                              )}

                              {!isBatchesLoading && !batchesError && batchGroups.map((group) => (
                                <div key={`${group.lob_id}-${group.line_of_business}`} className="space-y-2">
                                  <div className="flex items-center justify-between gap-3 px-1">
                                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                      {group.line_of_business}
                                    </p>
                                    <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500">
                                      {group.batches.length} batches
                                    </p>
                                  </div>
                                  {group.batches.map((batch) => (
                                    <button
                                      key={`${group.lob_id}-${batch.batch_id}`}
                                      onClick={() => void handleSendMessage("Select batch " + batch.batch_no)}
                                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-50/30 transition-all text-left flex justify-between items-center gap-3 group"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 break-words">
                                          {batch.batch_no}
                                        </p>
                                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          Remaining {batch.remaining_stocks} / Opening {batch.opening_stocks}
                                        </p>
                                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                                          Start {displayValue(batch.start_date)} • Last entry {displayValue(batch.last_entry_date)}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                          {displayValue(batch.status)}
                                        </span>
                                        <ChevronRight size={16} className="text-zinc-300 dark:text-zinc-700 group-hover:text-emerald-500" />
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}

                        {/* Inline Data Entry Item Buttons */}
                        {msg.role === "bot" &&
                          po.activeFlow === "DATA_ENTRY" &&
                          po.navData?.data?.header?.[0]?.batcH_NO &&
                          /(?:item name|select a line|select an item|which item|choose an item|item to update|आइटम चुनें|लाइन चुनें|अपडेट करें|आइटम चुनिए)/i.test(
                            msg.text,
                          ) &&
                          messages[messages.length - 1]?.id === msg.id && (
                            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-2 w-full min-w-[240px]">
                              <p className="col-span-full text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1">
                                Select a Line Item:
                              </p>
                              {po.navData?.data?.line.map((line, idx) => (
                                <button
                                  key={idx}
                                  onClick={() =>
                                    void handleSendMessage(
                                      "I select item " + getLineSelectionText(line),
                                    )
                                  }
                                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all text-left group shadow-sm"
                                >
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[12px] font-bold text-zinc-800 dark:text-zinc-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                                      {getLineSelectionText(line)}
                                    </p>
                                    <div className="flex justify-between items-center text-[10px]">
                                      <span className="text-zinc-500 dark:text-zinc-400">Stock: {displayValue(line.stock)}</span>
                                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">{displayValue(line.uniT_COST)} {displayValue(line.dataentrY_UOM, "")}</span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>

            {/* ── BOTTOM INPUT ── */}
            <footer className="px-4 md:px-8 lg:px-16 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0">
              <div className="flex items-end gap-3 max-w-3xl mx-auto">
                {/* Mic Button */}
                <button
                  disabled={viewingSavedChat !== null}
                  onClick={() => {
                    if (isConnected) {
                      disconnect();
                      return;
                    }
                    void connect();
                  }}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${viewingSavedChat
                    ? "bg-zinc-100 text-zinc-400 cursor-not-allowed opacity-50 dark:bg-zinc-800 dark:text-zinc-500"
                    : isConnected
                      ? "bg-rose-500 text-white scale-95"
                      : "bg-emerald-500 text-white hover:bg-emerald-600 hover:scale-105"
                    }`}
                  title={
                    viewingSavedChat
                      ? "Cannot use voice in past chats"
                      : isConnected
                        ? "Disconnect voice"
                        : "Connect voice"
                  }
                >
                  {isConnected ? <X size={20} /> : <Mic size={20} />}
                </button>

                {/* Text Input */}
                <div
                  className={`flex-1 flex items-center border rounded-2xl px-4 py-2.5 gap-2 transition-all ${viewingSavedChat
                    ? "bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/40 opacity-70 cursor-not-allowed"
                    : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus-within:border-emerald-400 dark:focus-within:border-emerald-500"
                    }`}
                >
                  <input
                    disabled={viewingSavedChat !== null}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={
                      viewingSavedChat
                        ? "Viewing past chat. Return to active chat to type."
                        : isConnected
                          ? "Speak or type a message..."
                          : "Type a message..."
                    }
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none disabled:bg-transparent disabled:cursor-not-allowed"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                  />
                  <button
                    disabled={viewingSavedChat !== null}
                    onClick={() => {
                      setIsMuted((prev) => {
                        const next = !prev;
                        isMutedRef.current = next;
                        return next;
                      });
                    }}
                    className={`flex-shrink-0 p-1 rounded-lg transition-colors ${viewingSavedChat
                      ? "opacity-50 cursor-not-allowed"
                      : isMuted
                        ? "text-rose-500"
                        : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
                      }`}
                  >
                    {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                  </button>
                </div>

                {/* Send Button */}
                <button
                  id="send-message-btn"
                  onClick={() => void handleSendMessage()}
                  disabled={
                    viewingSavedChat !== null ||
                    !inputText.trim() ||
                    isTextSending
                  }
                  className="w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 shadow-sm"
                >
                  {isTextSending ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-center text-zinc-300 dark:text-zinc-600 mt-2">
                Prudence ERP AI · Powered by GPT-4o + Gemini Live
              </p>
            </footer>
          </main>

          {/* ── RIGHT PANEL: Insights ── */}
          <AnimatePresence initial={false}>
            {rightPanelOpen && (
              <motion.aside
                initial={isMobile ? { x: 280 } : { width: 0, opacity: 0 }}
                animate={isMobile ? { x: 0 } : { width: 280, opacity: 1 }}
                exit={isMobile ? { x: 280 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className={`flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 overflow-hidden flex-shrink-0 z-40 ${isMobile
                  ? "fixed inset-y-0 right-0 w-[280px] shadow-[-10px_0_30px_rgba(0,0,0,0.1)]"
                  : "relative"
                  }`}
              >
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                  <h2 className="font-bold text-sm text-zinc-800 dark:text-zinc-100">
                    ERP Insights
                  </h2>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                    Live data · Updated now
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
                  {/* Insights */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                      <TrendingUp size={10} /> Insights
                    </p>
                    {getInsights().map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 mb-1.5"
                      >
                        <item.icon size={16} className={item.color} />
                        <div>
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                            {item.label}
                          </p>
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            {item.value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Alerts */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                      <Bell size={10} /> Alerts
                    </p>
                    {getAlerts().map((alert, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 px-3 py-2.5 rounded-xl mb-1.5 ${alert.urgent
                          ? "bg-rose-50 dark:bg-rose-900/20"
                          : "bg-zinc-50 dark:bg-zinc-800"
                          }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${alert.urgent ? "bg-rose-500" : "bg-zinc-400"
                            }`}
                        />
                        <p
                          className={`text-[12px] leading-snug ${alert.urgent
                            ? "text-rose-700 dark:text-rose-400 font-medium"
                            : "text-zinc-500 dark:text-zinc-400"
                            }`}
                        >
                          {alert.text}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Recommended Actions */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                      <Zap size={10} /> Recommended Actions
                    </p>
                    {getActions().map((action) => (
                      <button
                        key={action}
                        onClick={() => void handleSendMessage(action)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-300 border border-transparent transition-all mb-1.5 text-left group"
                      >
                        <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                          {action}
                        </span>
                        <ChevronRight
                          size={13}
                          className="text-zinc-300 dark:text-zinc-600 group-hover:text-emerald-400"
                        />
                      </button>
                    ))}
                  </div>

                  {/* Data Entry Items Card */}
                  {po.activeFlow === "DATA_ENTRY" && po.navData?.data?.line && (
                    <div className="mt-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                        <ClipboardList size={10} /> Data Entry Items
                      </p>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-hide">
                        {po.navData.data.line.map((line, idx) => (
                          <button
                            key={idx}
                            onClick={() =>
                              void handleSendMessage(getLineSelectionText(line))
                            }
                            className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all group ${line.actuaL_VALUE > 0
                              ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                              : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-emerald-500"
                              }`}
                          >
                            <div className="grid grid-cols-1 gap-2">
                              <div>
                                <p className="text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">
                                  Parameter Type
                                </p>
                                <p
                                  className={`text-[12px] font-semibold leading-tight ${line.actuaL_VALUE > 0
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : "text-zinc-700 dark:text-zinc-200 group-hover:text-emerald-500"
                                    }`}
                                >
                                  {displayValue(line.parameteR_TYPE)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">
                                  Parameter Name
                                </p>
                                <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
                                  {displayValue(line.parameteR_NAME)}
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <p className="text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">
                                    Cost Per Unit
                                  </p>
                                  <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
                                    {displayValue(line.uniT_COST)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">
                                    Stock
                                  </p>
                                  <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
                                    {displayValue(line.stock)}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <p className="text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">
                                  Item Name
                                </p>
                                <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200 break-words">
                                  {displayValue(line.iteM_NAME)}
                                </p>
                              </div>
                            </div>
                            <div className="flex justify-end items-center mt-2">
                              {line.actuaL_VALUE > 0 && (
                                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                  {line.actuaL_VALUE}{" "}
                                  {textValue(line.dataentrY_UOM)}
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── FLOATING ERROR TOAST ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-5 py-3 rounded-2xl shadow-2xl z-50 text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            <AlertCircle className="text-rose-500 w-5 h-5 flex-shrink-0" />
            <span className="max-w-xs">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
