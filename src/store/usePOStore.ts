"use client";
/**
 * usePOStore — Global, persisted state for Purchase Order creation.
 * Uses a custom singleton store pattern (no external deps) with localStorage persistence.
 * Shared between Chat UI and Voice Bot — single source of truth.
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FlowType = 'NONE' | 'PO' | 'DATA_ENTRY';
export type POStep = 'idle' | 'vendor' | 'item' | 'quantity' | 'price' | 'deliveryDate' | 'confirm' | 'done';

export interface NavHeader {
  batcH_NO: string;
  [key: string]: unknown;
}

export interface NavLine {
  iteM_NAME: string;
  actuaL_VALUE: number;
  [key: string]: unknown;
}

export interface NavData {
  status: string;
  message: string;
  data: {
    header: NavHeader[];
    line: NavLine[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface POState {
  vendor: string;
  item: string;
  quantity: string;
  price: string;
  deliveryDate: string;
  currentStep: POStep;
  isActive: boolean;
  sessionId: string;
  activeFlow: FlowType;
  navData: NavData | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: string;
  isStreaming?: boolean;
  isToolCall?: boolean; // internal flag — never renders in UI
}

export interface SavedChat {
  id: string;
  title: string;
  preview: string;
  time: string;
  messages: ChatMessage[];
  po?: POState;
  timestamp: number;
}

export interface FullStore {
  po: POState;
  history: ChatMessage[];
  savedChats: SavedChat[];
  activeSavedChatId?: string | null;
  language: 'en' | 'ar';
}

// ─── Default state ─────────────────────────────────────────────────────────────

const DEFAULT_PO: POState = {
  vendor: '',
  item: '',
  quantity: '',
  price: '',
  deliveryDate: '',
  currentStep: 'idle',
  isActive: false,
  sessionId: '',
  activeFlow: 'NONE',
  navData: null,
};

const STORAGE_KEY = 'erp_po_session';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadSession(): FullStore | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FullStore;
  } catch {
    return null;
  }
}

export function saveSession(store: FullStore) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getMissingFields(po: POState): POStep[] {
  const fields: POStep[] = ['vendor', 'item', 'quantity', 'price', 'deliveryDate'];
  return fields.filter(f => !po[f as keyof POState]);
}

export function getNextStep(po: POState): POStep {
  const missing = getMissingFields(po);
  if (missing.length === 0) return 'confirm';
  return missing[0];
}

export function getCompletedCount(po: POState): number {
  const fields = ['vendor', 'item', 'quantity', 'price', 'deliveryDate'];
  return fields.filter(f => !!po[f as keyof POState]).length;
}

function getVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(m => !m.isToolCall)
    .map(m => ({ ...m, isStreaming: false }));
}

function buildSavedChatSnapshot(messages: ChatMessage[], po: POState, id: string): SavedChat {
  const visibleMessages = getVisibleMessages(messages);
  const firstUserMsg = visibleMessages.find(m => m.role === 'user')?.text || 'New Conversation';
  const title = firstUserMsg.slice(0, 30) + (firstUserMsg.length > 30 ? '...' : '');
  const lastMsg = visibleMessages[visibleMessages.length - 1]?.text || '';
  const preview = lastMsg.slice(0, 40) + (lastMsg.length > 40 ? '...' : '');

  return {
    id,
    title,
    preview,
    time: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    messages: visibleMessages,
    po: { ...po },
    timestamp: Date.now(),
  };
}

function hasSameMessages(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((msg, index) => {
    const other = b[index];
    return other &&
      msg.id === other.id &&
      msg.role === other.role &&
      msg.text === other.text &&
      msg.timestamp === other.timestamp &&
      Boolean(msg.isStreaming) === Boolean(other.isStreaming);
  });
}

function hasSamePOState(a: POState | undefined, b: POState): boolean {
  if (!a) return false;
  return a.vendor === b.vendor &&
    a.item === b.item &&
    a.quantity === b.quantity &&
    a.price === b.price &&
    a.deliveryDate === b.deliveryDate &&
    a.currentStep === b.currentStep &&
    a.isActive === b.isActive &&
    a.sessionId === b.sessionId &&
    a.activeFlow === b.activeFlow &&
    JSON.stringify(a.navData) === JSON.stringify(b.navData);
}

function hasSameSavedChatContent(a: SavedChat, b: SavedChat): boolean {
  return a.title === b.title &&
    a.preview === b.preview &&
    hasSameMessages(a.messages, b.messages) &&
    hasSamePOState(a.po, b.po || DEFAULT_PO);
}

function findMatchingSavedChatIndex(chats: SavedChat[], messages: ChatMessage[]): number {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return -1;

  return chats.findIndex(chat => {
    const chatLastMessage = chat.messages[chat.messages.length - 1];
    return chat.messages.length === messages.length && chatLastMessage?.id === lastMessage.id;
  });
}

export function formatPOSummary(po: POState): string {
  return `📋 Purchase Order Summary:
• Vendor: ${po.vendor || '—'}
• Item: ${po.item || '—'}
• Quantity: ${po.quantity || '—'}
• Price: $${po.price || '—'}
• Delivery: ${po.deliveryDate || '—'}`;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function usePOStore() {
  const [po, setPo] = useState<POState>(DEFAULT_PO);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [viewingSavedChat, setViewingSavedChat] = useState<SavedChat | null>(null);
  const [activeSavedChatId, setActiveSavedChatId] = useState<string | null>(null);
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  /* eslint-disable react-hooks/set-state-in-effect -- persisted client state must load after mount. */
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setPo(saved.po);
      // Only restore non-tool-call messages
      setHistory((saved.history || []).filter(m => !m.isToolCall));
      setSavedChats(saved.savedChats || []);
      setActiveSavedChatId(saved.activeSavedChatId ?? null);
      setLanguage(saved.language || 'en');
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-save on every change
  useEffect(() => {
    if (!hydrated) return;
    saveSession({ po, history, savedChats, activeSavedChatId, language });
  }, [po, history, savedChats, activeSavedChatId, language, hydrated]);

  const syncActiveSavedChat = useCallback((messages: ChatMessage[]) => {
    if (!activeSavedChatId || messages.length === 0) return;

    const visibleMessages = getVisibleMessages(messages);
    if (visibleMessages.length === 0) return;

    setSavedChats(prev => {
      const existingIndex = prev.findIndex(chat => chat.id === activeSavedChatId);
      if (existingIndex === -1) return prev;

      const snapshot = buildSavedChatSnapshot(visibleMessages, po, activeSavedChatId);
      const existing = prev[existingIndex];
      if (hasSameSavedChatContent(existing, snapshot)) return prev;

      return [
        snapshot,
        ...prev.filter((_, index) => index !== existingIndex),
      ];
    });
  }, [activeSavedChatId, po]);

  // ── PO Actions ──

  const updatePOField = useCallback((field: keyof POState, value: string) => {
    setPo(prev => {
      const updated = { ...prev, [field]: value };
      const next = getNextStep(updated);
      return { ...updated, currentStep: next };
    });
  }, []);

  const startPO = useCallback(() => {
    const sessionId = Date.now().toString();
    setPo(prev => ({
      ...prev,
      isActive: true,
      activeFlow: 'PO',
      navData: null,
      currentStep: 'vendor',
      sessionId,
      vendor: '',
      item: '',
      quantity: '',
      price: '',
      deliveryDate: '',
    }));
  }, []);

  const resetPO = useCallback(() => {
    setPo({ ...DEFAULT_PO, sessionId: '' });
    clearSession();
  }, []);

  const confirmPO = useCallback(() => {
    setPo(prev => ({ ...prev, currentStep: 'done', isActive: false }));
    // Keep history, just mark done
  }, []);

  // ── Chat History Actions ──

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => {
    // Never add tool call messages to the visible history
    if (msg.isToolCall) return;

    const fullMsg: ChatMessage = {
      id: msg.id ?? Date.now().toString() + Math.random(),
      timestamp: msg.timestamp ?? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...msg,
    };
    setHistory(prev => {
      const next = [...prev, fullMsg];
      syncActiveSavedChat(next);
      return next;
    });
  }, [syncActiveSavedChat]);

  const updateLastBotMessage = useCallback((text: string, isStreaming = false) => {
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'bot' && last.isStreaming) {
        const next: ChatMessage[] = [...prev.slice(0, -1), { ...last, text, isStreaming }];
        syncActiveSavedChat(next);
        return next;
      }
      const botMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'bot',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isStreaming,
      };
      const next: ChatMessage[] = [...prev, botMessage];
      syncActiveSavedChat(next);
      return next;
    });
  }, [syncActiveSavedChat]);

  /**
   * appendToStreamingMessage — accumulates voice transcription chunks.
   * Each call APPENDS the new text chunk to the last streaming message of the given role.
   * If no streaming message exists for that role, creates a new one.
   * This prevents word-by-word bubble splitting.
   */
  const appendToStreamingMessage = useCallback((role: 'user' | 'bot', chunk: string) => {
    if (!chunk) return;
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.isStreaming) {
        // Append chunk to existing streaming message
        const next: ChatMessage[] = [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
        syncActiveSavedChat(next);
        return next;
      }
      // Start a new streaming message
      const streamingMessage: ChatMessage = {
        id: `${role}-stream-${Date.now()}`,
        role,
        text: chunk,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isStreaming: true,
      };
      const next: ChatMessage[] = [...prev, streamingMessage];
      syncActiveSavedChat(next);
      return next;
    });
  }, [syncActiveSavedChat]);

  const clearMessages = useCallback(() => {
    setHistory([]);
    setViewingSavedChat(null);
    setActiveSavedChatId(null);
  }, []);

  const saveCurrentChat = useCallback((options?: { linkActiveChat?: boolean }) => {
    const linkActiveChat = options?.linkActiveChat ?? true;

    setHistory(currentHistory => {
      if (currentHistory.length === 0) return currentHistory;
      const visibleMessages = getVisibleMessages(currentHistory);
      if (visibleMessages.length === 0) return currentHistory;

      setSavedChats(prev => {
        const activeIndex = activeSavedChatId
          ? prev.findIndex(chat => chat.id === activeSavedChatId)
          : -1;
        const matchingIndex = activeIndex === -1
          ? findMatchingSavedChatIndex(prev, visibleMessages)
          : activeIndex;
        const savedChatId = matchingIndex >= 0
          ? prev[matchingIndex].id
          : Date.now().toString();
        const snapshot = buildSavedChatSnapshot(visibleMessages, po, savedChatId);

        if (linkActiveChat) {
          setActiveSavedChatId(savedChatId);
        }

        if (matchingIndex >= 0) {
          const existing = prev[matchingIndex];
          const updatedChat = hasSameSavedChatContent(existing, snapshot) ? existing : snapshot;
          return [
            updatedChat,
            ...prev.filter((_, index) => index !== matchingIndex),
          ];
        }

        return [snapshot, ...prev];
      });
      return currentHistory;
    });
  }, [activeSavedChatId, po]);

  const startNewChat = useCallback(() => {
    saveCurrentChat({ linkActiveChat: false });
    setPo({ ...DEFAULT_PO, sessionId: '' });
    clearMessages();
  }, [saveCurrentChat, clearMessages]);

  const loadSavedChat = useCallback((chat: SavedChat) => {
    setViewingSavedChat(chat);
  }, []);

  const resumeActiveChat = useCallback(() => {
    if (!viewingSavedChat) return;

    const resumedMessages = viewingSavedChat.messages
      .filter(m => !m.isToolCall)
      .map(m => ({ ...m, isStreaming: false }));

    saveCurrentChat({ linkActiveChat: false });
    setHistory(resumedMessages);
    setPo(viewingSavedChat.po ? { ...viewingSavedChat.po } : { ...DEFAULT_PO });
    setActiveSavedChatId(viewingSavedChat.id);
    setViewingSavedChat(null);
  }, [saveCurrentChat, viewingSavedChat]);

  const finalizeStreaming = useCallback(() => {
    setHistory(prev => {
      const next = prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m);
      syncActiveSavedChat(next);
      return next;
    });
  }, [syncActiveSavedChat]);

  // ── NavData Actions ──

  const startDataEntry = useCallback((initialData: NavData) => {
    const sessionId = Date.now().toString();
    const navData = JSON.parse(JSON.stringify(initialData)) as NavData;
    if (navData.data?.header?.[0]) {
      navData.data.header[0].batcH_NO = '';
    }
    setPo(prev => ({
      ...prev,
      isActive: true,
      activeFlow: 'DATA_ENTRY',
      navData,
      sessionId,
    }));
  }, []);

  const updateNavBatch = useCallback((batchNo: string) => {
    setPo(prev => {
      if (!prev.navData?.data) return prev;
      const updatedNavData = { ...prev.navData };
      updatedNavData.data = { ...updatedNavData.data };
      if (updatedNavData.data.header[0]) {
        updatedNavData.data.header[0].batcH_NO = batchNo;
      }
      return { ...prev, navData: updatedNavData };
    });
  }, []);

  const updateNavItemQuantity = useCallback((itemName: string, quantity: number) => {
    setPo(prev => {
      if (!prev.navData?.data) return prev;
      const updatedNavData = { ...prev.navData };
      updatedNavData.data = { ...updatedNavData.data };
      updatedNavData.data.line = [...updatedNavData.data.line];
      
      const lineIndex = updatedNavData.data.line.findIndex(l => 
        String(l.iteM_NAME || l.parameteR_NAME || '').toLowerCase().trim() === itemName.toLowerCase().trim()
      );
      if (lineIndex !== -1) {
        updatedNavData.data.line[lineIndex].actuaL_VALUE = quantity;
      }
      return { ...prev, navData: updatedNavData };
    });
  }, []);

  const resetDataEntry = useCallback(() => {
    setPo(prev => ({ ...prev, activeFlow: 'NONE', isActive: false, navData: null }));
  }, []);

  return {
    po,
    history,
    savedChats,
    viewingSavedChat,
    hydrated,
    // Computed
    missingFields: getMissingFields(po),
    completedCount: getCompletedCount(po),
    totalFields: 5,
    nextStep: getNextStep(po),
    // PO actions
    updatePOField,
    startPO,
    resetPO,
    confirmPO,
    setPo,
    // NavData actions
    startDataEntry,
    updateNavBatch,
    updateNavItemQuantity,
    resetDataEntry,
    // Chat actions
    addMessage,
    updateLastBotMessage,
    appendToStreamingMessage,
    clearMessages,
    saveCurrentChat,
    startNewChat,
    loadSavedChat,
    resumeActiveChat,
    finalizeStreaming,
    language,
    setLanguage,
  };
}
