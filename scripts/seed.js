require('./dnsSet');
require('dotenv/config');

const readline = require('readline');

const { connectDB, disconnectDB } = require('../config/db');
const Plan = require('../models/admin/Plan');
const PaymentMethod = require('../models/admin/PaymentMethod');
const PlatformSetting = require('../models/admin/PlatformSetting');
const Legal = require('../models/admin/Legal');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

function clear() {
  process.stdout.write('\x1b[2J\x1b[0f');
}

function line(str = '') {
  console.log(str);
}

function heading(title) {
  line();
  line(`${C.bold}${C.cyan}${title}${C.reset}`);
  line(`${C.dim}${'─'.repeat(title.length)}${C.reset}`);
  line();
}

function ok(msg) {
  line(`${C.green}✔${C.reset} ${msg}`);
}

function warn(msg) {
  line(`${C.yellow}⚠${C.reset} ${msg}`);
}

function err(msg) {
  line(`${C.red}✖${C.reset} ${msg}`);
}

/* ─────────────────────── PLANS ─────────────────────── */

async function seedPlans() {
  const plans = [
    {
      code: 'free',
      name: 'Free',
      description: 'Try PharmaSys with one branch.',
      price: { amount: 0, currency: 'KES', interval: 'month' },
      limits: {
        maxOwners: 1,
        maxBranches: 1,
        maxManagersPerBranch: 1,
        maxCashiersPerBranch: 1,
        maxProducts: 50,
        maxTransactionsPerMonth: 500,
        maxAiCallsPerDay: 5,
        maxSmsPerMonth: 0,
      },
      features: {
        aiInsights: false,
        multiBranch: false,
        api: false,
        prioritySupport: false,
        customDomain: false,
        prescriptions: true,
        interactionCheck: false,
      },
      isPublic: true,
      isActive: true,
      sortOrder: 0,
      trialDays: 0,
    },
    {
      code: 'starter',
      name: 'Starter',
      description: 'For a single growing pharmacy.',
      price: { amount: 1500, currency: 'KES', interval: 'month' },
      limits: {
        maxOwners: 1,
        maxBranches: 1,
        maxManagersPerBranch: 1,
        maxCashiersPerBranch: 3,
        maxProducts: 1000,
        maxTransactionsPerMonth: 10000,
        maxAiCallsPerDay: 50,
        maxSmsPerMonth: 200,
      },
      features: {
        aiInsights: true,
        multiBranch: false,
        api: false,
        prioritySupport: false,
        customDomain: false,
        prescriptions: true,
        interactionCheck: false,
      },
      isPublic: true,
      isActive: true,
      sortOrder: 1,
      trialDays: 14,
    },
    {
      code: 'pro',
      name: 'Pro',
      description: 'Multi-branch pharmacy.',
      price: { amount: 4500, currency: 'KES', interval: 'month' },
      limits: {
        maxOwners: 1,
        maxBranches: 5,
        maxManagersPerBranch: 2,
        maxCashiersPerBranch: 10,
        maxProducts: 10000,
        maxTransactionsPerMonth: 100000,
        maxAiCallsPerDay: 200,
        maxSmsPerMonth: 1000,
      },
      features: {
        aiInsights: true,
        multiBranch: true,
        api: true,
        prioritySupport: true,
        customDomain: false,
        prescriptions: true,
        interactionCheck: true,
      },
      isPublic: true,
      isActive: true,
      sortOrder: 2,
      trialDays: 14,
    },
    {
      code: 'business',
      name: 'Business',
      description: 'Unlimited branches and staff.',
      price: { amount: 12000, currency: 'KES', interval: 'month' },
      limits: {
        maxOwners: 1,
        maxBranches: 999,
        maxManagersPerBranch: 999,
        maxCashiersPerBranch: 999,
        maxProducts: 999999,
        maxTransactionsPerMonth: 999999,
        maxAiCallsPerDay: 1000,
        maxSmsPerMonth: 5000,
      },
      features: {
        aiInsights: true,
        multiBranch: true,
        api: true,
        prioritySupport: true,
        customDomain: true,
        prescriptions: true,
        interactionCheck: true,
      },
      isPublic: true,
      isActive: true,
      sortOrder: 3,
      trialDays: 14,
    },
  ];

  let count = 0;
  for (const plan of plans) {
    await Plan.updateOne({ code: plan.code }, { $set: plan }, { upsert: true });
    count++;
  }
  ok(`Plans: ${count} upserted`);
}

