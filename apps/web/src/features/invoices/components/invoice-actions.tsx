'use client';

import { useActionState, useTransition } from 'react';
import { sendInvoiceAction, markPaidAction, cancelInvoiceAction } from '../api/invoices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InvoiceStatus } from '@/lib/invoicing/status';

// Client island for the interactive bits only — the invoice detail page
// itself stays a Server Component (architecture-principles.md #1).
export function InvoiceActions({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const [isSending, startSendTransition] = useTransition();
  const [isCancelling, startCancelTransition] = useTransition();
  const boundMarkPaid = markPaidAction.bind(null, invoiceId);
  const [markPaidState, markPaidFormAction, isMarkingPaid] = useActionState(boundMarkPaid, {});

  const canSend = status === 'DRAFT';
  const canMarkPaid = status === 'SENT' || status === 'OVERDUE' || status === 'PARTIALLY_PAID';
  const canCancel = status === 'DRAFT' || status === 'SENT';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {canSend ? (
          <Button disabled={isSending} onClick={() => startSendTransition(() => sendInvoiceAction(invoiceId))}>
            {isSending ? 'Sending…' : 'Send invoice'}
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="secondary" disabled={isCancelling} onClick={() => startCancelTransition(() => cancelInvoiceAction(invoiceId))}>
            {isCancelling ? 'Cancelling…' : 'Cancel invoice'}
          </Button>
        ) : null}
      </div>

      {canMarkPaid ? (
        <form action={markPaidFormAction} className="flex items-end gap-2">
          <div>
            <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-text-primary">
              Record payment
            </label>
            <Input id="amount" name="amount" placeholder="0.00" className="w-32" required />
          </div>
          <Button type="submit" variant="secondary" disabled={isMarkingPaid}>
            {isMarkingPaid ? 'Recording…' : 'Mark paid'}
          </Button>
          {markPaidState.error ? <p className="text-sm text-danger">{markPaidState.error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
