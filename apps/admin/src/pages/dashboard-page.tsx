import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface WorkspaceRow {
  id: string;
  name: string;
  isSuspended: boolean;
  createdAt: string;
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.platformRole === 'SUPER_ADMIN';

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['admin', 'workspaces'],
    queryFn: () => apiFetch<WorkspaceRow[]>('/admin/workspaces'),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/workspaces/${id}/suspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/workspaces/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-16 items-center justify-between border-b border-border bg-surface px-8">
        <span className="text-sm font-semibold text-text-primary">Billify Admin</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-secondary">
            {user?.email} · {user?.platformRole}
          </span>
          <button onClick={logout} className="text-sm font-medium text-text-secondary hover:text-text-primary">
            Log out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl p-8">
        <h1 className="mb-1 text-2xl font-bold text-text-primary">Workspaces</h1>
        <p className="mb-6 text-sm text-text-secondary">
          {isSuperAdmin ? 'Full platform access.' : 'Support access — view only, cannot suspend/reactivate.'}
        </p>

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                  {isSuperAdmin ? <th className="px-5 py-3">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {workspaces?.map((ws) => (
                  <tr key={ws.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-semibold text-text-primary">{ws.name}</td>
                    <td className="px-5 py-3">
                      {ws.isSuspended ? (
                        <Badge label="Suspended" bg="#FEE2E2" text="#DC2626" dot="#DC2626" />
                      ) : (
                        <Badge label="Active" bg="#DCFCE7" text="#16A34A" dot="#16A34A" />
                      )}
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{new Date(ws.createdAt).toLocaleDateString()}</td>
                    {isSuperAdmin ? (
                      <td className="px-5 py-3">
                        {ws.isSuspended ? (
                          <Button size="sm" variant="secondary" disabled={reactivateMutation.isPending} onClick={() => reactivateMutation.mutate(ws.id)}>
                            Reactivate
                          </Button>
                        ) : (
                          <Button size="sm" variant="danger" disabled={suspendMutation.isPending} onClick={() => suspendMutation.mutate(ws.id)}>
                            Suspend
                          </Button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
