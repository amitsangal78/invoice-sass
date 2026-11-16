# Razorpay Test Mode and email providers

This implementation connects the customer portal to Razorpay Orders, hosted Checkout, server-side payment lookup/signature verification, signed webhooks, durable event processing, ledger allocations, receipt records/PDFs, and customer/Owner payment notifications. Refunds and live money remain disabled.

Email transports: local JSON preview, local SES emulation through LocalStack, AWS SES API, and Resend. A verified Platform Owner selects the provider in **Payment & Email Settings**. Credentials remain in server environment/AWS credential chain; the UI never returns secrets. Selection is platform-wide and applies to newly claimed jobs; retries retain the original provider to avoid sending through a second service after an ambiguous result.

## Required from the account owner

1. Razorpay **Test Mode** Key ID and Key Secret. Enter them in the private local `.env` below; do not paste secrets into chat or commit them.
2. A separate webhook signing secret and an HTTPS URL that forwards to the local API webhook route. A public development tunnel is needed for Razorpay to reach a laptop; localhost is not reachable from Razorpay.
3. For AWS SES: desired AWS region, a verified sender identity, and a local AWS profile/IAM credentials with `ses:SendEmail`. For sending to arbitrary recipients, the SES account must be out of the region's sandbox; sandbox delivery is limited to verified recipients or the SES mailbox simulator.
4. For Resend: API key, verified sending domain and sender address. Use the provider's allowed test recipient/sender restrictions until the domain is verified.
5. For local SES emulation: Docker and, if required by your LocalStack distribution, its auth token. No real AWS account credentials are used by this emulator adapter.

The code can compile and run before these credentials are supplied. Unconfigured Razorpay attempts return a setup error; they never silently fall back to simulation.

## Server configuration

Start from the existing private `.env`; preserve its working PostgreSQL URLs and OTP/encryption secrets.

```dotenv
# Only Razorpay Test Mode keys are accepted. Never use live keys here.
PAYMENT_DRIVER=razorpay
RAZORPAY_KEY_ID=rzp_test_your_id
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_separate_webhook_signing_secret

# Default transport until the administrator saves a dropdown selection:
DELIVERY_MODE=local
WEB_ORIGIN=http://localhost:3000
AWS_REGION=ap-southeast-1
SES_LOCAL_ENDPOINT=http://127.0.0.1:4566
SES_LOCAL_FROM_EMAIL=invoices@local.example

# AWS SES (requires a verified sender in AWS_REGION):
EMAIL_FROM=Invoices <invoices@your-verified-domain.example>
AWS_PROFILE=your-ses-profile
# SES_CONFIGURATION_SET=your_optional_configuration_set

# Resend:
RESEND_API_KEY=re_your_key
RESEND_FROM_EMAIL=Invoices <invoices@your-resend-verified-domain.example>
```

Omit credential lines for services you have not configured. Do not leave empty Razorpay credential assignments: omit/comment them until ready. Restart the API and worker after changing environment values. `AWS_PROFILE` is one option; the SDK also supports its normal environment/role credential chain. IAM credentials are different from SES SMTP credentials; this implementation uses the SES API, not SMTP.

```sh
nvm use
npm install
npm run db:migrate
npm run dev:all
```

Migration `004_payment_email_integrations.sql` is additive. It adds provider-attempt state, an admin-controlled transport setting, and email provider acceptance metadata. It does not reset development data.

## Razorpay Dashboard setup

1. Switch to **Test Mode**, generate/copy test API credentials into `.env`.
2. Configure automatic payment capture for your account. An authorized-but-uncaptured payment remains pending in the app and is never presented as confirmed.
3. Configure a Test Mode webhook URL:
   `https://YOUR-PUBLIC-API-HOST/api/v1/webhooks/razorpay`
4. Subscribe to `payment.captured`, `payment.authorized`, `payment.failed`, and `order.paid`. Set the independent signing secret to exactly the server's `RAZORPAY_WEBHOOK_SECRET`.
5. Ensure the forwarder preserves the raw JSON body and `X-Razorpay-Signature` / `X-Razorpay-Event-Id` headers. No staff session cookie is needed for webhooks; their authentication is the signature.
6. Keep the API, web app and worker running. Follow an issued invoice link and verify the customer's OTP. Choose Razorpay Checkout, then use Razorpay's current published test payment details.

