import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DEFAULT_NAVFARM_DETAILS_URL = 'https://poultryapitest.navfarm.com/api/get_dataentry_details';
const DEFAULT_COMPANY_ID = '275';

type DetailsParams = {
  Company_Id?: unknown;
  batch_id?: unknown;
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

function getDetailsStats(data: unknown) {
  const payload = data as {
    data?: {
      header?: Array<Record<string, unknown>>;
      line?: Array<Record<string, unknown>>;
    };
  };
  const header = payload.data?.header ?? [];
  const line = payload.data?.line ?? [];

  return {
    batchNo: header[0]?.batcH_NO ?? null,
    lineCount: line.length,
    firstLine: line[0]?.iteM_NAME || line[0]?.parameteR_NAME || null,
  };
}

function toParam(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function paramsFromUrl(req: Request): Required<DetailsParams> {
  const searchParams = new URL(req.url).searchParams;
  return {
    Company_Id: toParam(searchParams.get('Company_Id'), DEFAULT_COMPANY_ID),
    batch_id: toParam(searchParams.get('batch_id')),
  };
}

async function paramsFromBody(req: Request): Promise<Required<DetailsParams>> {
  const payload = await req.json().catch(() => ({})) as DetailsParams;
  return {
    Company_Id: toParam(payload.Company_Id, DEFAULT_COMPANY_ID),
    batch_id: toParam(payload.batch_id),
  };
}

async function handleDetailsRequest(params: Required<DetailsParams>) {
  try {
    if (!params.batch_id) {
      return NextResponse.json(
        { success: false, error: 'batch_id is required.' },
        { status: 400 },
      );
    }

    const url = process.env.NAVFARM_DATAENTRY_DETAILS_URL || DEFAULT_NAVFARM_DETAILS_URL;
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
    upstreamUrl.searchParams.set('Company_Id', String(DEFAULT_COMPANY_ID));
    upstreamUrl.searchParams.set('batch_id', String(params.batch_id));

    console.log('[NavFarm Details API] Fetching upstream data entry details', {
      url,
      params: {
        Company_Id: String(params.Company_Id),
        batch_id: String(params.batch_id),
      },
    });

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
    console.log('[NavFarm Details API] Upstream response received', {
      ok: upstream.ok,
      status: upstream.status,
      message: navFarmMessage,
      ...getDetailsStats(data),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: navFarmMessage || 'NavFarm data entry details fetch failed.',
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
          error: navFarmMessage || 'NavFarm data entry details fetch failed.',
          data,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: navFarmMessage || 'Data entry details fetched successfully.',
        data,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch data entry details from NavFarm.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handleDetailsRequest(paramsFromUrl(req));
}

export async function POST(req: Request) {
  return handleDetailsRequest(await paramsFromBody(req));
}
