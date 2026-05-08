import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { PO_TOOLS, SYSTEM_INSTRUCTION } from '@/services/aiConfig';

export const runtime = 'nodejs';

type NavRecord = Record<string, unknown>;

type NavData = {
  data?: {
    header?: NavRecord[];
    line?: NavRecord[];
    [key: string]: unknown;
  };
  header?: NavRecord[];
  line?: NavRecord[];
  [key: string]: unknown;
};

type POData = {
  vendor?: string;
  item?: string;
  quantity?: string;
  price?: string;
  deliveryDate?: string;
  activeFlow?: 'NONE' | 'PO' | 'DATA_ENTRY';
  navData?: NavData | null;
};

type HistoryMessage = {
  role: 'user' | 'bot';
  text: string;
};

type ChatRequestBody = {
  message: string;
  poData?: POData;
  history?: HistoryMessage[];
};

type NormalizedToolCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

type FunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

type FunctionDeclarationsTool = {
  functionDeclarations?: FunctionDeclaration[];
};

const DATA_ENTRY_TOOL_NAMES = new Set([
  'start_data_entry',
  'set_batch_number',
  'check_item_exists',
  'update_item_quantity',
  'remove_item_entry',
  'post_data_entry',
]);
const ERP_ACTION_TOOL_NAMES = new Set([
  'check_stock_levels',
  'review_pending_approvals',
  'contact_vendor',
]);
const KNOWN_TOOL_NAMES = new Set([
  ...DATA_ENTRY_TOOL_NAMES,
  ...ERP_ACTION_TOOL_NAMES,
]);

function normalizeAssistantText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/:\s+-\s+/g, ':\n- ')
    .replace(/\s+-\s+(?=[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+[–-])/g, '\n- ')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getNavHeader(poData?: POData): NavRecord {
  return poData?.navData?.data?.header?.[0] ?? poData?.navData?.header?.[0] ?? {};
}

function getNavLines(poData?: POData): NavRecord[] {
  return poData?.navData?.data?.line ?? poData?.navData?.line ?? [];
}

function getBatchNo(poData?: POData): string {
  return String(getNavHeader(poData).batcH_NO ?? '').trim();
}

function getLineLabel(line?: NavRecord | null): string {
  return String(line?.iteM_NAME || line?.parameteR_NAME || '').trim();
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveLineIdentifier(input: unknown, lines: NavRecord[]): NavRecord | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < lines.length) return lines[index];
  }

  const lookup = normalizeLookup(raw);
  if (!lookup) return null;

  const exact = lines.find(line => {
    const item = normalizeLookup(String(line.iteM_NAME ?? ''));
    const parameter = normalizeLookup(String(line.parameteR_NAME ?? ''));
    const label = normalizeLookup(getLineLabel(line));
    return item === lookup || parameter === lookup || label === lookup;
  });
  if (exact) return exact;

  if (lookup.length < 3) return null;

  return lines.find(line => {
    const item = normalizeLookup(String(line.iteM_NAME ?? ''));
    const parameter = normalizeLookup(String(line.parameteR_NAME ?? ''));
    const label = normalizeLookup(getLineLabel(line));
    return item.includes(lookup) || parameter.includes(lookup) || lookup.includes(item) || lookup.includes(label);
  }) ?? null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    return toRecord(JSON.parse(argumentsText || '{}'));
  } catch {
    return {};
  }
}

function normalizeToolCalls(calls: ChatCompletionMessageToolCall[] | undefined, poData?: POData): NormalizedToolCall[] {
  const lines = getNavLines(poData);
  const batchNo = getBatchNo(poData);
  const normalizedCalls: NormalizedToolCall[] = [];

  for (const call of calls ?? []) {
    if (call.type !== 'function') continue;

    const args = parseToolArguments(call.function.arguments);
    const name = call.function.name.trim();
    if (!KNOWN_TOOL_NAMES.has(name)) continue;
    if (poData?.activeFlow === 'DATA_ENTRY' && DATA_ENTRY_TOOL_NAMES.has(name)) {
      if (!batchNo && name !== 'set_batch_number') continue;
      if (batchNo && name === 'set_batch_number') continue;
    }

    if (name === 'set_batch_number') {
      args.batch_no = String(args.batch_no ?? args.batchNo ?? args.batch ?? '').trim();
      if (!args.batch_no) continue;
    }

    if (name === 'check_item_exists' || name === 'update_item_quantity' || name === 'remove_item_entry') {
      const line = resolveLineIdentifier(args.item_name ?? args.item ?? args.line_item ?? args.line, lines);
      args.item_name = line ? getLineLabel(line) : String(args.item_name ?? args.item ?? args.line_item ?? '').trim();
      if (!args.item_name) continue;
    }

    if (name === 'update_item_quantity') {
      const quantity = Number(args.quantity ?? args.actual_value ?? args.actualValue ?? args.value);
      if (!Number.isFinite(quantity)) continue;
      args.quantity = quantity;
    }

    if (name === 'check_stock_levels') {
      args.item_name = String(args.item_name ?? args.item ?? args.sku ?? '').trim();
    }

    if (name === 'contact_vendor') {
      args.vendor_name = String(args.vendor_name ?? args.vendor ?? args.supplier ?? '').trim();
      args.message = String(args.message ?? args.note ?? args.reason ?? '').trim();
      args.channel = String(args.channel ?? '').trim().toLowerCase();
      if (!args.vendor_name) continue;
    }

    normalizedCalls.push({
      id: call.id,
      name,
      args,
    });
  }

  return normalizedCalls;
}