/* ─────────────────────── PAYMENT METHODS ─────────────────────── */

async function seedPaymentMethods() {
  const methods = [
    {
      code: 'stripe',
      label: 'Card (Stripe)',
      mode: 'auto',
      enabled: false,
      requiresApproval: false,
      order: 1,
      config: { publishableKey: '' },
    },
    {
      code: 'mpesa_stk',
      label: 'M-Pesa STK Push',
      mode: 'auto',
      enabled: false,
      requiresApproval: false,
      order: 2,
      config: { shortcode: '', name: '' },
    },
    {
      code: 'cash',
      label: 'Cash',
      mode: 'manual',
      enabled: true,
      requiresApproval: false,
      order: 3,
      config: {},
    },
    {
      code: 'mpesa_send',
      label: 'M-Pesa Send Money',
      mode: 'manual',
      enabled: false,
      requiresApproval: false,
      order: 4,
      config: { phone: '', name: '' },
    },
    {
      code: 'mpesa_till',
      label: 'M-Pesa Buy Goods (Till)',
      mode: 'manual',
      enabled: false,
      requiresApproval: false,
      order: 5,
      config: { tillNumber: '', name: '' },
    },
    {
      code: 'mpesa_paybill',
      label: 'M-Pesa Paybill',
      mode: 'manual',
      enabled: false,
      requiresApproval: false,
      order: 6,
      config: { paybillNumber: '', accountNumber: '', name: '' },
    },
    {
      code: 'bank',
      label: 'Bank Transfer',
      mode: 'manual',
      enabled: false,
      requiresApproval: false,
      order: 7,
      config: { bankName: '', accountName: '', accountNumber: '', branch: '', swift: '' },
    },
  ];

  let count = 0;
  for (const m of methods) {
    await PaymentMethod.updateOne({ code: m.code }, { $setOnInsert: m }, { upsert: true });
    count++;
  }
  ok(`Payment methods: ${count} upserted`);
}

/* ─────────────────────── PLATFORM SETTINGS ─────────────────────── */

