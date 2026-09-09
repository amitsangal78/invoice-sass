import { apiFetch } from '@/lib/api/server-client';
import { selectWorkspaceAction } from '@/features/auth';

interface WorkspaceMembership {
  workspaceId: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
}

export default async function SelectWorkspacePage() {
  const workspaces = await apiFetch<WorkspaceMembership[]>('/workspaces/mine');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Choose a workspace</h1>
      <div className="flex flex-col gap-2">
        {workspaces.map((ws) => (
          <form key={ws.workspaceId} action={selectWorkspaceAction.bind(null, ws.workspaceId)}>
            <button type="submit" className="w-full rounded-input border border-border bg-surface px-4 py-3 text-left text-sm hover:bg-background">
              <span className="font-semibold text-text-primary">{ws.name}</span>
              <span className="ml-2 text-text-muted">{ws.role}</span>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
