import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * Proxies the binary PDF from the API. Can't reuse apiFetch (lib/api/server-
 * client.ts) — that's JSON-only — but reads the same httpOnly cookies it
 * does, so the access token never reaches client-side JS (architecture-
 * principles.md #1/#2). This route is the same-origin download target a
 * plain <a href> on the invoice detail page can hit directly.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value;
  const workspaceId = cookieStore.get('workspace_id')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Not signed in.' } }, { status: 401 });
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (workspaceId) headers['x-workspace-id'] = workspaceId;

  const apiRes = await fetch(`${API_BASE_URL}/invoices/${id}/pdf`, { headers, cache: 'no-store' });

  if (!apiRes.ok) {
    const json = await apiRes.json().catch(() => ({}));
    return NextResponse.json({ error: json?.error ?? { code: 'unknown_error', message: 'Request failed.' } }, { status: apiRes.status });
  }

  return new NextResponse(apiRes.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
    },
  });
}
