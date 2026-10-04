const PUBLIC_BASE = process.env.API_URL || 'https://api.pharmasys.co.ke';
const LOGO_URL = `${PUBLIC_BASE}/brand/logo.svg`;

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function money(amount, currency = 'KES') {
  const n = Number(amount || 0);
  return `${currency} ${n.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function humanDate(d, opts = {}) {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleString('en-KE', {
    dateStyle: opts.dateStyle || 'medium',
    timeStyle: opts.timeStyle || 'short',
    timeZone: 'Africa/Nairobi',
  });
}

function normalizeBrand(brand = {}) {
  return {
    name: brand.name || 'PharmaSys',
    logoUrl: brand.logoUrl || LOGO_URL,
    color: brand.color || '#0F172A',
    accent: brand.accent || '#0EA5A4',
    supportEmail: brand.supportEmail || 'support@pharmasys.co.ke',
    supportPhone: brand.supportPhone || '',
    supportWhatsapp: brand.supportWhatsapp || '',
    website: brand.website || '',
    address: brand.address || '',
  };
}

function button(url, label, color) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px 0;">
      <tr>
        <td>
          <a href="${url}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:10px;line-height:1;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function layout(brand, { title, preheader = '', body, cta }) {
  const b = normalizeBrand(brand);

  const supportRow = [];
  if (b.supportEmail) {
    supportRow.push(`<a href="mailto:${b.supportEmail}" style="color:${b.accent};text-decoration:none;">${escapeHtml(b.supportEmail)}</a>`);
  }
  if (b.supportPhone) {
    supportRow.push(`<a href="tel:${b.supportPhone.replace(/\s+/g, '')}" style="color:${b.accent};text-decoration:none;">${escapeHtml(b.supportPhone)}</a>`);
  }
  if (b.supportWhatsapp) {
    supportRow.push(`<a href="https://wa.me/${b.supportWhatsapp.replace(/\D/g, '')}" style="color:${b.accent};text-decoration:none;">WhatsApp</a>`);
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(preheader)}</span>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06);">

        <tr>
          <td style="background:${b.color};padding:28px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td>
                  <img src="${b.logoUrl}" alt="${escapeHtml(b.name)}" width="48" height="48" style="display:block;border-radius:24px;">
                </td>
                <td align="right">
                  <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(b.name)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:36px 32px 8px 32px;">
            <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
              ${escapeHtml(title)}
            </h1>
            <div style="font-size:15px;line-height:1.65;color:#334155;">
              ${body}
            </div>
          </td>
        </tr>

        ${cta ? `
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            ${button(cta.url, cta.label, b.accent)}
          </td>
        </tr>` : ''}

        <tr>
          <td style="padding:0 32px;">
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 0 0;">
          </td>
        </tr>

        <tr>
          <td style="padding:24px 32px 32px 32px;">
            <p style="margin:0 0 12px 0;font-size:13px;font-weight:600;color:#0f172a;">Need help?</p>
            <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
              ${supportRow.join(' · ') || 'Contact our support team.'}
            </p>
            ${b.address ? `<p style="margin:0 0 16px 0;font-size:12px;color:#94a3b8;">${escapeHtml(b.address)}</p>` : '<p style="margin:0 0 16px 0;"></p>'}
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              © ${new Date().getFullYear()} ${escapeHtml(b.name)}. All rights reserved.
            </p>
          </td>
        </tr>

      </table>

      <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">
        This is a transactional email. Please do not reply directly.
      </p>
    </td>
  </tr>
</table>

</body>
</html>`;
}

function cta(url, label) {
  return { url, label };
}

function plain(lines) {
  return lines.filter(Boolean).join('\n');
}

function supportLine(brand) {
  const b = normalizeBrand(brand);
  return plain([
    'Need help?',
    b.supportEmail ? `Email: ${b.supportEmail}` : '',
    b.supportPhone ? `Phone: ${b.supportPhone}` : '',
    b.supportWhatsapp ? `WhatsApp: https://wa.me/${b.supportWhatsapp.replace(/\D/g, '')}` : '',
  ]);
}

