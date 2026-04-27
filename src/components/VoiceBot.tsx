"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Bot
} from 'lucide-react';
import { usePOStore, getMissingFields, type POState } from '@/store/usePOStore';
import { SYSTEM_INSTRUCTION, PO_TOOLS } from '@/services/aiConfig';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-latest';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@google/genai@1.34.0/+esm';
const VOICE_WAVE_BARS = [0.52, 0.78, 0.66, 0.94, 0.58, 0.86, 0.62, 0.9, 0.7, 0.84, 0.6, 0.76];
const STATUS_LABELS = {
  idle: 'Idle',
  initializing: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Error',
} as const;

type VoiceStatus = keyof typeof STATUS_LABELS;

type RealtimeInputPayload = {
  media: {
    data: string;
    mimeType: string;
  };
};

type ToolCallRequest = {
  id: string;
  name: string;
  args: {
    field?: string;
    field_name?: string;
    value?: string;
  };
};

type ToolCallResponse = {
  success?: boolean;
  message?: string;
  po_number?: string;
  error?: string;
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
  sendRealtimeInput?: (payload: RealtimeInputPayload) => void;
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
        onclose?: () => void;
      };
    }) => Promise<LiveSession>;
  };
};

const PO_FIELDS: Array<'vendor' | 'item' | 'quantity' | 'price' | 'deliveryDate'> = [
  'vendor',
  'item',
  'quantity',
  'price',
  'deliveryDate',
];

const NUMERIC_FIELDS = new Set(['quantity', 'price']);

function getMissingPOFields(poState: POState) {
  return PO_FIELDS.filter(field => !poState[field]?.trim());
}

function normalizeFieldValue(field: string, value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  if (!NUMERIC_FIELDS.has(field)) return normalized;
  const digitsOnly = normalized.replace(/[^\d.]/g, '');
  if (!digitsOnly || Number.isNaN(Number(digitsOnly))) return '';
  return digitsOnly;
}

function formatMessageText(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[–—]/g, '-')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  } = usePOStore();

  const messages = viewingSavedChat ? viewingSavedChat.messages : activeMessages;

  // --- Local UI State (not persisted) ---
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isTextSending, setIsTextSending] = useState(false);
  const [sessionResumePrompt, setSessionResumePrompt] = useState(false);
  // Use 'light' as stable SSR default; read localStorage only after mount
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // --- Mobile Initialization ---
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
        setRightPanelOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
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
    const saved = localStorage.getItem('erp-theme') as 'light' | 'dark' | null;
    const initial = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('erp-theme', theme);
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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      if (inputAudioCtxRef.current && inputAudioCtxRef.current.state !== 'closed') {
        inputAudioCtxRef.current.close().catch(() => undefined);
      }
      if (outputAudioCtxRef.current && outputAudioCtxRef.current.state !== 'closed') {
        outputAudioCtxRef.current.close().catch(() => undefined);
      }
    };
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
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;
    const buffer = ctx.createBuffer(1, float32Array.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32Array);
    return buffer;
  };

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch {} });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const loadSDK = async () => {
    if (sdkRef.current) return sdkRef.current;
    try {
      const loader = new Function('url', 'return import(url)');
      const importedModule = await loader(SDK_URL);
      const GoogleGenAI = importedModule.GoogleGenAI || importedModule.default?.GoogleGenAI || importedModule;
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

  const handleAction = async (call: ToolCallRequest): Promise<ToolCallResponse> => {
    // Update PO field via centralized store (no UI log)
    if (call.name === 'update_po_field') {
      const field = call.args.field || call.args.field_name;
      const value = call.args.value;
      if (!field || !value || !PO_FIELDS.includes(field as typeof PO_FIELDS[number])) {
        return { success: false, error: 'Invalid field update request.' };
      }

      const normalizedValue = normalizeFieldValue(field, value);
      if (!normalizedValue) {
        return { success: false, error: `Could not verify ${field}. Ask the user to repeat it clearly.` };
      }

      updatePOField(field as keyof typeof poRef.current, normalizedValue);
      return { success: true, message: `${field} updated.` };
    }
    if (call.name === 'create_po') {
      const missingFields = getMissingPOFields(poRef.current);
      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Cannot create PO yet. Missing fields: ${missingFields.join(', ')}.`,
        };
      }

      try {
        const res = await fetch('/api/po/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(poRef.current)
        });
        const result = await res.json();
        if (result.success) {
          confirmPO();
          return { success: true, message: result.message, po_number: result.po_number };
        }
        return { success: false, error: result.error || 'ERP Integration failed' };
      } catch {
        return { success: false, error: 'ERP Integration failed' };
      }
    }
    return { error: 'Unknown tool' };
  };

  const teardownVoicePipeline = useCallback(() => {
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;

    monitorGainRef.current?.disconnect();
    monitorGainRef.current = null;

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const disconnect = useCallback((closeSession = true) => {
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
      } catch {}
    }

    sessionRef.current = null;
    setStatus('idle');
    setIsTextSending(false);

    queueMicrotask(() => {
      isDisconnectingRef.current = false;
    });
  }, [stopAllAudio, teardownVoicePipeline]);

  const connect = async () => {
    if (viewingSavedChat) {
      setError('You are viewing a past chat. Please return to current chat to use voice.');
      return;
    }
    if (status === 'initializing') {
      return;
    }
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    if (!apiKey) {
      setError('API Configuration Error. Please check your .env file.');
      return;
    }
    setError(null);
    setStatus('initializing');

    try {
      const GoogleGenAI = await loadSDK();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      mediaStreamRef.current = stream;

      if (!inputAudioCtxRef.current) inputAudioCtxRef.current = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      if (!outputAudioCtxRef.current) outputAudioCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      if (inputAudioCtxRef.current.state === 'suspended') await inputAudioCtxRef.current.resume();
      if (outputAudioCtxRef.current.state === 'suspended') await outputAudioCtxRef.current.resume();

      const ai = new GoogleGenAI({ apiKey });
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: PO_TOOLS,
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            isConnectedRef.current = true;
            setStatus('listening');

            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const monitorGain = inputAudioCtxRef.current!.createGain();
            monitorGain.gain.value = 0;
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(2048, 1, 1);
            mediaSourceRef.current = source;
            monitorGainRef.current = monitorGain;
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              if (sessionRef.current && isConnectedRef.current && !isMutedRef.current) {
                const pcmData = encodePcm(e.inputBuffer.getChannelData(0));
                try {
                  sessionRef.current.sendRealtimeInput?.({
                    media: { data: pcmData, mimeType: 'audio/pcm;rate=16000' }
                  });
                } catch {}
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(monitorGain);
            monitorGain.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (msg: LiveMessage) => {
            // 1. User transcription — APPEND each chunk to one streaming message
            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text || '';
              if (text) {
                stopAllAudio();
                // appendToStreamingMessage reads prev state via functional update
                // so it never creates a new bubble if one is already streaming
                appendToStreamingMessage('user', text);
              }
            }

            // 2. Bot transcription — APPEND each chunk to one streaming bot message
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text || '';
              // Strip any internal tool call text that leaks through
              const isToolCallLeak = /TOOL\s*CALL|update_po_field|create_po|functionCall/i.test(text);
              if (text && !isToolCallLeak) {
                appendToStreamingMessage('bot', text);
                setStatus('speaking');
              }
            }

            // 3. Tool Calls — execute silently, NEVER show in UI
            if (msg.toolCall) {
              setStatus('thinking');
              const functionCalls = msg.toolCall.functionCalls;
              const responses = await Promise.all(functionCalls.map(handleAction));
              if (sessionRef.current) {
                const sendMethod = sessionRef.current.send || sessionRef.current.sendMessage;
                if (typeof sendMethod === 'function') {
                  sendMethod.call(sessionRef.current, {
                    toolResponse: {
                      functionResponses: responses.map((resp, i) => ({
                        response: resp,
                        id: functionCalls[i].id
                      }))
                    }
                  });
                }
              }
            }

            // 4. Turn Complete — finalize streaming messages
            if (msg.serverContent?.turnComplete) {
              finalizeStreaming();
              setStatus('listening');
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
                  if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += buffer.duration;
                  activeSourcesRef.current.add(source);
                  source.onended = () => {
                    activeSourcesRef.current.delete(source);
                    if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
                  };
                }
              }
            }
          },
          onerror: (e: Error) => {
            setError(`Connection lost: ${e.message}`);
            disconnect(false);
          },
          onclose: () => disconnect(false)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      teardownVoicePipeline();
      const message = err instanceof Error ? err.message : 'Failed to start voice session.';
      setError(message);
      setStatus('error');
    }
  };

  const handleSendMessage = async () => {
    if (viewingSavedChat) return;
    if (!inputText.trim() || isTextSending) return;

    stopAllAudio();

    const messageToSend = inputText.trim();
    setInputText('');

    // Detect PO intent and start flow
    const isPOIntent = /purchase order|create po|new po|order something/i.test(messageToSend);
    if (isPOIntent && !po.isActive) {
      startPO();
    }

    // Add user message to store (persisted)
    addMessage({ role: 'user', text: messageToSend });
    setStatus('thinking');

    // Case 1: Active Voice Session — send through live session
    if (sessionRef.current && isConnected) {
      try {
        const sendMethod = sessionRef.current.send || sessionRef.current.sendMessage;
        if (typeof sendMethod === 'function') {
          sendMethod.call(sessionRef.current, { text: messageToSend });
        } else {
          throw new Error('Session send method not found');
        }
      } catch {
        setError('Failed to send message over the live session.');
        setStatus('error');
      }
      return;
    }

    // Case 2: Text Chat — call GPT-4o with full conversation history
    try {
      textRequestAbortRef.current?.abort();
      const controller = new AbortController();
      textRequestAbortRef.current = controller;
      setIsTextSending(true);

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: messageToSend,
          poData: po,
          history: messagesRef.current, // send full conversation context
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reach assistant.');
      }

      // Apply any fields parsed server-side (no tool calls shown)
      if (data.parsedFields && Object.keys(data.parsedFields).length > 0) {
        Object.entries(data.parsedFields).forEach(([field, value]) => {
          updatePOField(field as keyof typeof poRef.current, value as string);
        });
      }

      addMessage({
        role: 'bot',
        text: data.text || 'I could not process that request.',
      });
      setStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reach assistant.';
      if (message !== 'The operation was aborted.') {
        setError(message);
      }
      setStatus('error');
    } finally {
      setIsTextSending(false);
      textRequestAbortRef.current = null;
    }
  };

  const getInsights = () => [
    { icon: TrendingUp, label: 'PO Volume', value: '↑ 12% this week', color: 'text-emerald-500' },
    { icon: ClipboardList, label: 'Open Orders', value: '7 pending approval', color: 'text-amber-500' },
    { icon: CheckCircle2, label: 'Completed', value: '23 this month', color: 'text-blue-500' },
  ];

  const getAlerts = () => [
    { text: 'Bosch delivery overdue by 2 days', urgent: true },
    { text: 'Stock low: Hammer SKU-4421', urgent: true },
    { text: 'New vendor quote received', urgent: false },
  ];

  const getActions = () => [
    'Create Purchase Order',
    'Check Stock Levels',
    'Review Pending Approvals',
    'Contact Vendor',
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
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 overflow-hidden flex-shrink-0 z-40 ${
              isMobile ? 'fixed inset-y-0 left-0 w-[280px] shadow-2xl' : 'relative'
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
                <p className="font-bold text-sm leading-none text-zinc-900 dark:text-zinc-100 truncate">Prudence ERP</p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">AI Assistant</p>
              </div>
            </div>

            {/* New Chat */}
            <div className="p-3">
              <button
                onClick={() => { startNewChat(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-all hover:shadow-md"
              >
                <Plus size={16} />
                New Conversation
              </button>
            </div>

            {/* History */}
            <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-hide">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-2 py-2">History ({savedChats.length})</p>
              {savedChats.length === 0 && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 px-3 italic">No saved chats</p>
              )}
              {savedChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => loadSavedChat(chat)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group mb-0.5 ${viewingSavedChat?.id === chat.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare size={14} className={`mt-0.5 flex-shrink-0 ${viewingSavedChat?.id === chat.id ? 'text-emerald-500' : 'text-zinc-400'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{chat.title}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{chat.preview}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-300 dark:text-zinc-600 text-right mt-1">{chat.time}</p>
                </button>
              ))}
            </div>

            {/* User Profile */}
            <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3 px-2 py-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">A</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">Admin User</p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">Production Env</p>
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
            <h1 className="font-bold text-base leading-tight text-zinc-900 dark:text-zinc-100">Pru Assist AI</h1>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-widest font-bold flex items-center gap-1">
                {status === 'thinking' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                {STATUS_LABELS[status]}
              </p>
            </div>
          </div>

          {/* Right: Actions + Settings */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Save / Clear Buttons */}
            {!viewingSavedChat && activeMessages.length > 0 && (
              <>
                <button
                  onClick={() => { saveCurrentChat(); showToast('Chat saved!'); }}
                  className="p-1.5 sm:p-2 flex items-center gap-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors text-xs font-semibold"
                  title="Save this conversation to history"
                >
                  <Save size={15} /> <span className="hidden sm:inline">Save</span>
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
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-emerald-500 transition-colors"
              title={mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
              suppressHydrationWarning
            >
              {!mounted ? <Moon size={17} /> : theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex"
              title="Toggle insights panel"
            >
              <MoreHorizontal size={17} />
            </button>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold ml-1">A</div>
          </div>
        </header>

        {/* ── BODY: Chat + Right Panel ── */}
        <div className="flex flex-1 min-h-0">

          {/* ── CENTER: CHAT ── */}
          <main className="flex-1 flex flex-col relative bg-slate-50 dark:bg-zinc-950 min-w-0">

            {/* ── SESSION RECOVERY BANNER ── */}
            <AnimatePresence>
              {!viewingSavedChat && sessionResumePrompt && (
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
              )}
            </AnimatePresence>

            {/* ── READ-ONLY BANNER ── */}
            <AnimatePresence>
              {viewingSavedChat && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-100 dark:border-indigo-800 p-3 pr-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 ml-4">
                    <MessageSquare size={16} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                      Viewing past chat: <span className="font-bold">{viewingSavedChat.title}</span> ({viewingSavedChat.time})
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
                  initial={{ opacity: 0, y: -20, x: '-50%' }}
                  animate={{ opacity: 1, y: 16, x: '-50%' }}
                  exit={{ opacity: 0, y: -20, x: '-50%' }}
                  className="absolute top-0 left-1/2 z-50 px-4 py-2 bg-zinc-800 dark:bg-emerald-900 text-white text-sm font-semibold rounded-full shadow-lg border border-zinc-700 dark:border-emerald-700 flex items-center gap-2"
                >
                  <CheckCircle2 size={16} className={theme === 'dark' ? 'text-emerald-400' : 'text-emerald-500'} />
                  {toastMessage}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── PO PROGRESS INDICATOR ── */}
            {!viewingSavedChat && po.isActive && completedCount < totalFields && (
              <div className="mx-4 mt-3 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Purchase Order Progress</span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{completedCount}/{totalFields} fields</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(completedCount / totalFields) * 100}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(['vendor', 'item', 'quantity', 'price', 'deliveryDate'] as const).map(field => (
                    <span key={field} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${po[field] ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600'
                      }`}>
                      {po[field] ? `✓ ${field}` : field}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Voice Wave Animation */}
            {!viewingSavedChat && isConnected && (
              <div className="flex items-center justify-center gap-1 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                {VOICE_WAVE_BARS.map((heightFactor, i) => (
                  <motion.div
                    key={`${heightFactor}-${i}`}
                    className="w-1 rounded-full bg-emerald-500"
                    animate={{ height: isSpeaking ? [4, 8 + heightFactor * 20, 4] : [4, 8, 4] }}
                    transition={{ repeat: Infinity, duration: 0.5 + i * 0.07, ease: 'easeInOut' }}
                  />
                ))}
                <span className="ml-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {isSpeaking ? 'Speaking...' : 'Listening...'}
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
                  <h3 className="text-xl md:text-2xl font-bold mb-3 text-zinc-800 dark:text-zinc-100">How can I help you today?</h3>
                  <p className="text-sm text-zinc-400 dark:text-zinc-500 leading-relaxed px-4">Create purchase orders, check inventory, manage vendors, or ask anything ERP-related.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8 w-full">
                    {getActions().map((action) => (
                      <button
                        key={action}
                        onClick={() => { setInputText(action); }}
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
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user'
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white'
                      : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-emerald-500'
                      }`}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>

                    {/* Bubble */}
                    <div className={`flex flex-col max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[11px] font-bold ${msg.role === 'user' ? 'text-zinc-500 dark:text-zinc-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                          {msg.role === 'user' ? 'You' : 'AI Assistance'}
                        </span>
                        <span className="text-[10px] text-zinc-300 dark:text-zinc-600">{msg.timestamp}</span>
                      </div>
                      <div className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${msg.role === 'user'
                        ? 'bg-emerald-600 dark:bg-emerald-500 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-sm'
                        }`}>
                        {formatMessageText(msg.text)}
                        {msg.isStreaming && <span className="inline-block w-0.5 h-4 bg-emerald-400 animate-pulse ml-1 align-middle" />}
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
                  className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm ${viewingSavedChat ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed opacity-50 dark:bg-zinc-800 dark:text-zinc-500' :
                    isConnected
                      ? 'bg-rose-500 text-white scale-95'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600 hover:scale-105'
                    }`}
                  title={viewingSavedChat ? "Cannot use voice in past chats" : isConnected ? 'Disconnect voice' : 'Connect voice'}
                >
                  {isConnected ? <X size={20} /> : <Mic size={20} />}
                </button>

                {/* Text Input */}
                <div className={`flex-1 flex items-center border rounded-2xl px-4 py-2.5 gap-2 transition-all ${viewingSavedChat
                  ? 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/40 opacity-70 cursor-not-allowed'
                  : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus-within:border-emerald-400 dark:focus-within:border-emerald-500'
                  }`}>
                  <input
                    disabled={viewingSavedChat !== null}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={
                      viewingSavedChat
                        ? 'Viewing past chat. Return to active chat to type.'
                        : isConnected
                          ? 'Speak or type a message...'
                          : 'Type a message...'
                    }
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none disabled:bg-transparent disabled:cursor-not-allowed"
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  />
                  <button
                    disabled={viewingSavedChat !== null}
                    onClick={() => {
                      setIsMuted(prev => {
                        const next = !prev;
                        isMutedRef.current = next;
                        return next;
                      });
                    }}
                    className={`flex-shrink-0 p-1 rounded-lg transition-colors ${viewingSavedChat ? 'opacity-50 cursor-not-allowed' :
                      isMuted ? 'text-rose-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
                      }`}
                  >
                    {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                  </button>
                </div>

                {/* Send Button */}
                <button
                  onClick={handleSendMessage}
                  disabled={viewingSavedChat !== null || !inputText.trim() || isTextSending}
                  className="w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 shadow-sm"
                >
                  {isTextSending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </div>
              <p className="text-[10px] text-center text-zinc-300 dark:text-zinc-600 mt-2">Prudence ERP AI · Powered by GPT-4o + Gemini Live</p>
            </footer>
          </main>

          {/* ── RIGHT PANEL: Insights ── */}
          <AnimatePresence initial={false}>
            {rightPanelOpen && (
              <motion.aside
                initial={isMobile ? { x: 280 } : { width: 0, opacity: 0 }}
                animate={isMobile ? { x: 0 } : { width: 280, opacity: 1 }}
                exit={isMobile ? { x: 280 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className={`flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 overflow-hidden flex-shrink-0 z-40 ${
                  isMobile ? 'fixed inset-y-0 right-0 w-[280px] shadow-[-10px_0_30px_rgba(0,0,0,0.1)]' : 'relative'
                }`}
              >
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                  <h2 className="font-bold text-sm text-zinc-800 dark:text-zinc-100">ERP Insights</h2>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">Live data · Updated now</p>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">

                  {/* Insights */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                      <TrendingUp size={10} /> Insights
                    </p>
                    {getInsights().map((item) => (
                      <div key={item.label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 mb-1.5">
                        <item.icon size={16} className={item.color} />
                        <div>
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{item.label}</p>
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{item.value}</p>
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
                      <div key={i} className={`flex items-start gap-2 px-3 py-2.5 rounded-xl mb-1.5 ${alert.urgent ? 'bg-rose-50 dark:bg-rose-900/20' : 'bg-zinc-50 dark:bg-zinc-800'
                        }`}>
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${alert.urgent ? 'bg-rose-500' : 'bg-zinc-400'
                          }`} />
                        <p className={`text-[12px] leading-snug ${alert.urgent ? 'text-rose-700 dark:text-rose-400 font-medium' : 'text-zinc-500 dark:text-zinc-400'
                          }`}>{alert.text}</p>
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
                        onClick={() => setInputText(action)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-300 border border-transparent transition-all mb-1.5 text-left group"
                      >
                        <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">{action}</span>
                        <ChevronRight size={13} className="text-zinc-300 dark:text-zinc-600 group-hover:text-emerald-400" />
                      </button>
                    ))}
                  </div>

                  {/* PO Status Card */}
                  {Object.values(po).some(v => v && v !== '' && v !== false && v !== 'idle' && v !== 'done') && (
                    <div className="mt-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-1 mb-2 flex items-center gap-1">
                        <ClipboardList size={10} /> Active PO Draft
                      </p>
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                        {(['vendor', 'item', 'quantity', 'price', 'deliveryDate'] as const).map(key => po[key] ? (
                          <div key={key} className="flex justify-between items-center py-1">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 capitalize">{key}</span>
                            <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">{String(po[key])}</span>
                          </div>
                        ) : null)}
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
            <button onClick={() => setError(null)} className="ml-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