async function seedSettings() {
  const settings = [
    // Brand
    ['platform_name', 'PharmaSys'],
    ['platform_logo_url', null],
    ['support_email', 'hdmtechlimited@gmail.com'],
    ['support_phone', '+254 700 000 000'],
    ['platform_website', 'https://hdm.co.ke'],

    // Locale
    ['default_currency', 'KES'],
    ['default_country', 'KE'],
    ['default_tax_rate', 16],
    ['tax_inclusive', false],

    // Account
    ['min_password_length', 8],
    ['registration_open', true],
    ['maintenance_mode', false],
    ['max_owners_per_tenant', 1],

    // POS behaviour
    ['cashier_discount_limit', 10],
    ['cashier_refund_limit', 0],
    ['manager_can_invite_cashier', true],
    ['require_shift_clock_in', false],

    // Features
    ['feature_pos', true],
    ['feature_inventory', true],
    ['feature_prescriptions', true],
    ['feature_patient_records', true],
    ['feature_expiry_alerts', true],
    ['feature_purchase_orders', true],
    ['feature_invoices', true],
    ['feature_ai_insights', true],
    ['feature_multi_branch', false],
    ['feature_interaction_check', false],
    ['feature_loyalty', false],
    ['feature_api', false],

    // Business type / countries / currencies
    ['business_types', ['pharmacy']],
    ['countries', [
      { code: 'KE', name: 'Kenya', currency: 'KES', dialCode: '+254' },
      { code: 'UG', name: 'Uganda', currency: 'UGX', dialCode: '+256' },
      { code: 'TZ', name: 'Tanzania', currency: 'TZS', dialCode: '+255' },
      { code: 'NG', name: 'Nigeria', currency: 'NGN', dialCode: '+234' },
      { code: 'GH', name: 'Ghana', currency: 'GHS', dialCode: '+233' },
      { code: 'ZA', name: 'South Africa', currency: 'ZAR', dialCode: '+27' },
    ]],
    ['currencies', ['KES', 'UGX', 'TZS', 'NGN', 'GHS', 'ZAR', 'USD']],

    // AI config (providers)
    ['ai_config', {
      providers: [
        { key: 'hdm', label: 'HDM AI', baseUrl: 'https://hdmaiserver.pxxl.click/api/v1', apiKey: '', enabled: true },
        { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', enabled: false },
        { key: 'chatgpt', label: 'ChatGPT (OpenAI)', baseUrl: 'https://api.openai.com/v1', apiKey: '', enabled: false },
        { key: 'claude', label: 'Claude (Anthropic)', baseUrl: 'https://api.anthropic.com/v1', apiKey: '', enabled: false },
        { key: 'gemini', label: 'Gemini (Google)', baseUrl: 'https://generativelanguage.googleapis.com/v1', apiKey: '', enabled: false },
      ],
      defaultProvider: 'hdm',
      features: {
        landingAi: false,
        clientAi: true,
        fileUpload: false,
        outwardApiKeys: false,
      },
    }],

    // M-Pesa platform config
    ['mpesa_config', {
      stkCheckoutEnabled: false,
    }],

    // Backups
    ['backup_enabled', true],
    ['backup_auto_enabled', true],
    ['backup_frequency', 'daily'],
    ['backup_time', '03:00'],
    ['backup_day_of_week', 0],
    ['backup_scope', 'all'],
    ['backup_collections', []],
    ['backup_include_uploads', false],
    ['backup_storage_target', 'cloudinary'],
    ['backup_encrypt', false],
    ['backup_retention_days', 30],
    ['backup_notify_on_success', true],
    ['backup_notify_on_fail', true],
    ['backup_notify_emails', ['hdmtechlimited@gmail.com']],
    ['backup_notify_roles', ['super_admin']],
    ['backup_retry_on_failure', true],
    ['backup_max_retries', 2],
    ['backup_last_run_at', null],
    ['backup_last_status', null],
    ['backup_next_run_at', null],

    // Public chat (site)
    ['chat_greeting', 'Hi! Ask me anything about PharmaSys.'],
    ['chat_disclaimer', 'PharmaSys AI gives business insights only, not medical advice. For medical questions, consult a licensed pharmacist.'],

    // Downloads (site)
    ['downloads', []],
  ];

  let count = 0;
  for (const [key, value] of settings) {
    await PlatformSetting.updateOne(
      { key },
      { $setOnInsert: { key, value } },
      { upsert: true }
    );
    count++;
  }
  ok(`Platform settings: ${count} upserted`);
}

/* ─────────────────────── LEGAL ─────────────────────── */

async function seedLegals() {
  const terms = `# PharmaSys — Terms of Service

By using PharmaSys you agree to these terms.

## 1. Account

You are responsible for your account and any activity under it. Keep your credentials secure.

## 2. Subscription

Plans are billed as agreed at signup. Fees are due per the selected interval.

## 3. Data

You retain ownership of your pharmacy data. We store and process it to provide the service.

## 4. Acceptable Use

You agree not to misuse the platform, attempt to access other tenants' data, or violate any applicable pharmacy regulations.

## 5. Termination

You may cancel at any time. We may suspend accounts that violate these terms or applicable law.

## 6. Contact

For questions contact hdmtechlimited@gmail.com.
`;

  const privacy = `# PharmaSys — Privacy Policy

We collect the minimum data needed to run PharmaSys.

## What we collect

- Business name, owner name, email, phone
- Transaction and inventory data you enter
- Patient records you maintain (as a data controller)
- Usage logs

## How we use it

- To operate your account
- To send transactional emails and SMS
- To provide AI insights for your business

## What we don't do

- Sell your data
- Share with third parties except service providers (payment, email, SMS, storage, AI)

## Sub-processors

- Safaricom Daraja (M-Pesa)
- Stripe (card payments)
- hdmBridge (email + SMS)
- Cloudinary (file storage)
- HDM AI (AI insights)

## Contact

hdmtechlimited@gmail.com
`;

  const dpa = `# PharmaSys — Data Processing Agreement

This DPA governs processing of personal data under PharmaSys.

## Roles

PharmaSys is the data processor. You are the data controller for any patient or customer data you store.

## Sub-processors

- Safaricom Daraja
- Stripe
- hdmBridge (email + SMS)
- Cloudinary (file storage)
- HDM AI (insights)

## Security

Data is stored on encrypted infrastructure. Access is restricted to authorized personnel.

## Contact

hdmtechlimited@gmail.com
`;

  const refund = `# PharmaSys — Refund Policy

Subscription fees are non-refundable once a billing period has started.

If you were charged in error, contact us within 7 days at hdmtechlimited@gmail.com.
`;

  const aup = `# PharmaSys — Acceptable Use Policy

Do not use PharmaSys to:

- Break any law or pharmacy regulation
- Dispense controlled substances without proper authorization
- Process illegal goods or services
- Send spam through email or SMS features
- Attempt to access other tenants' data

Violation may lead to suspension or termination.
`;

  const docs = [
    { type: 'terms', title: 'Terms of Service', content: terms },
    { type: 'privacy', title: 'Privacy Policy', content: privacy },
    { type: 'dpa', title: 'Data Processing Agreement', content: dpa },
    { type: 'refund', title: 'Refund Policy', content: refund },
    { type: 'aup', title: 'Acceptable Use Policy', content: aup },
  ];

  let inserted = 0;
  for (const d of docs) {
    const existing = await Legal.findOne({ type: d.type }).lean();
    if (existing) continue;

    await Legal.create({
      type: d.type,
      version: 1,
      title: d.title,
      content: d.content,
      effectiveAt: new Date(),
      publishedAt: new Date(),
      isCurrent: true,
    });
    inserted++;
  }
  ok(`Legal docs: ${inserted} inserted`);
}

/* ─────────────────────── MENU ─────────────────────── */

async function menu() {
  clear();
  line();
  line(`${C.bold}${C.cyan}╭───────────────────────────────────────╮${C.reset}`);
  line(`${C.bold}${C.cyan}│   PharmaSys — Seed CLI                │${C.reset}`);
  line(`${C.bold}${C.cyan}╰───────────────────────────────────────╯${C.reset}`);
  line();
  line(`  ${C.bold}1${C.reset}.  Seed all`);
  line(`  ${C.bold}2${C.reset}.  Seed platform settings`);
  line(`  ${C.bold}3${C.reset}.  Seed plans`);
  line(`  ${C.bold}4${C.reset}.  Seed payment methods`);
  line(`  ${C.bold}5${C.reset}.  Seed legal docs`);
  line();
  line(`  ${C.dim}0.  Exit${C.reset}`);
  line();

  return await ask(`${C.cyan}›${C.reset} Select option: `);
}

async function main() {
  clear();
  line(`${C.dim}Connecting to MongoDB...${C.reset}`);

  try {
    await connectDB();
    ok('Connected');
  } catch (e) {
    err(`Connection failed: ${e.message}`);
    process.exit(1);
  }

  while (true) {
    const choice = await menu();

    try {
      heading('Seeding');

      if (choice === '1') {
        await seedPlans();
        await seedPaymentMethods();
        await seedSettings();
        await seedLegals();
        line();
        ok('All seeds complete');
      } else if (choice === '2') {
        await seedSettings();
      } else if (choice === '3') {
        await seedPlans();
      } else if (choice === '4') {
        await seedPaymentMethods();
      } else if (choice === '5') {
        await seedLegals();
      } else if (choice === '0') {
        break;
      } else {
        continue;
      }
    } catch (e) {
      err(e.message);
    }

    await ask(`${C.dim}Press Enter to continue...${C.reset}`);
  }

  rl.close();
  await disconnectDB();
  line();
  ok('Bye');
  process.exit(0);
}

main();