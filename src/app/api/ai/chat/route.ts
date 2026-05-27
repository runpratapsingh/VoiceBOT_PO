import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { PO_TOOLS, SYSTEM_INSTRUCTION } from '@/services/aiConfig';
import { loadAndAnalyzeBatch } from '@/services/navfarmAnalytics';

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
  activeFlow?: 'NONE' | 'DATA_ENTRY';
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
  'get_current_data_entry_state',
  'check_item_exists',
  'update_item_quantity',
  'remove_item_entry',
  'post_data_entry',
]);
const KNOWN_TOOL_NAMES = new Set([
  ...DATA_ENTRY_TOOL_NAMES,
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
      const batchNo = String(args.batch_no ?? args.batchNo ?? args.batch ?? '').trim();
      args.batch_no = batchNo;
      const rawBatchId = args.batch_id ?? args.batchId;
      const batchId = Number(rawBatchId);
      if (Number.isFinite(batchId) && batchId > 0) {
        args.batch_id = batchId;
      } else if (/^\d+$/.test(batchNo)) {
        args.batch_id = Number(batchNo);
      }
      if (!args.batch_no && !args.batch_id) continue;
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
    if (!batch) return [];
    const args: Record<string, unknown> = { batch_no: batch };
    if (/^\d+$/.test(batch)) args.batch_id = Number(batch);
    return [{ name: 'set_batch_number', args }];
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

function getDataEntryStep(poData: POData | undefined): string {
  if (!poData || poData.activeFlow !== 'DATA_ENTRY') return 'idle';
  const batchNo = getBatchNo(poData);
  const lines = getNavLines(poData);
  if (!batchNo) return 'awaiting_batch';
  const updatedLines = lines.filter(line => Number(line.actuaL_VALUE) > 0);
  if (updatedLines.length > 0) return 'ready_to_post';
  return 'awaiting_item_selection';
}

function buildFlowContext(poData?: POData): string {
  if (poData?.activeFlow === 'DATA_ENTRY') {
    const batchNo = getBatchNo(poData);
    const lines = getNavLines(poData);
    const updatedLines = lines.filter(line => Number(line.actuaL_VALUE) > 0);
    const currentStep = getDataEntryStep(poData);
    const lineList = lines
      .map((line, index) => {
        const uom = line.dataentrY_UOM ? ` ${line.dataentrY_UOM}` : '';
        const actual = Number(line.actuaL_VALUE) > 0 ? `, actual value: ${line.actuaL_VALUE}${uom}` : '';
        return `${index + 1}. ${getLineLabel(line)} (${line.parameteR_TYPE || line.dataentrY_TYPE || 'Line item'}${actual})`;
      })
      .join('\n');

    let stepGuidance = '';
    switch (currentStep) {
      case 'awaiting_batch':
        stepGuidance = 'CURRENT STEP: Waiting for batch selection. Show available batches and ask the user to select one.';
        break;
      case 'awaiting_item_selection':
        stepGuidance = 'CURRENT STEP: Batch is selected. Show the list of line items and ask the user to select one.';
        break;
      case 'ready_to_post':
        stepGuidance = 'CURRENT STEP: Items have been updated. Ask if the user wants to post the data entry or update more items.';
        break;
      default:
        stepGuidance = 'CURRENT STEP: Starting data entry flow.';
    }

    return [
      'CURRENT DATA ENTRY STATE:',
      'Flow: DATA_ENTRY',
      `Current Step: ${currentStep}`,
      `Batch Number: ${batchNo || 'Not set'}`,
      `Updated Items: ${updatedLines.map(line => `${getLineLabel(line)} (${line.actuaL_VALUE})`).join(', ') || 'None'}`,
      '',
      stepGuidance,
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
      '10. IMPORTANT: Do NOT restart the flow from the beginning. Continue from the current step.',
      '11. If the user asks a question, answer it first, then remind them of the current step.',
    ].join('\n');
  }

  return 'Flow: NONE. Greet the user and introduce yourself as the NavFarm AI Assistant. Tell them you can help with NavFarm data entry — selecting batches, updating line items, and posting data entries. Ask if they would like to start a data entry.';
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
    '- If user is in the middle of data entry, do NOT restart. Continue from current step.',
    '- If user asks a question during data entry, answer it first then guide back to the current step.',
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
    return `Batch ${batchCall.args.batch_no || batchCall.args.batch_id} selected. Please select a line item to update from the list below.`;
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

    // Detect if this is an analytics query (Hindi, Hinglish, or English)
    const isAnalyticsQuery = /mortality|feed|consumed|trend|temp|temperature|humidity|output|production|piglet|expense|cost|vaccin|medicine|running\s*cost|aaj|kal|yesterday|today|performance|kpi|cumulative/i.test(message);

    if (isAnalyticsQuery) {
      console.log('[Chat API] Analytics query detected:', message);

      // Extract batch ID
      let batchId = 'B00010'; // default
      const batchMatch = message.match(/\bB\d{5}\b/i) || message.match(/\bbatch\s*(\d+|B\d+)/i) || message.match(/\bB\d+\b/i);
      if (batchMatch) {
        const rawMatch = batchMatch[1] || batchMatch[0];
        batchId = rawMatch.toUpperCase();
        if (/^\d+$/.test(batchId)) {
          batchId = 'B' + batchId.padStart(5, '0');
        }
      } else if (poData?.navData?.data?.header?.[0]?.batcH_NO) {
        batchId = String(poData.navData.data.header[0].batcH_NO);
      }

      const { dateFilter, analysis } = loadAndAnalyzeBatch(batchId, message);

      if (!analysis) {
        return NextResponse.json({
          text: "No data available for requested metric.",
          toolCalls: []
        });
      }

      // We have data! Let's construct a prompt for OpenAI to generate the natural language text
      const openAIKey = process.env.OPENAI_API_KEY;
      if (!openAIKey) {
        throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY on the server.');
      }

      const client = new OpenAI({ apiKey: openAIKey });

      // Determine current data entry step if active to append the reminder
      let dataEntryGuidance = '';
      if (poData?.activeFlow === 'DATA_ENTRY') {
        const currentStep = getDataEntryStep(poData);
        const batchNo = getBatchNo(poData);
        switch (currentStep) {
          case 'awaiting_batch':
            dataEntryGuidance = 'Now, back to our data entry — please select a batch from the list below to proceed.';
            break;
          case 'awaiting_item_selection':
            dataEntryGuidance = `Now, back to our data entry for batch ${batchNo} — please select a line item from the list below to update.`;
            break;
          case 'ready_to_post':
            dataEntryGuidance = `Now, back to our data entry for batch ${batchNo} — do you want to post the data entry or update more items?`;
            break;
          default:
            dataEntryGuidance = 'Now, back to our data entry flow.';
        }
      }

      const analyticsSystemPrompt = `You are "NavFarm AI", an enterprise-grade agriculture, livestock, and poultry assistant.
Your role is to help farmers, supervisors, and managers interact with farm batch data using natural language through voice and chat.
You must work as a structured analytics assistant.

Here is the exact calculated analytics data for batch ${batchId}:
${JSON.stringify(analysis, null, 2)}

Strict Response Rules:
1. Never hallucinate. Never assume missing data.
2. Keep responses concise and highly operational (e.g. "Batch B00010 total mortality today is 16 animals. Current mortality rate is 39%. Feed consumed today is 890 KG.")
3. Never expose raw API JSON fields. Summarize them in clean natural language.
4. Support multilingual input: If the user asked in Hindi, Hinglish, or English, reply in the same style/language (English, Hindi, or Hinglish).
5. Speak in natural conversational tones suitable for voice synthesis.
6. If there is an active data entry flow, you MUST answer the question first, then add the reminder guidance verbatim at the very end of your response.

${dataEntryGuidance ? `Reminder Guidance to add at the end: "${dataEntryGuidance}"` : ''}`;

      console.log('[Chat API] Dispatching analytics request to OpenAI...');
      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'developer', content: analyticsSystemPrompt },
          ...recentHistory.map(msg => ({
            role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
            content: msg.text
          })),
          { role: 'user', content: message }
        ],
        temperature: 0.2,
      });

      const rawBotText = completion.choices[0]?.message?.content ?? '';
      const normalizedText = normalizeAssistantText(rawBotText || "I have performed the analysis.");

      return NextResponse.json({
        text: normalizedText,
        toolCalls: [],
        analytics: analysis
      });
    }

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
    const inferredToolCalls = modelToolCalls.length > 0 || isAnsweringAddAnother ? [] : inferDataEntryToolCalls(message, poData, recentHistory);
    const toolCalls = modelToolCalls.length > 0 ? modelToolCalls : inferredToolCalls;

    console.log('[Chat API] OpenAI response received:', {
      textLength: rawBotText.length,
      toolCallsCount: toolCalls.length,
    });

    const fallbackText = toolCalls.length > 0
      ? `Executing ${toolCalls[0].name.replace(/_/g, ' ')}...`
      : 'I could not process that. Please try again.';

    const normalizedText = normalizeAssistantText(rawBotText || fallbackText);

    return NextResponse.json({
      text: normalizedText,
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

