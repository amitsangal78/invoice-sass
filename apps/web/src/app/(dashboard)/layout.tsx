import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/shared/components/sidebar';
import { Topbar } from '@/shared/components/topbar';
import { apiFetch } from '@/lib/api/server-client';

interface WorkspaceMembership {
  workspaceId: string;
  name: string;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const workspaceId = cookieStore.get('workspace_id')?.value;

  if (!workspaceId) {
    redirect('/select-workspace');
  }

  // Reuses /workspaces/mine rather than a dedicated GET /workspaces/:id —
  // that endpoint doesn't exist yet; adding it is a small follow-up, not
  // a blocker for this layout.
  const workspaces = await apiFetch<WorkspaceMembership[]>('/workspaces/mine');
  const current = workspaces.find((w) => w.workspaceId === workspaceId);
  if (!current) redirect('/select-workspace');

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar workspaceName={current!.name} />
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </div>
    </div>
  );
}
