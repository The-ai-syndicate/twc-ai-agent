// Appointment confirmation email template. Plain text + a simple HTML mirror.
// Kept dependency-free so it can be rendered on the server without a template
// engine. The reference is the client's unique booking id — call it out clearly.

export type AppointmentEmailInput = {
  reference: string;
  startsAt: string; // ISO
  siteName?: string;
  siteTown?: string;
  sitePhone?: string;
  serviceName?: string;
};

export type EmailTemplate = { subject: string; text: string; html: string };

export function appointmentEmail(input: AppointmentEmailInput): EmailTemplate {
  const { reference, startsAt, siteName, siteTown, sitePhone, serviceName } = input;

  const when = formatWhen(startsAt);
  const where = [siteName, siteTown].filter(Boolean).join(', ') || 'your selected centre';
  const service = serviceName ?? 'your appointment';

  const subject = `Your TWC appointment is booked — ${when}`;

  const lines = [
    'Your appointment is confirmed.',
    '',
    `Reference: ${reference}`,
    `Service:   ${service}`,
    `When:      ${when}`,
    `Where:     ${where}`,
  ];
  if (sitePhone) lines.push(`Centre tel: ${sitePhone}`);
  lines.push(
    '',
    'Keep your reference safe — you can use it to change or cancel your booking.',
    'Please arrive 10 minutes early and bring any relevant documents.',
    '',
    'TWC Assistant',
  );
  const text = lines.join('\n');

  const rows = [
    ['Reference', reference],
    ['Service', service],
    ['When', when],
    ['Where', where],
    ...(sitePhone ? [['Centre tel', sitePhone] as [string, string]] : []),
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#71717a">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;color:#18181b;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const html = `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px">
  <h2 style="color:#db5f2e;margin:0 0 12px">Your appointment is confirmed</h2>
  <table style="border-collapse:collapse;font-size:14px">${rows}</table>
  <p style="color:#52525b;font-size:14px;line-height:1.5">
    Keep your reference safe — you can use it to change or cancel your booking.
    Please arrive 10 minutes early and bring any relevant documents.
  </p>
  <p style="color:#a1a1aa;font-size:12px">TWC Assistant</p>
</div>`;

  return { subject, text, html };
}

// Human-readable date/time in the Botswana timezone (CAT), independent of the
// server's locale so emails read consistently.
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Gaborone',
  }).format(d);
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