function methodLabel(code) {
  if (!code) return null;
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function kv(label, value, opts = {}) {
  return `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#64748b;">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;font-size:14px;font-weight:${opts.bold ? 600 : 500};color:${opts.color || '#0f172a'};${opts.mono ? 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;' : ''}">
        ${value}
      </td>
    </tr>`;
}

function cardBox(inner, color = '#f8fafc', border = '#e2e8f0') {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${color};border:1px solid ${border};border-radius:12px;margin:20px 0;">
      <tr><td style="padding:18px 20px;">
        ${inner}
      </td></tr>
    </table>`;
}

/* ═══════════════════════════════════════════════════════
   AUTH & ACCOUNT
   ═══════════════════════════════════════════════════════ */

const verification = ({ brand, name, verifyUrl, expiresIn = '24 hours' }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Verify your ${b.name} account`,
    html: layout(b, {
      title: 'Verify your email',
      preheader: `Confirm your ${b.name} account`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(name)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Thanks for signing up. Click the button below to verify your email address and activate your account.</p>
        <p style="margin:0;color:#64748b;font-size:13px;">This link expires in ${escapeHtml(expiresIn)}.</p>
      `,
      cta: cta(verifyUrl, 'Verify email'),
    }),
    text: plain([
      `Hi ${name},`,
      '',
      `Verify your ${b.name} account:`,
      verifyUrl,
      '',
      `Link expires in ${expiresIn}.`,
      '',
      supportLine(b),
    ]),
  };
};

const passwordReset = ({ brand, fullName, resetUrl, expiresIn = '1 hour' }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Reset your ${b.name} password`,
    html: layout(b, {
      title: 'Reset your password',
      preheader: 'Password reset requested',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">We received a request to reset your password. Click the button below to set a new one.</p>
        <p style="margin:0;color:#64748b;font-size:13px;">This link expires in ${escapeHtml(expiresIn)}. If you didn't request this, you can safely ignore this email.</p>
      `,
      cta: cta(resetUrl, 'Reset password'),
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      `Reset your password: ${resetUrl}`,
      `Link expires in ${expiresIn}.`,
      '',
      "If you didn't request this, ignore this email.",
      '',
      supportLine(b),
    ]),
  };
};

const passwordChanged = ({ brand, fullName, when, ip }) => {
  const b = normalizeBrand(brand);
  return {
    subject: 'Your password was changed',
    html: layout(b, {
      title: 'Password changed',
      preheader: 'Your password was updated',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Your ${escapeHtml(b.name)} password was changed successfully.</p>
        ${cardBox(kv('When', escapeHtml(humanDate(when))) + (ip ? kv('IP', escapeHtml(ip), { mono: true }) : ''))}
        <p style="margin:0;color:#64748b;font-size:13px;">If this wasn't you, contact support immediately.</p>
      `,
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      'Your password was changed.',
      `When: ${humanDate(when)}`,
      ip ? `IP: ${ip}` : '',
      '',
      "If this wasn't you, contact support.",
      '',
      supportLine(b),
    ]),
  };
};

const welcome = ({ brand, name, businessName, email, temporaryPassword, loginUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Welcome to ${b.name} — ${businessName}`,
    html: layout(b, {
      title: `Welcome to ${b.name}`,
      preheader: `${businessName} is ready`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(name)}</strong>,</p>
        <p style="margin:0 0 16px 0;"><strong>${escapeHtml(businessName)}</strong> has been approved and is ready to use.</p>
        ${email ? cardBox(
          kv('Email', escapeHtml(email), { bold: true }) +
          (temporaryPassword ? kv('Temporary password', escapeHtml(temporaryPassword), { bold: true, mono: true }) : '')
        ) : ''}
        <p style="margin:0;">Log in to set up your branches, add drugs, and start selling.</p>
      `,
      cta: cta(loginUrl, 'Open dashboard'),
    }),
    text: plain([
      `Hi ${name},`,
      '',
      `${businessName} is ready.`,
      email ? `Email: ${email}` : '',
      temporaryPassword ? `Temporary password: ${temporaryPassword}` : '',
      '',
      `Log in: ${loginUrl}`,
      '',
      supportLine(b),
    ]),
  };
};

