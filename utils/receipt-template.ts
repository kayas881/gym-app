import { RECEIPT_PREFIX } from '../constants/config';
import { formatDate } from './date';

interface ReceiptData {
  gymName: string;
  gymLogoUrl?: string | null;
  memberName: string;
  memberEmail: string;
  planName: string;
  durationMonths: number;
  amountPaid: number;
  paymentMethod: string;
  startDate: string;
  endDate: string;
  receiptNumber: string;
  paymentDate: string;
}

/**
 * Generate an HTML template for a payment receipt.
 * Used with expo-print to create a shareable PDF.
 */
export function generateReceiptHTML(data: ReceiptData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 40px;
      color: #1a1a1a;
      background: #fff;
    }
    .receipt {
      max-width: 500px;
      margin: 0 auto;
      border: 2px solid #00C853;
      border-radius: 16px;
      overflow: hidden;
    }
    .header {
      background: #0F0F0F;
      color: #fff;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      font-size: 24px;
      color: #00E676;
      margin-bottom: 4px;
    }
    .header p {
      font-size: 12px;
      color: #a0a0a0;
    }
    .receipt-number {
      background: #1a1a1a;
      color: #00E676;
      text-align: center;
      padding: 8px;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 1px;
    }
    .body {
      padding: 24px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #eee;
    }
    .row:last-child { border-bottom: none; }
    .row .label {
      color: #666;
      font-size: 13px;
    }
    .row .value {
      font-weight: 600;
      font-size: 14px;
      text-align: right;
    }
    .amount-row {
      background: #f0faf5;
      margin: 16px -24px;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .amount-row .label {
      font-size: 16px;
      font-weight: 600;
    }
    .amount-row .value {
      font-size: 24px;
      font-weight: 800;
      color: #00C853;
    }
    .footer {
      text-align: center;
      padding: 16px;
      background: #f9f9f9;
      font-size: 11px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>${escapeHtml(data.gymName)}</h1>
      <p>PAYMENT RECEIPT</p>
    </div>
    <div class="receipt-number">
      ${escapeHtml(data.receiptNumber)}
    </div>
    <div class="body">
      <div class="row">
        <span class="label">Member Name</span>
        <span class="value">${escapeHtml(data.memberName)}</span>
      </div>
      <div class="row">
        <span class="label">Email</span>
        <span class="value">${escapeHtml(data.memberEmail)}</span>
      </div>
      <div class="row">
        <span class="label">Plan</span>
        <span class="value">${escapeHtml(data.planName)} (${data.durationMonths} months)</span>
      </div>
      <div class="row">
        <span class="label">Membership Start</span>
        <span class="value">${formatDate(data.startDate)}</span>
      </div>
      <div class="row">
        <span class="label">Membership End</span>
        <span class="value">${formatDate(data.endDate)}</span>
      </div>
      <div class="row">
        <span class="label">Payment Method</span>
        <span class="value">${data.paymentMethod.toUpperCase()}</span>
      </div>
      <div class="row">
        <span class="label">Payment Date</span>
        <span class="value">${formatDate(data.paymentDate)}</span>
      </div>
      <div class="amount-row">
        <span class="label">Amount Paid</span>
        <span class="value">₹${data.amountPaid.toLocaleString('en-IN')}</span>
      </div>
    </div>
    <div class="footer">
      This is a computer-generated receipt and does not require a signature.<br>
      Generated on ${formatDate(new Date().toISOString())}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate a unique receipt number.
 * Format: GYM-YYYYMMDD-XXXX (e.g., GYM-20240315-A3B7)
 */
export function generateReceiptNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${RECEIPT_PREFIX}-${dateStr}-${random}`;
}

/**
 * Escape HTML special characters to prevent XSS in receipt template.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}
