import { NextResponse } from 'next/server';
import { SYSTEM_INSTRUCTION } from '@/services/aiConfig';

type POData = {
  vendor?: string;
  item?: string;
  quantity?: string;
  price?: string;
  deliveryDate?: string;
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

const PO_FIELDS = ['vendor', 'item', 'quantity', 'price', 'deliveryDate'] as const;

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

export async function POST(req: Request) {
  try {
    const { message, poData, history = [] } = await req.json() as ChatRequestBody;

    // Build conversation history for context (last 10 exchanges max)
    const recentHistory = history.slice(-20);
    const conversationMessages = recentHistory.map((msg: HistoryMessage) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.text,
    }));

    // Build enhanced system prompt with current PO state
    const missingFields = PO_FIELDS
      .filter(f => !poData?.[f]);

    const filledFields = PO_FIELDS
      .filter(f => poData?.[f])
      .map(f => `${f}: ${poData?.[f]}`);

    const filledFieldsText = filledFields.length > 0
      ? `Already collected: ${filledFields.join(', ')}`
      : 'No fields collected yet.';
    const missingFieldsText = missingFields.join(', ')
      || 'none - all fields complete, ask for confirmation';

    const poContext = [
      'CURRENT PO STATE:',
      filledFieldsText,
      `Missing fields (ask in order if PO is active): ${missingFieldsText}`,
    ].join('\n');

    const systemPrompt = [
      SYSTEM_INSTRUCTION,
      '',
      poContext,
      '',
      'CRITICAL RULES:',
      '- NEVER output "TOOL CALL", function names, JSON, code, or internal logs.',
      '- ONLY output natural, conversational text.',
      '- If a PO field value is extracted, acknowledge it naturally (e.g., "Got it, vendor is Bosch.")',
      '- Ask for exactly ONE missing field at a time.',
      '- If the user message is unclear, ask a brief clarification question instead of assuming values.',
      '- Never claim a PO was created unless the backend action actually succeeded.',
      '- Never invent pricing, quantities, vendors, or delivery dates.',
      '- If all fields are filled, show a clean summary and ask for confirmation.',
    ].join('\n');

    const pioneerResponse = await fetch('https://api.pioneer.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PIPECAT_API_KEY}`
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: message }
        ],
        temperature: 0.2
      })
    });

    const responseData = await pioneerResponse.json();
    const rawBotText = responseData.choices?.[0]?.message?.content ?? 'I could not process that. Please try again.';
    const botText = normalizeAssistantText(rawBotText);

    // Parse any PO fields from the user message (frontend fallback parser)
    const parsedFields = parseFieldsFromMessage(message, poData);

    return NextResponse.json({ text: botText, parsedFields });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI service unavailable. Please try again.';
    console.error('[Chat API Error]', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// ── Lightweight field extractor (runs on server to reduce client weight) ──

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
