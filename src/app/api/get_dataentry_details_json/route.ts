import { NextResponse } from 'next/server';
import { MOCK_BATCH_HISTORY } from '@/services/mockBatchHistory';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get('batch_id') || searchParams.get('batch_no') || 'B00010';

    console.log(`[Mock History API] Serving batch history details for: ${batchId}`);

    // If requesting B00010, return the exact structure
    if (batchId.trim().toUpperCase() === 'B00010') {
      return NextResponse.json(MOCK_BATCH_HISTORY);
    }

    // Support customized batch number for robustness
    const customHistory = {
      ...MOCK_BATCH_HISTORY,
      data: {
        ...MOCK_BATCH_HISTORY.data,
        header: [
          {
            ...MOCK_BATCH_HISTORY.data.header[0],
            batcH_NO: batchId.toUpperCase()
          }
        ]
      }
    };

    return NextResponse.json(customHistory);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ status: 'error', message }, { status: 500 });
  }
}
