import type { PlatformRole, WorkspaceRole } from '@invoice-saas/db';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; platformRole: PlatformRole };
      membership?: { workspaceId: string; role: WorkspaceRole };
      // Portal principal (client/USER) — a different auth chain entirely
      // from the tenant `user`/`membership` above; never mixed
      // (client-portal/design.md).
      portalEmail?: string;
      portalClientId?: string;
    }
  }
}

export {};