The app creates the order on the server in INR paise. The browser receives only the public key ID and order details. Checkout callback signature is verified against the order saved by the server, followed by a server-to-server lookup of the payment. Only a provider-confirmed capture writes the payment ledger. Webhook and callback races are serialized and duplicate captures are deduplicated by provider payment ID; duplicate event delivery is also tracked.

Razorpay's documented Test Mode UPI flow differs from Live Mode UPI Intent/QR. This implementation uses Standard Checkout and the methods available to the test account. Real provider UPI QR/Intent is rejected in Test Mode with an explanation; the app does not create a fake QR and label it provider-backed. Local simulation is still available only with explicit `PAYMENT_DRIVER=simulation` outside production.

## Pending orders, failures, recovery and receipts

- A timed-out order creation is stored as UNKNOWN, not treated as an unpaid failure that can blindly create another order.
- The customer can **Check payment status** and resume the existing order. Owner API: `POST /api/v1/payment-attempts/{attempt-id}/reconcile`. Unknown orders are searched by the attempt's stable provider receipt. Multiple matches require platform review.
- Closing Checkout does not mean payment failure. The page keeps the attempt available and checks for webhook-confirmed success.
- A failed payment can be retried on the existing Razorpay order; it does not create another invoice or claim payment success.
- A verified capture creates a receipt record, queues a private receipt PDF, and sends separate customer/Owner success messages. Customer downloads the receipt within its authorized invoice session.
- Delayed captures after a blocked/cancelled vendor/invoice are still recorded; invalid/excess allocation is routed to reconciliation rather than discarding real provider evidence.
- Payment failure notifications are queued from verified provider failure evidence, not a client dismissal. A late failure does not undo a successful payment.
- Platform event replay API now actually reprocesses the persisted encrypted event instead of merely changing its status.

Capture success is different from bank settlement. Refunds are not implemented/enabled. Vendor-customizable payment-failure email variants are not introduced without an agreed definition of those variants.

## Choose an email provider

Sign in as a verified Platform Owner → **Payment & Email Settings** → **Email provider** → **Save email provider**.

- **Local file preview:** messages remain in `.local/mail`. No inbox delivery.
- **Amazon SES — local emulator:** worker calls LocalStack using the SES API and dummy local credentials. Messages are captured locally, not sent to Gmail/Outlook by this setup.
- **Amazon SES — AWS:** the local worker calls AWS SES and sends real email, subject to sender verification, credentials and sandbox restrictions.
- **Resend:** worker calls the Resend API and sends real email, subject to sender/domain and account restrictions. Retries use the same provider idempotency key.

Options missing required sender/key configuration are marked setup-required. The code cannot confirm that an AWS profile, remote identity or LocalStack process is usable merely from the dropdown; runtime failures remain visible in Job Monitoring. A saved selection is retained across restarts.

OTP, invoice-link, payment success/failure and receipt notices have text/HTML templates. Existing supported EMAIL outbox jobs use the selected transport; unrelated business events without a queued notification are not invented by this transport change.

## Run local SES

Leave the native PostgreSQL service running. Only start the mail service:

```sh
npm run mail:up
```

The `mail` compose profile starts LocalStack on loopback port 4566 and initializes the local sender identity. If LocalStack requires an auth token, configure `LOCALSTACK_AUTH_TOKEN` privately before startup. Then choose **Amazon SES — local emulator** in the dropdown. Inspect captured mail using LocalStack's UI or:

```sh
curl http://127.0.0.1:4566/_aws/ses
```

Captured messages contain OTPs and invoice links: keep that endpoint local and do not share raw output. Stop just this service with `npm run mail:down`. LocalStack SMTP forwarding is not configured; direct real inbox delivery uses AWS SES or Resend.

## Delivery status and limitations

A successful send records the provider message ID and ACCEPTED status. It does not claim DELIVERED. Automatic SES SNS / Resend delivered/bounce/complaint callbacks and suppression ingestion are not part of this first integration pass; provider delivery dashboards remain the delivery evidence. The worker honors already-recorded recipient suppressions.

Retries are bounded. Resend provides a 24-hour idempotency window; SES has no equivalent application idempotency key for this call. A process crash after SES accepts a message but before its acknowledgment is committed can cause a duplicate on retry. No cross-provider automatic fallback is used.

There is no real-provider acceptance proof until the account owner configures test keys, public webhook routing and sender identities. Compilation/focused mocked checks do not replace that step.

## Primary references

- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- https://razorpay.com/docs/webhooks/payments/
- https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html
- https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- https://docs.localstack.cloud/aws/services/ses/
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys
