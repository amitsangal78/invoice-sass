#!/bin/sh
set -eu
awslocal ses verify-email-identity --email-address "${SES_LOCAL_FROM_EMAIL:-invoices@local.example}" --region "${AWS_DEFAULT_REGION:-ap-southeast-1}"
