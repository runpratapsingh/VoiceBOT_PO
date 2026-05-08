import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DEFAULT_NAVFARM_SUMMARY_URL = 'https://agriapitest.navfarm.com/api/get_dataentry_summary';
const DEFAULT_SUMMARY_PARAMS = {
  Company_Id: '275',
  nature_id: '5',
  Location_Id: '1',
};

type SummaryParams = {
  Company_Id?: unknown;
  nature_id?: unknown;
  Location_Id?: unknown;
};

function getBasicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function parseUpstreamResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getNavFarmMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  return '';
}

function isNavFarmFailure(data: unknown): boolean {
  if (!data || typeof data !== 'object' || !('status' in data)) return false;
  const status = (data as { status?: unknown }).status;
  return typeof status === 'string' && status.toLowerCase() === 'failure';
}

function toParam(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function paramsFromUrl(req: Request): Required<SummaryParams> {
  const searchParams = new URL(req.url).searchParams;
  return {
    Company_Id: toParam(searchParams.get('Company_Id'), DEFAULT_SUMMARY_PARAMS.Company_Id),
    nature_id: toParam(searchParams.get('nature_id'), DEFAULT_SUMMARY_PARAMS.nature_id),
    Location_Id: toParam(searchParams.get('Location_Id'), DEFAULT_SUMMARY_PARAMS.Location_Id),
  };
}

async function paramsFromBody(req: Request): Promise<Required<SummaryParams>> {
  const payload = await req.json().catch(() => ({})) as SummaryParams;
  return {
    Company_Id: toParam(payload.Company_Id, DEFAULT_SUMMARY_PARAMS.Company_Id),
    nature_id: toParam(payload.nature_id, DEFAULT_SUMMARY_PARAMS.nature_id),
    Location_Id: toParam(payload.Location_Id, DEFAULT_SUMMARY_PARAMS.Location_Id),
  };
}

async function handleSummaryRequest(params: Required<SummaryParams>) {
  try {
    const url = process.env.NAVFARM_DATAENTRY_SUMMARY_URL || DEFAULT_NAVFARM_SUMMARY_URL;
    const username = process.env.NAVFARM_BASIC_AUTH_USERNAME;
    const password = process.env.NAVFARM_BASIC_AUTH_PASSWORD;
    const token = process.env.NAVFARM_AUTH_TOKEN;

    if (!username || !password || !token) {
      return NextResponse.json(
        { success: false, error: 'NavFarm authentication is not configured.' },
        { status: 500 },
      );
    }

    const upstreamUrl = new URL(url);
    upstreamUrl.searchParams.set('Company_Id', String(params.Company_Id));
    upstreamUrl.searchParams.set('nature_id', String(params.nature_id));
    upstreamUrl.searchParams.set('Location_Id', String(params.Location_Id));

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: getBasicAuthHeader(username, password),
        authToken: token,
      },
      cache: 'no-store',
    });

    const data = await parseUpstreamResponse(upstream);
    const navFarmMessage = getNavFarmMessage(data);

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: navFarmMessage || 'NavFarm batch summary fetch failed.',
          status: upstream.status,
          data,
        },
        { status: 502 },
      );
    }

    if (isNavFarmFailure(data)) {
      return NextResponse.json(
        {
          success: false,
          error: navFarmMessage || 'NavFarm batch summary fetch failed.',
          data,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      success: true,
      message: navFarmMessage || 'Batch summary data fetched successfully.',
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch batch summary from NavFarm.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handleSummaryRequest(paramsFromUrl(req));
}

export async function POST(req: Request) {
  return handleSummaryRequest(await paramsFromBody(req));
}
