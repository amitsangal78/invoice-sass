// One response shape for the whole API: { data } on success, { error } on
// failure — see rules/backend-api.md. Every thrown error caught by the
// central error middleware carries a `code` and `httpStatus`; a raw
// unexpected error becomes a generic 500 with no internal detail leaked.

export class ApiHttpError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export class InvalidCredentialsError extends ApiHttpError {
  constructor() {
    // Deliberately generic — never reveal whether the email or the password was wrong.
    super(401, 'invalid_credentials', 'Invalid email or password.');
  }
}

export class AccountSuspendedError extends ApiHttpError {
  constructor() {
    super(403, 'account_suspended', 'This account is suspended.');
  }
}

export class InvalidTokenError extends ApiHttpError {
  constructor(kind: string) {
    super(400, 'invalid_token', `This ${kind} link is invalid, expired, or already used.`);
  }
}

export class NotAMemberError extends ApiHttpError {
  constructor() {
    super(403, 'not_a_member', 'You are not a member of this workspace.');
  }
}

export class WorkspaceSuspendedError extends ApiHttpError {
  constructor() {
    super(403, 'workspace_suspended', 'This workspace has been suspended.');
  }
}

export class InsufficientRoleError extends ApiHttpError {
  constructor(required: string[]) {
    super(403, 'insufficient_role', `Requires one of: ${required.join(', ')}.`);
  }
}

export class OwnerOnlyError extends ApiHttpError {
  constructor() {
    super(403, 'owner_only', 'Only the workspace owner can perform this action.');
  }
}

export class InvalidStatusTransitionError extends ApiHttpError {
  constructor(from: string, to: string) {
    super(409, 'invalid_status_transition', `Cannot move an invoice from ${from} to ${to}.`);
  }
}

export class PlanLimitExceededError extends ApiHttpError {
  constructor(action: string, plan: string) {
    super(402, 'plan_limit_exceeded', `The ${plan} plan does not allow: ${action}.`);
  }
}

export class NotImplementedError extends ApiHttpError {
  constructor(feature: string) {
    super(501, 'not_implemented', `${feature} is not implemented yet.`);
  }
}
