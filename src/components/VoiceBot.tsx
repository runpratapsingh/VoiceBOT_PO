"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, X, MessageSquare, Power, Volume2, VolumeX, Terminal } from 'lucide-react';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-latest'; // Reverted to supportive model
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000; // Increased to 24k for human-like HD audio
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@google/genai@1.34.0/+esm';

interface Message {
  role: 'user' | 'bot';
  text: string;
  timestamp: string;
}

interface VoiceBotProps {
  apiKey?: string;
  initialPersona?: string;
}

export default function VoiceBot({ apiKey: propApiKey, initialPersona }: VoiceBotProps) {
  // --- State ---
  // const [apiKey] = useState(propApiKey || 'AIzaSyA0vPgn-f798YZbJIhJyL3njB4lSNLlMxU');
  const [apiKey] = useState(propApiKey || 'AIzaSyBuqKC2HiOKMYjpx3AKVrGY2BfofJz8trI');
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState<string | null>(null);

  // --- Refs ---
  const sessionRef = useRef<any>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const chunkCountRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<any>(null);
  const isConnectedRef = useRef(false);
  const isMutedRef = useRef(false);

  // --- Auto Scroll ---
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentTranscription]);

  // --- SDK Loader ---
  const loadSDK = async () => {
    if (sdkRef.current) return sdkRef.current;
    if ((window as any).GoogleGenAI) {
      sdkRef.current = (window as any).GoogleGenAI;
      return sdkRef.current;
    }

    try {
      console.log("[Voice] Loading Gemini SDK from CDN...");
      // Bypass Turbopack/Webpack static analysis for absolute URL import
      const loader = new Function('url', 'return import(url)');
      const module = await loader(SDK_URL);
      const GoogleGenAI = module.GoogleGenAI || module.default?.GoogleGenAI || module;
      (window as any).GoogleGenAI = GoogleGenAI;
      sdkRef.current = GoogleGenAI;
      return GoogleGenAI;
    } catch (err) {
      console.error("[Voice] Failed to load SDK from CDN:", err);
      throw new Error("Failed to load Gemini SDK. Check your internet connection or CSP settings.");
    }
  };

  // --- Audio Utilities ---
  const encodePcm = (float32Array: Float32Array) => {
    const l = float32Array.length;
    const int16 = new Int16Array(l);

    // Find peak for normalization
    let peak = 0;
    for (let i = 0; i < l; i++) {
      const abs = Math.abs(float32Array[i]);
      if (abs > peak) peak = abs;
    }

    // Normalize and boost if volume is too low for VAD
    const boost = peak < 0.1 ? 2.0 : 1.0;

    for (let i = 0; i < l; i++) {
      // Boost, Clip, and Convert
      let val = float32Array[i] * boost;
      val = Math.max(-1, Math.min(1, val));
      int16[i] = val * 32768;
    }

    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const sendTestMessage = () => {
    console.log("[Voice] Test Bot button clicked.");
    if (!sessionRef.current) {
      console.warn("[Voice] Cannot test: sessionRef.current is null.");
      return;
    }
    if (!isConnected) {
      console.warn("[Voice] Cannot test: isConnected is false.");
      return;
    }

    console.log("[Voice] Sending manual test greeting...");
    try {
      // Try multiple possible methods for this SDK version
      if (sessionRef.current.send) {
        sessionRef.current.send({ text: "Hello Sara, introduction yourself please." });
      } else if (sessionRef.current.sendMessage) {
        sessionRef.current.sendMessage("Hello Sara, introduction yourself please.");
      } else {
        console.error("[Voice] No send method found on session object.");
      }
    } catch (err) {
      console.error("[Voice] Test send failed:", err);
    }
  };

  const decodePcm = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32Array.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32Array);
    return buffer;
  };

  // --- Persona & Tools ---
  const getSystemInstruction = () => {
    return initialPersona || `You are "Nexus", a highly efficient, professional ERP Voice Assistant integrated directly with Microsoft Dynamics 365 Business Central.
Your goal: Assist the user in quickly drafting and creating Purchase Orders (POs) using voice commands.

ACCENT & TONE:
- Speak with a crisp, professional, and fast pace.
- Be polite and helpful, fitting for an enterprise ERP assistant.
- Use an Indian English accent.

PROACTIVE REQUIREMENT:
- AS SOON AS THE SESSION STARTS, greet the user with: "Hello! I am Nexus, connected to Business Central. Would you like to create a new Purchase order or check an existing one?"

BEHAVIOR:
- Guide the user step-by-step to gather the following required fields for a PO: Vendor, Item, and Quantity.
- Do not ask for everything at once. Ask for one missing piece of information at a time.
- Once you have all the required information, read it back to the user to confirm (e.g., "You want to order 50 units of Laptops from vendor Dell for tomorrow. Shall I create the order?").
- Upon confirmation, use your \`createPurchaseOrder\` tool to submit the data.
- Keep responses concise for voice interaction.`;
  };

  const getTools = () => {
    return [
      {
        functionDeclarations: [
          {
            name: "createPurchaseOrder",
            description: "Create a new Purchase Order in Business Central.",
            parameters: {
              type: "OBJECT",
              properties: {
                vendor: { type: "STRING", description: "Vendor Name or Vendor No." },
                item: { type: "STRING", description: "Item Name or Item No. to purchase" },
                quantity: { type: "NUMBER", description: "Quantity of the item to purchase" },
                expected_receipt_date: { type: "STRING", description: "Expected delivery date" },
                location_code: { type: "STRING", description: "Warehouse or location code" }
              },
              required: ["vendor", "item", "quantity"]
            }
          }
        ]
      }
    ];
  };

  // --- Core Logic ---
  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsSpeaking(false);
  };

  const disconnect = useCallback(() => {
    console.log("Disconnecting...");
    setIsConnected(false);
    isConnectedRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
    stopAllAudio();

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) { }
      sessionRef.current = null;
    }

    setStatus('Disconnected');
  }, []);

  const connect = async () => {
    if (!apiKey) {
      setError("API Key is missing");
      return;
    }

    setError(null);
    setStatus('Initializing...');

    try {
      console.log("[Voice] Step 1: Loading Gemini SDK...");
      const GoogleGenAI = await loadSDK();

      console.log("[Voice] Step 2: Requesting microphone access...");
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        console.log("[Voice] Microphone access granted. Tracks:", stream.getAudioTracks().map(t => t.label));
      } catch (micErr: any) {
        console.error("[Voice] Microphone access DENIED or failed:", micErr);
        throw new Error(`Microphone error: ${micErr.message}. Please click the lock icon in your browser URL bar and allow microphone access.`);
      }

      console.log("[Voice] Step 3: Initializing Audio Contexts...");
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      }
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      }

      await inputAudioCtxRef.current.resume();
      await outputAudioCtxRef.current.resume();
      console.log("[Voice] Audio contexts resumed. State:", inputAudioCtxRef.current.state);

      console.log("[Voice] Step 4: Connecting to Gemini Live API...");
      const ai = new GoogleGenAI({ apiKey });
      console.log("[Voice] Connecting to model:", MODEL_NAME);

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: getSystemInstruction(),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' } // Switched to Puck for better energy
            }
          }
        },
        callbacks: {
          onopen: () => {
            console.log("[Voice] Session opened callback. Setting up audio pipeline...");
            setIsConnected(true);
            isConnectedRef.current = true;
            setIsListening(true);
            setStatus('Active');

            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const gainNode = inputAudioCtxRef.current!.createGain();
            gainNode.gain.value = 3.0; // Significant boost to ensure VAD trigger

            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(1024, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              let peak = 0;
              for (let i = 0; i < data.length; i++) {
                const abs = Math.abs(data[i]);
                if (abs > peak) peak = abs;
              }

              if (Math.random() < 0.1) {
                console.log("[Mic] Pulsing... True Peak:", peak.toFixed(4));
              }

              const isReady = sessionRef.current && isConnectedRef.current && !isMutedRef.current;

              if (isReady) {
                const pcmData = encodePcm(e.inputBuffer.getChannelData(0));
                try {
                  const payload = {
                    realtimeInput: {
                      mediaChunks: [{ data: pcmData, mimeType: 'audio/pcm;rate=16000' }]
                    }
                  };
                  if (sessionRef.current.sendRealtimeInput) {
                    sessionRef.current.sendRealtimeInput({
                      media: { data: pcmData, mimeType: 'audio/pcm;rate=16000' }
                    });
                    chunkCountRef.current++;
                    if (chunkCountRef.current % 50 === 0) {
                      console.log(`[Voice] Sent Audio Chunk #${chunkCountRef.current} to LLM`);
                    }
                  } else {
                    sessionRef.current.send(payload);
                  }
                } catch (err: any) {
                  console.error("[Mic] Send error:", err.message);
                }
              }
            };

            source.connect(gainNode);
            gainNode.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
            console.log("[Voice] Audio pipeline active.");
          },
          onmessage: async (msg: any) => {
            if (msg.setupComplete) console.log("[Voice] Bot setup complete (onmessage).");

            // Log everything for now to see what's happening
            if (!msg.setupComplete && !msg.serverContent?.inputTranscription) {
              console.log("[Voice] Received Message:", msg);
            }

            // Handle Transcription (Input)
            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text || '';
              if (text) {
                setCurrentTranscription(prev => prev + text);
              }
            }

            // Handle Transcription (Output)
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text || '';
              if (text) {
                setMessages(prev => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === 'bot') {
                    return [...prev.slice(0, -1), { ...lastMsg, text: lastMsg.text + text }];
                  }
                  return [...prev, { role: 'bot', text, timestamp: new Date().toLocaleTimeString() }];
                });
              }
            }

            if (msg.serverContent?.turnComplete) {
              if (currentTranscription) {
                setMessages(prev => [...prev, {
                  role: 'user',
                  text: currentTranscription,
                  timestamp: new Date().toLocaleTimeString()
                }]);
                setCurrentTranscription('');
              }
            }

            // Handle Audio Playback
            const modelTurn = msg.serverContent?.modelTurn;
            if (modelTurn?.parts && outputAudioCtxRef.current) {
              const ctx = outputAudioCtxRef.current;
              // Ensure context is running before playback
              if (ctx.state === 'suspended') await ctx.resume();

              for (const part of modelTurn.parts) {
                if (part.inlineData) {
                  const base64Data = part.inlineData.data;
                  console.log("[Voice] RECEIVED AUDIO BYTES:", base64Data.length);

                  setIsSpeaking(true);
                  const buffer = await decodePcm(base64Data, ctx);

                  const source = ctx.createBufferSource();
                  source.buffer = buffer;
                  source.connect(ctx.destination);

                  const now = ctx.currentTime;
                  if (nextStartTimeRef.current < now) {
                    nextStartTimeRef.current = now;
                  }

                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += buffer.duration;

                  activeSourcesRef.current.add(source);
                  source.onended = () => {
                    activeSourcesRef.current.delete(source);
                    if (activeSourcesRef.current.size === 0) {
                      setIsSpeaking(false);
                      console.log("[Voice] Bot finished speaking.");
                    }
                  };
                }
              }
            }

            // Handle Tool Calls
            if (msg.toolCall) {
              console.log("[Voice] Tool Call Received:", msg.toolCall);
            }

            // Handle Interruptions
            if (msg.serverContent?.interrupted) {
              console.log("[Voice] Bot interrupted by user");
              stopAllAudio();
            }
          },
          onerror: (e: any) => {
            console.error("Voice Error Callback:", e);
            setError(`Connection lost: ${e.message || 'Check model access'}`);
            disconnect();
          },
          onclose: (e: any) => {
            console.log("Voice Session Closed callback", e);
            disconnect();
          }
        }
      });

      // Capture the session object IMMEDIATELY
      sessionRef.current = await sessionPromise;
      console.log("[Voice] Session object captured and ready.");

    } catch (err: any) {
      console.error("Failed to connect:", err);
      setError(err.message || "Failed to initialize voice session");
      setStatus('Error');
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTranscription]);

  // --- UI Components ---
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4 font-sans text-slate-200">
      <AnimatePresence>
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="w-80 md:w-96 h-[500px] bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-teal-600 to-emerald-600 flex justify-between items-center shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md border border-white/20">
                  <Volume2 className="text-white w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-white font-bold leading-tight">Nexus ERP</h3>
                  <p className="text-teal-100 text-[10px] flex items-center gap-1 uppercase tracking-widest font-semibold">
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`}></span>
                    {status}
                  </p>
                </div>
              </div>
              <button
                onClick={disconnect}
                className="p-2 hover:bg-white/10 rounded-full transition-colors text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
              {messages.length === 0 && !currentTranscription && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <div className="w-20 h-20 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 shadow-[0_0_20px_rgba(20,184,166,0.1)]">
                    <Mic className="text-teal-500 w-10 h-10" />
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed">Welcome! I'm Nexus, your BC Assistant. <br /> How can I help you with Business Central today?</p>
                </div>
              )}

              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] p-3 rounded-2xl shadow-sm ${msg.role === 'user'
                    ? 'bg-teal-600 text-white rounded-tr-none'
                    : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'
                    }`}>
                    <p className="text-sm">{msg.text}</p>
                    <span className="text-[10px] opacity-50 block mt-1">{msg.timestamp}</span>
                  </div>
                </motion.div>
              ))}

              {currentTranscription && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] p-3 bg-teal-600/30 text-white border border-teal-500/20 rounded-2xl rounded-tr-none italic animate-pulse">
                    <p className="text-sm">{currentTranscription}</p>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Visualizer & Controls */}
            <div className="p-6 bg-slate-900/50 border-t border-slate-800 flex flex-col items-center gap-6">
              <div className="flex gap-4">
                <button
                  onClick={sendTestMessage}
                  className="px-3 py-1 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-teal-500/30 transition-all"
                >
                  Test Bot
                </button>
              </div>
              {/* Sphere Visualizer */}
              <div className="relative w-32 h-32 flex items-center justify-center">
                <motion.div
                  animate={{
                    scale: isSpeaking ? [1, 1.25, 1] : 1,
                    opacity: isListening ? [0.4, 0.8, 0.4] : 0.6
                  }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className={`absolute inset-0 rounded-full blur-3xl ${isSpeaking ? 'bg-emerald-500/40' : 'bg-teal-500/30'
                    }`}
                />
                <motion.div
                  animate={{
                    rotate: 360,
                    scale: isSpeaking ? 1.15 : 1
                  }}
                  transition={{ rotate: { repeat: Infinity, duration: 15, ease: 'linear' } }}
                  className={`w-24 h-24 rounded-full bg-gradient-to-br transition-all duration-700 overflow-hidden relative ${isSpeaking
                    ? 'from-emerald-400 via-teal-500 to-blue-600 shadow-[0_0_50px_rgba(16,185,129,0.5)]'
                    : 'from-teal-600 via-slate-800 to-slate-950 shadow-[0_0_30px_rgba(20,184,166,0.3)] border border-white/5'
                    }`}
                >
                  {/* Inner highlight */}
                  <div className="absolute top-2 left-6 w-12 h-6 bg-white/20 rounded-[50%] blur-sm rotate-[15deg]"></div>
                </motion.div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {isSpeaking ? (
                    <div className="flex gap-1 items-end h-4">
                      {[1, 2, 3].map(i => (
                        <motion.div
                          key={i}
                          animate={{ height: [8, 16, 8] }}
                          transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                          className="w-1 bg-white rounded-full"
                        />
                      ))}
                    </div>
                  ) : (
                    <Mic className="text-white/60 w-8 h-8" />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <button
                  onClick={() => {
                    const newVal = !isMuted;
                    setIsMuted(newVal);
                    isMutedRef.current = newVal;
                  }}
                  className={`p-4 rounded-full transition-all duration-300 ${isMuted ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-slate-800 text-slate-400 hover:text-white border border-transparent'
                    }`}
                >
                  {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                </button>
                <button
                  onClick={disconnect}
                  className="p-4 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg transition-all active:scale-90 hover:scale-105"
                >
                  <Power size={24} />
                </button>
              </div>
            </div>
            {error && (
              <div className="p-2 bg-red-500/10 text-red-500 text-[10px] text-center border-t border-red-500/20">
                {error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher Button */}
      {!isConnected && (
        <button
          onClick={connect}
          className="w-16 h-16 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-full shadow-[0_10px_40px_rgba(20,184,166,0.5)] flex items-center justify-center text-white transition-all hover:scale-110 active:scale-95 group relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-white/20 rounded-full scale-0 group-hover:scale-100 transition-transform duration-700"></div>
          <Mic size={32} className="relative z-10" />
          {status === 'Error' && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 border-4 border-slate-950 rounded-full text-[8px] flex items-center justify-center font-bold">!</span>}
        </button>
      )}
    </div>
  );
}
