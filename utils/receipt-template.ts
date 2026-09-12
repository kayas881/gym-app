import { RECEIPT_PREFIX } from '../constants/config';
import { formatDate, today } from './date';

// expo-print sizes custom pages in points (72 points per inch).
export const RECEIPT_PDF_OPTIONS = { width: 595, height: 842 } as const;

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

/** Generate an A4 HTML payment receipt for expo-print. */
export function generateReceiptHTML(data: ReceiptData): string {
  const gymName = escapeHtml(data.gymName);
  const memberName = escapeHtml(data.memberName);
  const memberEmail = escapeHtml(data.memberEmail || 'Not provided');
  const planName = escapeHtml(data.planName);
  const paymentMethod = escapeHtml(data.paymentMethod.toUpperCase());
  const receiptNumber = escapeHtml(data.receiptNumber);
  const term = `${data.durationMonths} ${data.durationMonths === 1 ? 'month' : 'months'}`;
  const amount = data.amountPaid.toLocaleString('en-IN');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 210mm; height: 297mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #171a16;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt { min-height: 297mm; display: flex; flex-direction: column; }
    .header { background: #10130f; color: #fff; padding: 20mm 18mm 15mm; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 27px; line-height: 1.1; font-weight: 800; letter-spacing: -0.6px; }
    .document-label {
      margin-top: 6px; color: #a8afa5; font-size: 10px; font-weight: 700;
      letter-spacing: 2.2px;
    }
    .receipt-meta { text-align: right; }
    .meta-label {
      color: #8f968c; font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
      text-transform: uppercase;
    }
    .receipt-number { margin-top: 5px; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; }
    .amount-block { margin-top: 20mm; }
    .amount-label {
      color: #a8afa5; font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .amount {
      margin-top: 3px; color: #b7f34a; font-size: 42px; line-height: 1;
      font-weight: 800; letter-spacing: -1.5px;
    }
    .content { flex: 1; padding: 15mm 18mm 12mm; }
    .section { margin-bottom: 12mm; }
    .section-title {
      margin-bottom: 6mm; color: #72786f; font-size: 9px; font-weight: 800;
      letter-spacing: 1.6px; text-transform: uppercase;
    }
    .person-name { font-size: 22px; line-height: 1.2; font-weight: 750; }
    .person-email { margin-top: 4px; color: #747a71; font-size: 11px; }
    .membership-card {
      padding: 8mm; border: 1px solid #dfe4dc; border-left: 4px solid #9bd632;
      border-radius: 8px; background: #f7f9f5;
    }
    .plan-row { display: flex; justify-content: space-between; align-items: baseline; }
    .plan-name { font-size: 18px; font-weight: 750; }
    .plan-term { color: #62685f; font-size: 11px; font-weight: 650; }
    .coverage { display: flex; align-items: center; margin-top: 7mm; }
    .date-block { flex: 1; }
    .date-block:last-child { text-align: right; }
    .date-label {
      color: #858b82; font-size: 8px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase;
    }
    .date-value { margin-top: 3px; font-size: 13px; font-weight: 700; }
    .date-line { flex: 1; height: 1px; margin: 0 8mm; background: #cbd1c8; position: relative; }
    .date-line:after {
      content: ''; position: absolute; right: -1px; top: -3px; width: 6px; height: 6px;
      border-top: 1px solid #9da39a; border-right: 1px solid #9da39a; transform: rotate(45deg);
    }
    .details { display: flex; gap: 8mm; }
    .detail { flex: 1; padding-top: 5mm; border-top: 1px solid #dfe4dc; }
    .detail-label {
      color: #7b8178; font-size: 8px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase;
    }
    .detail-value { margin-top: 4px; font-size: 12px; font-weight: 700; }
    .footer {
      display: flex; justify-content: space-between; align-items: flex-end; margin: 0 18mm;
      padding: 8mm 0 13mm; border-top: 1px solid #e0e4dd; color: #858b82;
      font-size: 8.5px; line-height: 1.55;
    }
    .footer-brand { color: #30352e; font-size: 10px; font-weight: 750; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="header-top">
        <div>
          <div class="brand">${gymName}</div>
          <div class="document-label">PAYMENT RECEIPT</div>
        </div>
        <div class="receipt-meta">
          <div class="meta-label">Receipt number</div>
          <div class="receipt-number">${receiptNumber}</div>
        </div>
      </div>
      <div class="amount-block">
        <div class="amount-label">Amount received</div>
        <div class="amount">&#8377;${amount}</div>
      </div>
    </div>

    <main class="content">
      <section class="section">
        <div class="section-title">Received from</div>
        <div class="person-name">${memberName}</div>
        <div class="person-email">${memberEmail}</div>
      </section>

      <section class="section">
        <div class="section-title">Membership</div>
        <div class="membership-card">
          <div class="plan-row">
            <div class="plan-name">${planName}</div>
            <div class="plan-term">${term}</div>
          </div>
          <div class="coverage">
            <div class="date-block">
              <div class="date-label">Starts</div>
              <div class="date-value">${formatDate(data.startDate)}</div>
            </div>
            <div class="date-line"></div>
            <div class="date-block">
              <div class="date-label">Ends</div>
              <div class="date-value">${formatDate(data.endDate)}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Payment details</div>
        <div class="details">
          <div class="detail">
            <div class="detail-label">Payment method</div>
            <div class="detail-value">${paymentMethod}</div>
          </div>
          <div class="detail">
            <div class="detail-label">Payment date</div>
            <div class="detail-value">${formatDate(data.paymentDate)}</div>
          </div>
        </div>
      </section>
    </main>

    <div class="footer">
      <div>
        <div class="footer-brand">${gymName}</div>
        This is a computer-generated receipt and does not require a signature.
      </div>
      <div>Generated on ${formatDate(today())}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * @deprecated Receipt numbers are generated by `record_subscription_payment`,
 * which retries on collision. Kept for reference only; nothing calls it.
 */
export function generateReceiptNumber(): string {
  const dateStr = today().replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${RECEIPT_PREFIX}-${dateStr}-${random}`;
}

/** Escape HTML special characters to prevent XSS in receipt output. */
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
