import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DEFAULT_NAVFARM_INSERT_URL = 'https://agriapitest.navfarm.com/api/insert_dataentry';

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

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const url = process.env.NAVFARM_INSERT_DATAENTRY_URL || DEFAULT_NAVFARM_INSERT_URL;
    const username = process.env.NAVFARM_BASIC_AUTH_USERNAME;
    const password = process.env.NAVFARM_BASIC_AUTH_PASSWORD;
    const token = process.env.NAVFARM_AUTH_TOKEN;

    if (!username || !password || !token) {
      return NextResponse.json(
        { success: false, error: 'NavFarm authentication is not configured.' },
        { status: 500 },
      );
    }

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: getBasicAuthHeader(username, password),
        authToken: token,
      },
      body: JSON.stringify(payload),
    });

    const data = await parseUpstreamResponse(upstream);
    const navFarmMessage = getNavFarmMessage(data);

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: navFarmMessage || 'NavFarm data entry post failed.',
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
          error: navFarmMessage || 'NavFarm data entry post failed.',
          data,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      success: true,
      message: navFarmMessage || 'Data entry posted to NavFarm successfully.',
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to post data entry to NavFarm.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