const staffWelcome = ({ brand, fullName, businessName, email, temporaryPassword, role, loginUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `You've been added to ${businessName}`,
    html: layout(b, {
      title: `Welcome to ${businessName}`,
      preheader: `Your ${role} account is ready`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0 0 16px 0;">${escapeHtml(businessName)} has added you as <strong>${escapeHtml(role)}</strong> on ${escapeHtml(b.name)}.</p>
        ${cardBox(
          kv('Email', escapeHtml(email), { bold: true }) +
          kv('Temporary password', escapeHtml(temporaryPassword), { bold: true, mono: true })
        )}
        <p style="margin:0;color:#64748b;font-size:13px;">You'll be asked to change your password on first login.</p>
      `,
      cta: cta(loginUrl, 'Log in'),
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      `${businessName} added you as ${role}.`,
      `Email: ${email}`,
      `Temporary password: ${temporaryPassword}`,
      '',
      `Log in: ${loginUrl}`,
      '',
      supportLine(b),
    ]),
  };
};

const staffDeactivated = ({ brand, fullName, businessName }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Your access to ${businessName} was removed`,
    html: layout(b, {
      title: 'Account deactivated',
      preheader: 'Your access has been removed',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0;">Your access to <strong>${escapeHtml(businessName)}</strong> on ${escapeHtml(b.name)} has been removed.</p>
      `,
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      `Your access to ${businessName} has been removed.`,
      '',
      supportLine(b),
    ]),
  };
};

const roleChanged = ({ brand, fullName, businessName, oldRole, newRole }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Your role at ${businessName} changed`,
    html: layout(b, {
      title: 'Role updated',
      preheader: `You are now ${newRole}`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0 0 16px 0;">Your role at <strong>${escapeHtml(businessName)}</strong> has been updated.</p>
        ${cardBox(
          kv('Previous role', escapeHtml(oldRole)) +
          kv('New role', escapeHtml(newRole), { bold: true, color: b.accent })
        )}
      `,
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      `Your role at ${businessName} changed: ${oldRole} → ${newRole}`,
      '',
      supportLine(b),
    ]),
  };
};

/* ═══════════════════════════════════════════════════════
   REGISTRATION & APPROVAL
   ═══════════════════════════════════════════════════════ */

const registrationReceived = ({ brand, name, businessName, planName, amount, currency, dueDate, invoiceNumber, paymentLink }) => {
  const b = normalizeBrand(brand);
  const hasPayment = Number(amount) > 0;
  return {
    subject: `We received your registration — ${businessName}`,
    html: layout(b, {
      title: 'Registration received',
      preheader: `Thanks for registering ${businessName}`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(name)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Thank you for registering <strong>${escapeHtml(businessName)}</strong> on ${escapeHtml(b.name)}.</p>
        <p style="margin:0 0 8px 0;">Your registration is now with our team for review. We'll notify you once it's approved — usually within a few hours.</p>
        ${hasPayment ? cardBox(`
          <p style="margin:0 0 10px 0;font-size:13px;font-weight:600;color:#0f172a;">Action required</p>
          <p style="margin:0 0 12px 0;font-size:14px;color:#334155;">Pay <strong>${escapeHtml(money(amount, currency))}</strong> for the <strong>${escapeHtml(planName)}</strong> plan to secure your account.</p>
          ${kv('Invoice', escapeHtml(invoiceNumber), { mono: true, bold: true })}
          ${kv('Pay before', escapeHtml(dueDate), { bold: true })}
        `, '#fffbeb', '#fde68a') : ''}
        ${hasPayment ? '<p style="margin:0;color:#64748b;font-size:13px;">If payment is not received within this window, your registration may be cancelled.</p>' : ''}
      `,
      cta: paymentLink ? cta(paymentLink, 'Pay invoice') : null,
    }),
    text: plain([
      `Hi ${name},`,
      '',
      `Thank you for registering ${businessName} on ${b.name}.`,
      'Your registration is with our team for review.',
      hasPayment ? `Pay ${money(amount, currency)} for ${planName}.` : '',
      hasPayment ? `Invoice: ${invoiceNumber}` : '',
      hasPayment ? `Pay before: ${dueDate}` : '',
      paymentLink || '',
      '',
      supportLine(b),
    ]),
  };
};

const registrationRejected = ({ brand, name, businessName, reason }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Your ${b.name} registration was not approved`,
    html: layout(b, {
      title: 'Registration not approved',
      preheader: 'Your registration status',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(name)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Registration for <strong>${escapeHtml(businessName)}</strong> was not approved.</p>
        ${reason ? cardBox(kv('Reason', escapeHtml(reason), { bold: true }), '#fef2f2', '#fecaca') : ''}
        <p style="margin:0;">If you believe this is a mistake, contact support.</p>
      `,
    }),
    text: plain([
      `Hi ${name},`,
      '',
      `Registration for ${businessName} was not approved.`,
      reason ? `Reason: ${reason}` : '',
      '',
      supportLine(b),
    ]),
  };
};

/* ═══════════════════════════════════════════════════════
   BILLING & SUBSCRIPTION
   ═══════════════════════════════════════════════════════ */

const invoice = ({
  brand, businessName, customerName, invoiceNumber,
  items, subtotal, discount, tax, total, amountDue,
  currency, dueDate, issuedAt, notes, instructions, payUrl, businessContact,
}) => {
  const b = normalizeBrand(brand);
  const fmt = (n) => money(n, currency);

  const itemsHtml = (items || []).map((item, i) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#334155;">
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(item.name)}</div>
        ${item.description ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px;">${escapeHtml(item.description)}</div>` : ''}
      </td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#334155;">${item.qty}</td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#334155;">${fmt(item.unitPrice)}</td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#0f172a;">${fmt(item.subtotal)}</td>
    </tr>
  `).join('');

  const instructionsHtml = (instructions && instructions.length) ? `
    <div style="margin:24px 0 0 0;padding:18px 20px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;color:#0f766e;letter-spacing:1px;text-transform:uppercase;">How to pay</p>
      ${instructions.map((method, i) => `
        <div style="margin-bottom:${i < instructions.length - 1 ? '18px' : '0'};">
          <p style="margin:0 0 6px 0;font-size:14px;font-weight:600;color:#0f766e;">${escapeHtml(method.title)}</p>
          ${method.description ? `<p style="margin:0 0 8px 0;font-size:12px;color:#134e4a;">${escapeHtml(method.description)}</p>` : ''}
          ${method.steps?.length ? `<ol style="margin:0;padding-left:18px;font-size:13px;color:#134e4a;line-height:1.8;">${method.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
        </div>
      `).join('')}
    </div>` : '';

  return {
    subject: `Invoice ${invoiceNumber} from ${businessName}`,
    html: layout(b, {
      title: `Invoice ${invoiceNumber}`,
      preheader: `Amount due ${fmt(amountDue ?? total)}`,
      body: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td style="vertical-align:top;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Billed to</p>
              <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(customerName)}</p>
            </td>
            <td align="right" style="vertical-align:top;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Details</p>
              <p style="margin:0;font-size:13px;color:#334155;">Issued: ${escapeHtml(humanDate(issuedAt, { timeStyle: undefined }))}</p>
              ${dueDate ? `<p style="margin:0;font-size:13px;color:#334155;">Due: ${escapeHtml(humanDate(dueDate, { timeStyle: undefined }))}</p>` : ''}
            </td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:collapse;">
          <thead>
            <tr>
              <th align="left" style="padding:8px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e2e8f0;">Item</th>
              <th align="right" style="padding:8px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e2e8f0;">Qty</th>
              <th align="right" style="padding:8px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e2e8f0;">Unit</th>
              <th align="right" style="padding:8px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #e2e8f0;">Amount</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
          ${kv('Subtotal', fmt(subtotal))}
          ${discount > 0 ? kv('Discount', `-${fmt(discount)}`) : ''}
          ${tax > 0 ? kv('Tax', fmt(tax)) : ''}
          ${kv('Total', fmt(total), { bold: true, color: '#0f172a' })}
          ${amountDue !== undefined ? kv('Amount due', fmt(amountDue), { bold: true, color: b.accent }) : ''}
        </table>

        ${notes ? cardBox(`<p style="margin:0;font-size:13px;color:#334155;">${escapeHtml(notes)}</p>`, '#eff6ff', '#bfdbfe') : ''}
        ${instructionsHtml}
      `,
      cta: payUrl ? cta(payUrl, 'Pay invoice') : null,
    }),
    text: plain([
      `INVOICE ${invoiceNumber}`,
      `From: ${businessName}`,
      `To: ${customerName}`,
      '',
      ...(items || []).map((i) => `- ${i.name} x${i.qty} @ ${fmt(i.unitPrice)} = ${fmt(i.subtotal)}`),
      '',
      `Subtotal: ${fmt(subtotal)}`,
      discount > 0 ? `Discount: -${fmt(discount)}` : '',
      tax > 0 ? `Tax: ${fmt(tax)}` : '',
      `Total: ${fmt(total)}`,
      amountDue !== undefined ? `Amount due: ${fmt(amountDue)}` : '',
      dueDate ? `Due: ${humanDate(dueDate, { timeStyle: undefined })}` : '',
      notes || '',
      payUrl ? `Pay: ${payUrl}` : '',
      '',
      supportLine(b),
    ]),
  };
};

const paymentReceived = ({
  brand, businessName, customerName, invoiceNumber,
  amount, currency, paidAt, paymentMethod, paymentReference, notes,
}) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Payment received — ${invoiceNumber}`,
    html: layout(b, {
      title: 'Payment received',
      preheader: `We received ${money(amount, currency)}`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(customerName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">We've confirmed your payment for <strong>${escapeHtml(invoiceNumber)}</strong>. Thank you!</p>
        ${cardBox(`
          <p style="margin:0 0 4px 0;font-size:12px;color:#166534;">Amount</p>
          <p style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#14532d;">${escapeHtml(money(amount, currency))}</p>
          ${paymentMethod ? kv('Method', escapeHtml(methodLabel(paymentMethod))) : ''}
          ${paymentReference ? kv('Reference', escapeHtml(paymentReference), { mono: true }) : ''}
          ${kv('Date', escapeHtml(humanDate(paidAt)))}
        `, '#f0fdf4', '#bbf7d0')}
        <p style="margin:0;">We'll keep you posted on the next steps.</p>
      `,
    }),
    text: plain([
      `Hi ${customerName},`,
      '',
      `Payment for ${invoiceNumber} received.`,
      `Amount: ${money(amount, currency)}`,
      paymentMethod ? `Method: ${methodLabel(paymentMethod)}` : '',
      paymentReference ? `Reference: ${paymentReference}` : '',
      `Date: ${humanDate(paidAt)}`,
      '',
      supportLine(b),
    ]),
  };
};

const invoiceReminder = ({ brand, businessName, customerName, invoiceNumber, total, currency, dueDate, daysOverdue, paymentLink }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Reminder: Invoice ${invoiceNumber} is unpaid`,
    html: layout(b, {
      title: 'Friendly reminder',
      preheader: `Invoice ${invoiceNumber} awaiting payment`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(customerName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Invoice <strong>${escapeHtml(invoiceNumber)}</strong> from ${escapeHtml(businessName)} is still unpaid.</p>
        ${cardBox(`
          ${kv('Amount due', escapeHtml(money(total, currency)), { bold: true, color: '#92400e' })}
          ${dueDate ? kv('Due', escapeHtml(humanDate(dueDate, { timeStyle: undefined }))) : ''}
          ${daysOverdue ? kv('Overdue', `${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`) : ''}
        `, '#fffbeb', '#fde68a')}
      `,
      cta: paymentLink ? cta(paymentLink, 'Pay now') : null,
    }),
    text: plain([
      `Invoice ${invoiceNumber} is unpaid.`,
      `Amount: ${money(total, currency)}`,
      dueDate ? `Due: ${humanDate(dueDate, { timeStyle: undefined })}` : '',
      paymentLink || '',
      '',
      supportLine(b),
    ]),
  };
};

const invoiceOverdue = ({ brand, businessName, customerName, invoiceNumber, total, currency, daysOverdue, paymentLink }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Overdue: Invoice ${invoiceNumber} — ${daysOverdue} days`,
    html: layout(b, {
      title: 'Invoice overdue',
      preheader: `Invoice is overdue by ${daysOverdue} days`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(customerName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Invoice <strong>${escapeHtml(invoiceNumber)}</strong> from ${escapeHtml(businessName)} is now <strong>${escapeHtml(String(daysOverdue))}</strong> days overdue.</p>
        ${cardBox(kv('Amount due', escapeHtml(money(total, currency)), { bold: true, color: '#7f1d1d' }), '#fef2f2', '#fecaca')}
        <p style="margin:0;">Please settle this as soon as possible.</p>
      `,
      cta: paymentLink ? cta(paymentLink, 'Pay now') : null,
    }),
    text: plain([
      `Invoice ${invoiceNumber} is ${daysOverdue} days overdue.`,
      `Amount: ${money(total, currency)}`,
      paymentLink || '',
      '',
      supportLine(b),
    ]),
  };
};

const subscriptionPaid = ({ brand, businessName, planName, amount, currency, periodStart, periodEnd, reference }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Subscription payment received — ${money(amount, currency)}`,
    html: layout(b, {
      title: 'Subscription payment received',
      preheader: `${planName} confirmed`,
      body: `
        <p style="margin:0 0 12px 0;">Payment for <strong>${escapeHtml(businessName)}</strong> was received.</p>
        ${cardBox(
          kv('Plan', escapeHtml(planName), { bold: true }) +
          kv('Amount', escapeHtml(money(amount, currency)), { bold: true }) +
          kv('Period', `${escapeHtml(humanDate(periodStart, { timeStyle: undefined }))} → ${escapeHtml(humanDate(periodEnd, { timeStyle: undefined }))}`) +
          (reference ? kv('Reference', escapeHtml(reference), { mono: true }) : '')
        )}
      `,
    }),
    text: plain([
      `Subscription paid for ${businessName}.`,
      `Plan: ${planName}`,
      `Amount: ${money(amount, currency)}`,
      `Period: ${humanDate(periodStart, { timeStyle: undefined })} → ${humanDate(periodEnd, { timeStyle: undefined })}`,
      reference ? `Reference: ${reference}` : '',
      '',
      supportLine(b),
    ]),
  };
};

const subscriptionExpiring = ({ brand, businessName, planName, daysLeft, expiresAt, renewUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Subscription expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: layout(b, {
      title: 'Subscription expiring soon',
      preheader: `${planName} expires soon`,
      body: `
        <p style="margin:0 0 12px 0;">Your <strong>${escapeHtml(planName)}</strong> plan for <strong>${escapeHtml(businessName)}</strong> expires in <strong>${escapeHtml(String(daysLeft))}</strong> day${daysLeft === 1 ? '' : 's'}.</p>
        <p style="margin:0;">Renew to avoid interruption of service.</p>
      `,
      cta: renewUrl ? cta(renewUrl, 'Renew subscription') : null,
    }),
    text: plain([
      `${planName} for ${businessName} expires in ${daysLeft} day(s).`,
      renewUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const subscriptionExpired = ({ brand, businessName, planName, renewUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: 'Your subscription has expired',
    html: layout(b, {
      title: 'Subscription expired',
      preheader: `${planName} expired`,
      body: `
        <p style="margin:0 0 12px 0;">The <strong>${escapeHtml(planName)}</strong> subscription for <strong>${escapeHtml(businessName)}</strong> has expired.</p>
        <p style="margin:0;">Renew to restore full access.</p>
      `,
      cta: renewUrl ? cta(renewUrl, 'Renew now') : null,
    }),
    text: plain([
      `Subscription for ${businessName} expired.`,
      renewUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const subscriptionFailed = ({ brand, businessName, planName, amount, currency, reason, retryUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: 'Subscription payment failed',
    html: layout(b, {
      title: 'Payment failed',
      preheader: 'We could not process your payment',
      body: `
        <p style="margin:0 0 12px 0;">We could not process the subscription payment for <strong>${escapeHtml(businessName)}</strong>.</p>
        ${cardBox(
          kv('Plan', escapeHtml(planName)) +
          kv('Amount', escapeHtml(money(amount, currency))) +
          (reason ? kv('Reason', escapeHtml(reason)) : '')
        , '#fef2f2', '#fecaca')}
      `,
      cta: retryUrl ? cta(retryUrl, 'Retry payment') : null,
    }),
    text: plain([
      `Subscription payment failed for ${businessName}.`,
      `Plan: ${planName} · Amount: ${money(amount, currency)}`,
      reason || '',
      retryUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const planUpgraded = ({ brand, businessName, oldPlan, newPlan, effectiveAt }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Plan upgraded to ${newPlan}`,
    html: layout(b, {
      title: 'Plan upgraded',
      preheader: `${businessName} upgraded`,
      body: `
        <p style="margin:0 0 12px 0;"><strong>${escapeHtml(businessName)}</strong> upgraded from <strong>${escapeHtml(oldPlan)}</strong> to <strong>${escapeHtml(newPlan)}</strong>.</p>
        ${effectiveAt ? `<p style="margin:0;color:#64748b;font-size:13px;">Effective: ${escapeHtml(humanDate(effectiveAt))}</p>` : ''}
      `,
    }),
    text: plain([`${businessName} upgraded ${oldPlan} → ${newPlan}.`, '', supportLine(b)]),
  };
};

const planCancelled = ({ brand, businessName, planName, endsAt }) => {
  const b = normalizeBrand(brand);
  return {
    subject: 'Plan cancelled',
    html: layout(b, {
      title: 'Plan cancelled',
      preheader: `${planName} will end soon`,
      body: `
        <p style="margin:0 0 12px 0;">The <strong>${escapeHtml(planName)}</strong> plan for <strong>${escapeHtml(businessName)}</strong> has been cancelled.</p>
        <p style="margin:0;color:#64748b;font-size:13px;">Access ends: ${escapeHtml(endsAt ? humanDate(endsAt, { timeStyle: undefined }) : 'end of current period')}</p>
      `,
    }),
    text: plain([`${planName} for ${businessName} cancelled.`, '', supportLine(b)]),
  };
};

/* ═══════════════════════════════════════════════════════
   ADMIN
   ═══════════════════════════════════════════════════════ */

const adminWelcome = ({ brand, fullName, email, temporaryPassword, loginUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `You've been added as a ${b.name} Super Admin`,
    html: layout(b, {
      title: 'Welcome to the admin panel',
      preheader: 'Your super admin account is ready',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="margin:0 0 16px 0;">Your ${escapeHtml(b.name)} super admin account has been created.</p>
        ${cardBox(
          kv('Email', escapeHtml(email), { bold: true }) +
          (temporaryPassword ? kv('Temporary password', escapeHtml(temporaryPassword), { bold: true, mono: true }) : '')
        )}
        <p style="margin:0;">Log in and change your password immediately.</p>
      `,
      cta: cta(loginUrl, 'Open admin panel'),
    }),
    text: plain([
      `Hi ${fullName},`,
      '',
      'Your super admin account was created.',
      `Email: ${email}`,
      temporaryPassword ? `Password: ${temporaryPassword}` : '',
      '',
      `Log in: ${loginUrl}`,
      '',
      supportLine(b),
    ]),
  };
};

const adminNewPending = ({ brand, businessName, ownerName, ownerEmail, ownerPhone, country, businessType, registeredAt, reviewUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `New registration pending — ${businessName}`,
    html: layout(b, {
      title: 'New pending registration',
      preheader: `${businessName} awaiting approval`,
      body: `
        <p style="margin:0 0 12px 0;">A new pharmacy has registered and needs approval.</p>
        ${cardBox(
          kv('Business', escapeHtml(businessName), { bold: true }) +
          kv('Owner', `${escapeHtml(ownerName)} · ${escapeHtml(ownerEmail)}${ownerPhone ? ` · ${escapeHtml(ownerPhone)}` : ''}`) +
          kv('Country / Type', `${escapeHtml(country)} · ${escapeHtml(businessType)}`) +
          kv('Registered', escapeHtml(humanDate(registeredAt)))
        )}
      `,
      cta: cta(reviewUrl, 'Review registration'),
    }),
    text: plain([
      `New pending registration: ${businessName}`,
      `Owner: ${ownerName} (${ownerEmail})`,
      `Country / Type: ${country} / ${businessType}`,
      `Registered: ${humanDate(registeredAt)}`,
      '',
      `Review: ${reviewUrl}`,
      '',
      supportLine(b),
    ]),
  };
};

const adminServiceDown = ({ brand, service, error, since }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Alert: ${service} is down`,
    html: layout(b, {
      title: `Service alert — ${service}`,
      preheader: `${service} health check failed`,
      body: `
        <p style="margin:0 0 12px 0;">The health check for <strong>${escapeHtml(service)}</strong> failed.</p>
        ${cardBox(
          kv('Error', escapeHtml(error || 'Unknown')) +
          kv('Since', escapeHtml(humanDate(since)))
        , '#fef2f2', '#fecaca')}
      `,
    }),
    text: plain([
      `${service} is down.`,
      `Error: ${error || 'Unknown'}`,
      `Since: ${humanDate(since)}`,
      '',
      supportLine(b),
    ]),
  };
};

const adminBackupFailed = ({ brand, error, at }) => {
  const b = normalizeBrand(brand);
  return {
    subject: 'Backup failed',
    html: layout(b, {
      title: 'Backup failed',
      preheader: 'Automatic backup did not complete',
      body: `
        <p style="margin:0 0 12px 0;">An automatic backup failed.</p>
        ${cardBox(kv('Error', escapeHtml(error || 'Unknown')) + kv('When', escapeHtml(humanDate(at))), '#fef2f2', '#fecaca')}
      `,
    }),
    text: plain(['Backup failed.', `Error: ${error || 'Unknown'}`, `At: ${humanDate(at)}`, '', supportLine(b)]),
  };
};

const adminBackupSuccess = ({ brand, filename, sizeHuman, durationMs, collections, at, downloadUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Backup completed — ${filename}`,
    html: layout(b, {
      title: 'Backup completed',
      preheader: `${filename} finished successfully`,
      body: `
        <p style="margin:0 0 12px 0;">Automatic backup completed successfully.</p>
        ${cardBox(
          kv('Filename', escapeHtml(filename), { mono: true }) +
          kv('Size', escapeHtml(sizeHuman || '—')) +
          kv('Duration', `${((durationMs || 0) / 1000).toFixed(1)}s`) +
          kv('Collections', escapeHtml(String((collections || []).length))) +
          kv('When', escapeHtml(humanDate(at)))
        , '#f0fdf4', '#bbf7d0')}
      `,
      cta: downloadUrl ? cta(downloadUrl, 'Download backup') : null,
    }),
    text: plain([
      `Backup ${filename} completed.`,
      `Size: ${sizeHuman || '—'}`,
      `Duration: ${((durationMs || 0) / 1000).toFixed(1)}s`,
      `At: ${humanDate(at)}`,
      downloadUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

/* ═══════════════════════════════════════════════════════
   PHARMA OPERATIONS
   ═══════════════════════════════════════════════════════ */

const lowStockAlert = ({ brand, businessName, branchName, productName, qty, threshold, productUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Low stock: ${productName}`,
    html: layout(b, {
      title: 'Low stock alert',
      preheader: `${productName} is running low`,
      body: `
        <p style="margin:0 0 12px 0;"><strong>${escapeHtml(productName)}</strong> is running low at <strong>${escapeHtml(businessName)}</strong>${branchName ? ` · ${escapeHtml(branchName)}` : ''}.</p>
        ${cardBox(
          kv('Current stock', escapeHtml(String(qty)), { bold: true, color: '#78350f' }) +
          kv('Reorder level', escapeHtml(String(threshold)))
        , '#fffbeb', '#fde68a')}
      `,
      cta: productUrl ? cta(productUrl, 'View item') : null,
    }),
    text: plain([
      `Low stock: ${productName}`,
      `Current: ${qty} · Threshold: ${threshold}`,
      productUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const outOfStock = ({ brand, businessName, branchName, productName, productUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Out of stock: ${productName}`,
    html: layout(b, {
      title: 'Out of stock',
      preheader: `${productName} is out of stock`,
      body: `
        <p style="margin:0 0 12px 0;"><strong>${escapeHtml(productName)}</strong> is out of stock at <strong>${escapeHtml(businessName)}</strong>${branchName ? ` · ${escapeHtml(branchName)}` : ''}.</p>
        <p style="margin:0;">Restock soon to avoid losing sales.</p>
      `,
      cta: productUrl ? cta(productUrl, 'View item') : null,
    }),
    text: plain([`Out of stock: ${productName}`, productUrl || '', '', supportLine(b)]),
  };
};

const expiryAlert = ({ brand, businessName, branchName, items, daysLeft, reportUrl }) => {
  const b = normalizeBrand(brand);
  const rows = (items || []).map((i) => kv(i.name, escapeHtml(String(i.qty)), { bold: true })).join('');
  return {
    subject: `Expiry alert — ${daysLeft} days`,
    html: layout(b, {
      title: `Expiring in ${daysLeft} days`,
      preheader: `${(items || []).length} item(s) expiring soon`,
      body: `
        <p style="margin:0 0 12px 0;">The following batches at <strong>${escapeHtml(businessName)}</strong>${branchName ? ` · ${escapeHtml(branchName)}` : ''} expire in ${daysLeft} days:</p>
        ${cardBox(rows, '#fffbeb', '#fde68a')}
      `,
      cta: reportUrl ? cta(reportUrl, 'View expiry report') : null,
    }),
    text: plain([
      `Expiring in ${daysLeft} days:`,
      ...(items || []).map((i) => `- ${i.name} (${i.qty})`),
      reportUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const prescriptionReady = ({ brand, businessName, patientName, prescriptionRef, branchName, pickupUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Your prescription is ready — ${prescriptionRef}`,
    html: layout(b, {
      title: 'Your prescription is ready',
      preheader: 'Ready for pickup',
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(patientName)}</strong>,</p>
        <p style="margin:0 0 12px 0;">Your prescription <strong>${escapeHtml(prescriptionRef)}</strong> has been dispensed at <strong>${escapeHtml(businessName)}</strong>${branchName ? ` · ${escapeHtml(branchName)}` : ''}.</p>
        <p style="margin:0;">Please visit us to collect it. Bring this email or your ID.</p>
      `,
      cta: pickupUrl ? cta(pickupUrl, 'View details') : null,
    }),
    text: plain([
      `Hi ${patientName},`,
      '',
      `Your prescription ${prescriptionRef} is ready for pickup.`,
      '',
      supportLine(b),
    ]),
  };
};

/* ═══════════════════════════════════════════════════════
   REPORTS
   ═══════════════════════════════════════════════════════ */

const dailySummary = ({ brand, businessName, date, totalSales, totalTransactions, avgBasket, currency, topProducts, insightsUrl }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Daily summary — ${date}`,
    html: layout(b, {
      title: `Daily summary — ${date}`,
      preheader: `${money(totalSales, currency)} across ${totalTransactions} sales`,
      body: `
        <p style="margin:0 0 12px 0;">Here's how <strong>${escapeHtml(businessName)}</strong> did on ${escapeHtml(date)}.</p>
        ${cardBox(
          kv('Total sales', escapeHtml(money(totalSales, currency)), { bold: true }) +
          kv('Transactions', escapeHtml(String(totalTransactions))) +
          kv('Average basket', escapeHtml(money(avgBasket, currency)))
        )}
        ${topProducts?.length ? `
          <p style="margin:16px 0 8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Top items</p>
          <ul style="margin:0;padding-left:20px;font-size:14px;color:#334155;">
            ${topProducts.map((p) => `<li style="margin-bottom:6px;">${escapeHtml(p.name)} — ${escapeHtml(String(p.qty))} sold</li>`).join('')}
          </ul>
        ` : ''}
      `,
      cta: insightsUrl ? cta(insightsUrl, 'View insights') : null,
    }),
    text: plain([
      `Daily summary for ${businessName} — ${date}`,
      `Sales: ${money(totalSales, currency)} · ${totalTransactions} transactions · avg ${money(avgBasket, currency)}`,
      ...(topProducts || []).map((p) => `- ${p.name}: ${p.qty}`),
      insightsUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

/* ═══════════════════════════════════════════════════════
   SUPPLIER
   ═══════════════════════════════════════════════════════ */

const purchaseOrder = ({ brand, businessName, supplierName, poNumber, items, subtotal, tax, shipping, total, currency, expectedAt, notes, pdfUrl, businessContact }) => {
  const b = normalizeBrand(brand);
  const fmt = (n) => money(n, currency);
  return {
    subject: `Purchase Order ${poNumber} from ${businessName}`,
    html: layout(b, {
      title: `Purchase Order ${poNumber}`,
      preheader: `New PO from ${businessName}`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(supplierName)}</strong>,</p>
        <p style="margin:0 0 16px 0;">Please find our purchase order below.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              <th align="left" style="padding:10px 12px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Item</th>
              <th align="right" style="padding:10px 12px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Qty</th>
              <th align="right" style="padding:10px 12px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Unit</th>
              <th align="right" style="padding:10px 12px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(items || []).map((i) => `
              <tr>
                <td style="padding:10px 12px;font-size:14px;border-top:1px solid #f1f5f9;">${escapeHtml(i.name)}</td>
                <td align="right" style="padding:10px 12px;font-size:14px;border-top:1px solid #f1f5f9;">${escapeHtml(String(i.qty))}</td>
                <td align="right" style="padding:10px 12px;font-size:14px;border-top:1px solid #f1f5f9;">${fmt(i.unitCost)}</td>
                <td align="right" style="padding:10px 12px;font-size:14px;border-top:1px solid #f1f5f9;font-weight:600;">${fmt(i.subtotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
          ${kv('Subtotal', fmt(subtotal))}
          ${tax ? kv('Tax', fmt(tax)) : ''}
          ${shipping ? kv('Shipping', fmt(shipping)) : ''}
          ${kv('Total', fmt(total), { bold: true, color: '#0f172a' })}
        </table>
        ${expectedAt ? `<p style="margin:16px 0 0 0;font-size:13px;color:#64748b;">Expected delivery: ${escapeHtml(humanDate(expectedAt, { timeStyle: undefined }))}</p>` : ''}
        ${notes ? `<p style="margin:8px 0 0 0;font-size:13px;color:#64748b;">Notes: ${escapeHtml(notes)}</p>` : ''}
        ${businessContact ? `<p style="margin:16px 0 0 0;font-size:13px;color:#64748b;">Questions? Contact ${escapeHtml(businessContact.name || businessName)}${businessContact.phone ? ` · ${escapeHtml(businessContact.phone)}` : ''}${businessContact.email ? ` · ${escapeHtml(businessContact.email)}` : ''}</p>` : ''}
      `,
      cta: pdfUrl ? cta(pdfUrl, 'Download PDF') : null,
    }),
    text: plain([
      `Purchase Order ${poNumber} from ${businessName}`,
      '',
      ...(items || []).map((i) => `- ${i.name} x${i.qty} @ ${fmt(i.unitCost)}`),
      '',
      `Subtotal: ${fmt(subtotal)}`,
      tax ? `Tax: ${fmt(tax)}` : '',
      shipping ? `Shipping: ${fmt(shipping)}` : '',
      `Total: ${fmt(total)}`,
      expectedAt ? `Expected: ${humanDate(expectedAt, { timeStyle: undefined })}` : '',
      notes ? `Notes: ${notes}` : '',
      pdfUrl || '',
      '',
      supportLine(b),
    ]),
  };
};

const purchaseOrderCancelled = ({ brand, businessName, supplierName, poNumber, reason }) => {
  const b = normalizeBrand(brand);
  return {
    subject: `Cancelled: Purchase Order ${poNumber}`,
    html: layout(b, {
      title: `Purchase Order ${poNumber} cancelled`,
      preheader: `${businessName} cancelled PO ${poNumber}`,
      body: `
        <p style="margin:0 0 12px 0;">Hi <strong>${escapeHtml(supplierName)}</strong>,</p>
        <p style="margin:0 0 12px 0;"><strong>${escapeHtml(businessName)}</strong> has cancelled purchase order <strong>${escapeHtml(poNumber)}</strong>.</p>
        ${reason ? `<p style="margin:0;color:#64748b;font-size:13px;">Reason: ${escapeHtml(reason)}</p>` : ''}
      `,
    }),
    text: plain([`PO ${poNumber} cancelled by ${businessName}.`, reason || '', '', supportLine(b)]),
  };
};

/* ═══════════════════════════════════════════════════════ */

module.exports = {
  verification,
  passwordReset,
  passwordChanged,
  welcome,
  staffWelcome,
  staffDeactivated,
  roleChanged,

  registrationReceived,
  registrationRejected,

  invoice,
  paymentReceived,
  invoiceReminder,
  invoiceOverdue,
  subscriptionPaid,
  subscriptionExpiring,
  subscriptionExpired,
  subscriptionFailed,
  planUpgraded,
  planCancelled,

  adminWelcome,
  adminNewPending,
  adminServiceDown,
  adminBackupFailed,
  adminBackupSuccess,

  lowStockAlert,
  outOfStock,
  expiryAlert,
  prescriptionReady,

  dailySummary,

  purchaseOrder,
  purchaseOrderCancelled,
};