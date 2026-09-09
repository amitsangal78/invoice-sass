import { logoutAction } from '@/features/auth';

export function Topbar({ workspaceName }: { workspaceName: string }) {
  return (
    <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-8">
      <span className="text-sm font-semibold text-text-primary">{workspaceName}</span>
      <form action={logoutAction}>
        <button type="submit" className="text-sm font-medium text-text-secondary hover:text-text-primary">
          Log out
        </button>
      </form>
    </div>
  );
}