function getLastBotText(history: HistoryMessage[]): string {
  return [...history].reverse().find(msg => msg.role === 'bot')?.text ?? '';
}

function asksForQuantity(text: string): boolean {
  return /how many|total units|actual value|quantity/i.test(text);
}

function asksAddAnother(text: string): boolean {
  return /add another item/i.test(text);
}

function asksPostBatch(text: string): boolean {
  return /post (?:the )?(?:data entry|batch)|post it|post this/i.test(text);
}

function isAffirmative(message: string): boolean {
  return /^(yes|y|yeah|yep|sure|ok|okay|confirm|please do|do it)\b/i.test(message.trim());
}

function isNegative(message: string): boolean {
  return /^(no|n|nope|not now|cancel|do not|don't)\b/i.test(message.trim());
}

function isPostIntent(message: string): boolean {
  return /\b(post|submit|finalize|finish)\b/i.test(message);
}

function extractBatchNumber(message: string): string | null {
  const explicit = message.match(/\bbatch(?:\s*(?:number|no|#|id))?\s*(?:is|:|-)?\s*([a-z0-9][a-z0-9/_.\-\s]{0,120})/i);
  if (explicit?.[1]) {
    return explicit[1]
      .replace(/\s*\(\d+\)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const compact = message.trim();
  if (/^[a-z0-9][a-z0-9/_-]{1,30}$/i.test(compact) && /\d/.test(compact)) {
    return compact;
  }

  return null;
}

function extractQuantity(message: string): number | null {
  const match = message.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const quantity = Number(match[0]);
  return Number.isFinite(quantity) ? quantity : null;
}

function findLastSelectedLine(history: HistoryMessage[], lines: NavRecord[]): NavRecord | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const msg = history[index];
    if (msg.role !== 'user') continue;
    const line = resolveLineIdentifier(msg.text, lines);
    if (line) return line;
  }
  return null;
}

function inferDataEntryToolCalls(message: string, poData: POData | undefined, history: HistoryMessage[]): NormalizedToolCall[] {
  const lookup = normalizeLookup(message);
  
  // Detect intent for data entry
  if (poData?.activeFlow !== 'DATA_ENTRY') {
    if (lookup.includes('data entry') || lookup.includes('batch entry') || lookup.includes('farm entry')) {
      return [{ name: 'start_data_entry', args: {} }];
    }
    return [];
  }

  const lines = getNavLines(poData);
  const batchNo = getBatchNo(poData);
  const lastBotText = getLastBotText(history);

  if (!batchNo) {
    const batch = extractBatchNumber(message);
    return batch ? [{ name: 'set_batch_number', args: { batch_no: batch } }] : [];
  }

  if (asksPostBatch(lastBotText) && (isAffirmative(message) || isPostIntent(message))) {
    return [{ name: 'post_data_entry', args: {} }];
  }

  const removeMatch = message.match(/\b(?:remove|clear|delete)\b(.+)?/i);
  if (removeMatch) {
    const line = resolveLineIdentifier(removeMatch[1] || message, lines);
    if (line) return [{ name: 'remove_item_entry', args: { item_name: getLineLabel(line) } }];
  }

  const quantity = extractQuantity(message);
  const selectedLine = findLastSelectedLine(history, lines);
  if (quantity !== null && selectedLine && asksForQuantity(lastBotText)) {
    return [{
      name: 'update_item_quantity',
      args: {
        item_name: getLineLabel(selectedLine),
        quantity,
      },
    }];
  }

  const selectedNow = resolveLineIdentifier(message, lines);
  if (selectedNow) {
    return [{ name: 'check_item_exists', args: { item_name: getLineLabel(selectedNow) } }];
  }

  return [];
}

function cleanupExtractedName(value: string): string {
  return value
    .replace(/\b(?:vendor|supplier|please|kindly)\b/gi, ' ')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStockItemName(message: string): string {
  return message
    .replace(/\b(?:check|show|get|review|current|stock|stocks|levels?|inventory|availability|available|for|of|item|sku|please|kindly|is|the)\b/gi, ' ')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVendorName(message: string): string {
  const explicit = message.match(/\b(?:vendor|supplier)\s+(?:name\s+)?(?:is\s+)?([a-z][\w\s&.-]{1,40}?)(?:\s+(?:about|regarding|via|by|on|for|to|with|message|email|call|phone|whatsapp)|[.!?]|$)/i);
  if (explicit?.[1]) return cleanupExtractedName(explicit[1]);

  const direct = message.match(/\b(?:contact|call|email|message|whatsapp|reach out to)\s+([a-z][\w\s&.-]{1,40}?)(?:\s+(?:about|regarding|via|by|on|for|with|vendor|supplier)|[.!?]|$)/i);
  if (direct?.[1]) return cleanupExtractedName(direct[1]);

  return '';
}

function extractContactMessage(message: string): string {
  const match = message.match(/\b(?:about|regarding|for)\s+(.+)$/i);
  return match?.[1]?.replace(/[.!?]+$/g, '').trim() ?? '';
}

function extractContactChannel(message: string): string {
  if (/\bwhatsapp\b/i.test(message)) return 'whatsapp';
  if (/\b(phone|call)\b/i.test(message)) return 'phone';
  if (/\bemail|mail\b/i.test(message)) return 'email';
  return '';
}

function inferErpActionToolCalls(message: string): NormalizedToolCall[] {
  const lookup = normalizeLookup(message);
  if (!lookup) return [];

  if ((lookup.includes('pending') && lookup.includes('approval')) || lookup === 'review approvals') {
    return [{ name: 'review_pending_approvals', args: {} }];
  }

  if (/\b(stock|stocks|inventory|availability|available)\b/i.test(message)) {
    return [{
      name: 'check_stock_levels',
      args: { item_name: extractStockItemName(message) },
    }];
  }

  const hasContactIntent = /\b(contact|call|email|message|whatsapp|reach out)\b/i.test(message);
  if (hasContactIntent) {
    const vendorName = extractVendorName(message);
    if (vendorName) {
      return [{
        name: 'contact_vendor',
        args: {
          vendor_name: vendorName,
          message: extractContactMessage(message),
          channel: extractContactChannel(message),
        },
      }];
    }
  }

  return [];
}

function inferToolCalls(message: string, poData: POData | undefined, history: HistoryMessage[]): NormalizedToolCall[] {
  const dataEntryCalls = inferDataEntryToolCalls(message, poData, history);
  if (dataEntryCalls.length > 0) return dataEntryCalls;
  return inferErpActionToolCalls(message);
}

function buildFlowContext(poData?: POData): string {
  if (poData?.activeFlow === 'DATA_ENTRY') {
    const batchNo = getBatchNo(poData);
    const lines = getNavLines(poData);
    const updatedLines = lines.filter(line => Number(line.actuaL_VALUE) > 0);
    const lineList = lines
      .map((line, index) => {
        const uom = line.dataentrY_UOM ? ` ${line.dataentrY_UOM}` : '';
        const actual = Number(line.actuaL_VALUE) > 0 ? `, actual value: ${line.actuaL_VALUE}${uom}` : '';
        return `${index + 1}. ${getLineLabel(line)} (${line.parameteR_TYPE || line.dataentrY_TYPE || 'Line item'}${actual})`;
      })
      .join('\n');

    return [
      'CURRENT DATA ENTRY STATE:',
      'Flow: DATA_ENTRY',
      `Batch Number: ${batchNo || 'Not set'}`,
      `Updated Items: ${updatedLines.map(line => `${getLineLabel(line)} (${line.actuaL_VALUE})`).join(', ') || 'None'}`,
      '',
      'AVAILABLE LINE ITEMS:',
      lineList || 'No line items available.',
      '',
      'DATA ENTRY RULES:',
      '1. If the user wants to start data entry, call start_data_entry.',
      '2. If Batch Number is not set, greet the user and show the list of available batches.',
      '3. When the user selects a batch, call set_batch_number.',
      '4. After the batch number is set, show the list of line items and ask the user to select one.',
      '5. When the user selects a line item, call check_item_exists.',
      '6. Once an item is selected, ask only for Total Units.',
      '7. When quantity is provided, call update_item_quantity.',
      '8. After updating quantity, ask: "Do you want to post the data entry?".',
      '9. If the user confirms (Yes), call post_data_entry.',
    ].join('\n');
  }

  return 'Flow: NONE. Greet the user and ask how you can help (e.g., Data Entry, Stock Check).';
}

function buildSystemPrompt(poData?: POData): string {
  return [
    SYSTEM_INSTRUCTION,
    '',
    buildFlowContext(poData),
    '',
    'CRITICAL RULES:',
    '- Use tools for every state-changing action.',
    '- NEVER output "TOOL CALL", function names, JSON, code, or internal logs.',
    '- ONLY output natural, conversational text.',
    '- Ask for exactly ONE missing field at a time.',
    '- If the user message is unclear, ask a brief clarification question instead of assuming values.',
    '- Never claim an action succeeded unless it actually did.',
    '- Never invent data.',
  ].join('\n');
}

function buildOpenAIMessages(systemPrompt: string, history: HistoryMessage[], message: string): ChatCompletionMessageParam[] {
  return [
    { role: 'developer', content: systemPrompt },
    ...history.map(msg => [
      msg.role === 'user'
        ? { role: 'user' as const, content: msg.text }
        : { role: 'assistant' as const, content: msg.text },
    ][0]),
    { role: 'user', content: message },
  ];
}

function buildOpenAITools(): ChatCompletionTool[] {
  const declarationTools = PO_TOOLS as readonly FunctionDeclarationsTool[];
  return declarationTools.flatMap(tool =>
    (tool.functionDeclarations ?? []).map(declaration => ({
      type: 'function',
      function: {
        name: declaration.name,
        description: declaration.description,
        parameters: declaration.parameters ?? { type: 'object', properties: {} },
      },
    } satisfies ChatCompletionTool)),
  );
}

function buildDataEntryResponseText(
  message: string,
  poData: POData | undefined,
  history: HistoryMessage[],
  toolCalls: NormalizedToolCall[],
  modelText: string,
): string {
  if (poData?.activeFlow !== 'DATA_ENTRY' && !toolCalls.some(c => c.name === 'start_data_entry')) return modelText;
  if (toolCalls.length > 0 && toolCalls.every(call => !DATA_ENTRY_TOOL_NAMES.has(call.name))) {
    return modelText;
  }

  const batchNo = getBatchNo(poData);
  const lines = getNavLines(poData);

  if (toolCalls.some(call => call.name === 'start_data_entry')) {
    return 'Sure, I can help with NavFarm data entry. Please select a batch from the list below.';
  }

  const postCall = toolCalls.find(call => call.name === 'post_data_entry');
  if (postCall) {
    return `Data entry for batch ${batchNo || 'the selected batch'} has been posted successfully.`;
  }

  const updateCall = [...toolCalls].reverse().find(call => call.name === 'update_item_quantity');
  if (updateCall) {
    const line = resolveLineIdentifier(updateCall.args.item_name, lines);
    const label = getLineLabel(line) || String(updateCall.args.item_name || 'the selected item');
    return `Updated ${label} actual value to ${updateCall.args.quantity}. Do you want to post the data entry?`;
  }

  const checkCall = [...toolCalls].reverse().find(call => call.name === 'check_item_exists');
  if (checkCall) {
    const line = resolveLineIdentifier(checkCall.args.item_name, lines);
    if (!line) return `I could not find ${checkCall.args.item_name}. Please select an item from the list.`;
    const uom = line.dataentrY_UOM ? ` (${line.dataentrY_UOM})` : '';
    return `How many total units for ${getLineLabel(line)}${uom}?`;
  }

  const batchCall = [...toolCalls].reverse().find(call => call.name === 'set_batch_number');
  if (batchCall) {
    return `Batch ${batchCall.args.batch_no} selected. Please select a line item to update from the list below.`;
  }

  if (!batchNo) {
    return 'Please select a batch from the list below to proceed with data entry.';
  }

  return modelText || 'Please select an item to update from the list below.';
}

export async function POST(req: Request) {
  try {
    const { message, poData, history = [] } = await req.json() as ChatRequestBody;
    const recentHistory = history.slice(-20);
    const systemPrompt = buildSystemPrompt(poData);
    const openAIMessages = buildOpenAIMessages(systemPrompt, recentHistory, message);

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY on the server.');
    }

    console.log('[Chat API] Sending request to OpenAI...', {
      flow: poData?.activeFlow,
      message: `${message.substring(0, 50)}...`,
    });

    const client = new OpenAI({
      apiKey: openAIKey,
    });

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: openAIMessages,
      tools: buildOpenAITools(),
      tool_choice: 'auto',
      temperature: 0.1,
    });

    const aiMessage = completion.choices[0]?.message;
    let rawBotText = aiMessage?.content ?? '';
    const lastBotText = getLastBotText(recentHistory);
    const isAnsweringAddAnother = poData?.activeFlow === 'DATA_ENTRY'
      && asksAddAnother(lastBotText)
      && (isAffirmative(message) || isNegative(message));
    const modelToolCalls = isAnsweringAddAnother ? [] : normalizeToolCalls(aiMessage?.tool_calls, poData);
    const inferredToolCalls = modelToolCalls.length > 0 || isAnsweringAddAnother ? [] : inferToolCalls(message, poData, recentHistory);
    const toolCalls = modelToolCalls.length > 0 ? modelToolCalls : inferredToolCalls;
    const hasInferredErpAction = modelToolCalls.length === 0
      && inferredToolCalls.some(call => ERP_ACTION_TOOL_NAMES.has(call.name));

    rawBotText = buildDataEntryResponseText(message, poData, recentHistory, toolCalls, rawBotText);
    if (hasInferredErpAction) {
      rawBotText = '';
    }

    console.log('[Chat API] OpenAI response received:', {
      textLength: rawBotText.length,
      toolCallsCount: toolCalls.length,
    });

    const fallbackText = toolCalls.length > 0
      ? `Executing ${toolCalls[0].name.replace(/_/g, ' ')}...`
      : 'I could not process that. Please try again.';

    const normalizedText = normalizeAssistantText(rawBotText || fallbackText);
    const parsedFields = poData?.activeFlow === 'DATA_ENTRY' ? {} : parseFieldsFromMessage(message, poData);

    return NextResponse.json({
      text: normalizedText,
      parsedFields,
      toolCalls,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI service unavailable. Please try again.';
    console.error('[Chat API Error]', error);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function parseFieldsFromMessage(message: string, currentPO?: POData): Record<string, string> {
  const extracted: Record<string, string> = {};
  const text = message.toLowerCase().trim();

  // Vendor: "from Bosch", "vendor Siemens", "for Tata"
  const vendorMatch = text.match(/(?:vendor[:\s]+|from[:\s]+|supplier[:\s]+)([a-zA-Z][\w\s]{1,30}?)(?:\s+(?:with|for|at|on|,|\.)|$)/i);
  if (vendorMatch && !currentPO?.vendor) {
    extracted.vendor = vendorMatch[1].trim();
  }

  // Quantity + Item: "5 laptops", "order 10 chairs"
  const qtyItemMatch = message.match(/\b(\d+)\s+([a-zA-Z][\w\s]{1,20}?)(?:\s+(?:from|for|at|delivery|,|\.)|$)/i);
  if (qtyItemMatch) {
    if (!currentPO?.quantity) extracted.quantity = qtyItemMatch[1];
    if (!currentPO?.item) extracted.item = qtyItemMatch[2].trim();
  }

  // Price: "$500", "at 500", "price 500", "500 each"
  const priceMatch = message.match(/(?:\$|price[:\s]+|at[:\s]+|for[:\s]+|rs\.?[:\s]*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|rupees?|each|per unit|usd|inr)?/i);
  if (priceMatch && (text.includes('price') || text.includes('$') || text.includes('₹') || text.includes('rs') || text.includes('each') || text.includes('per'))) {
    if (!currentPO?.price) extracted.price = priceMatch[1].replace(',', '');
  }

  // Delivery date: "tomorrow", "next Monday", "on 25th", "26 August"
  const datePatterns = [
    /\b(tomorrow|today|next\s+\w+|this\s+\w+)\b/i,
    /\b(\d{1,2}[\s\/\-]\w+[\s\/\-]?\d{0,4})\b/i,
    /\b(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?)\b/i,
  ];
  for (const pattern of datePatterns) {
    const match = message.match(pattern);
    if (match && !currentPO?.deliveryDate) {
      extracted.deliveryDate = match[1];
      break;
    }
  }

  return extracted;
}
