import type { PlatformRole, WorkspaceRole } from '@invoice-saas/db';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; platformRole: PlatformRole };
      membership?: { workspaceId: string; role: WorkspaceRole };
    }
  }
}

export {};
