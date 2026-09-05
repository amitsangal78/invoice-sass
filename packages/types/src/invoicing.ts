import { z } from 'zod';

export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  billingAddress: z.string().max(500).optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.partial();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

// Decimal-as-string, never a JS number — money math happens via decimal.js
// server-side, never trusted as a float from the client (tech.md).
const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal amount like "1234.50"');

export const invoiceLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: decimalString,
  unitPrice: decimalString,
});

export const createInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  currency: z.string().length(3), // ISO 4217
  dueDate: z.string().date(),
  taxAmount: decimalString.optional(),
  discountAmount: decimalString.optional(),
  items: z.array(invoiceLineItemSchema).min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  currency: z.string().length(3).optional(),
  dueDate: z.string().date().optional(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const recordManualPaymentSchema = z.object({
  amount: decimalString,
});
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;
