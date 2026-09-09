import { NextResponse, type NextRequest } from 'next/server';

// Presence-only check — the real authorization happens server-side on every
// API call via resolveWorkspace/requireRole (identity-and-rbac). This is
// just UX: don't render a dashboard shell for someone with no session at all.
// A stale/expired cookie still results in a 401 from apiFetch(), handled at
// the page level (not implemented as a silent refresh in this pass).
export function middleware(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;

  if (!accessToken) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/clients/:path*', '/invoices/:path*', '/select-workspace'],
};
