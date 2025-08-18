import express from 'express';
import cors from 'cors';
import { chromium, Page } from 'playwright';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';

dotenv.config();

const app = express();

/* ------------------- crash guards (show in Railway logs) ------------------ */
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

/* --------------------------- Readiness State ---------------------------- */
let isReady = false;
let playwrightReady = false;

/* --------------------------- Health Checks ------------------------------ */
app.get('/health', async (_req, res) => {
  try {
    // Basic readiness check
    if (!isReady) {
      return res.status(503).type('text/plain').send('Service starting up...');
    }
    
    // Advanced health check - verify Playwright can launch browsers
    if (!playwrightReady) {
      console.log('Health check: Testing Playwright readiness...');
      const browser = await chromium.launch({ 
        headless: true,
        timeout: 10000 // 10 second timeout for health checks
      });
      await browser.close();
      playwrightReady = true;
      console.log('Health check: Playwright test passed');
    }
    
    res.status(200).type('text/plain').send('OK');
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).type('text/plain').send('Service unavailable');
  }
});

/* ------------------------------- CORS setup ------------------------------- */
/** Static allowlist + env (comma-separated) */
const staticAllow = [
  'https://hostel-hub-tenant-ma-production.up.railway.app',
  'https://anandpg.netlify.app',
  'https://railway.com', // ✅ added as requested
];
const envAllow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWLIST = Array.from(new Set([...staticAllow, ...envAllow]));

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // health checks / curl / server-to-server
    if (ALLOWLIST.includes(origin)) return cb(null, true);
    // optional wildcard: allow patterns like *.railway.app
    if (ALLOWLIST.some(p => p.startsWith('*.') && origin.endsWith(p.slice(1)))) {
      return cb(null, true);
    }
    return cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ----------------------------- body parsers ------------------------------- */
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

/* --------------------------------- Types --------------------------------- */
interface PoliceFormData {
  id_type: string;
  id_number: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  father_first_name: string;
  father_middle_name?: string;
  father_last_name: string;
  caste: string;
  date_of_birth: string; // DD-MM-YYYY
  tenant_state: string;
  tenant_police_district: string;
  tenant_police_station: string;
  phone: string;
  permanent_address: string;

  // optional/extra fields
  age?: string;
  address_of_rented_property?: string;
  rent_amount?: string;
  rental_duration?: string;
  property_type?: string;
  landlord_first_name?: string;
  landlord_middle_name?: string;
  landlord_last_name?: string;
  landlord_father_first?: string;
  landlord_father_middle?: string;
  landlord_father_last?: string;
  landlord_mobile?: string;
  landlord_address?: string;
  landlord_police_district?: string;
  landlord_police_station?: string;
  referenced_by?: string;

  passport_photo_url: string;
  combined_id_photo_url?: string;

  [key: string]: any; // allow dynamic lookup
}

/* ------------------------ Startup Readiness Check ----------------------- */
async function performStartupReadinessCheck() {
  console.log('🔍 Performing startup readiness checks...');
  
  try {
    // Test Playwright browser launching
    console.log('Testing Playwright browser launch capability...');
    const browser = await chromium.launch({ 
      headless: true,
      timeout: 15000 // 15 second timeout for startup
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Test basic page operations
    await page.goto('data:text/html,<html><body>Test</body></html>');
    const title = await page.title();
    
    await context.close();
    await browser.close();
    
    console.log('✅ Playwright readiness check passed');
    playwrightReady = true;
    isReady = true;
    
    return true;
  } catch (error) {
    console.error('❌ Startup readiness check failed:', error);
    console.log('⚠️  This may be expected in development environments without browsers installed');
    console.log('📝 In production Docker containers, browsers should be pre-installed');
    
    // In development, continue anyway but mark as not ready
    // This allows the service to start for development purposes
    if (process.env.NODE_ENV !== 'production') {
      console.log('🛠️  Development mode: continuing startup without browser verification');
      isReady = true; // Allow basic startup
      // Don't set playwrightReady = true, so health checks will still test browsers
      return true;
    }
    
    throw error;
  }
}

/* ----------------------- Enhanced Browser Management ---------------------- */
async function launchBrowserWithRetry(maxRetries = 3, timeout = 30000): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to launch browser (attempt ${attempt}/${maxRetries})...`);
      
      const browser = await chromium.launch({ 
        headless: true,
        timeout,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      
      console.log('✅ Browser launched successfully');
      return browser;
    } catch (error) {
      console.error(`❌ Browser launch attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to launch browser after ${maxRetries} attempts: ${error}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}
function assertDOB_DDMMYYYY(input: string) {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(input)) {
    throw new Error('DOB must be in DD-MM-YYYY format');
  }
  return input;
}
function computeAgeFromDob(dob: string): string {
  try {
    const [dd, mm, yyyy] = dob.split('-').map(Number);
    const now = new Date();
    let age = now.getFullYear() - yyyy;
    const hadBirthday =
      (now.getMonth() + 1 > mm) || ((now.getMonth() + 1 === mm) && now.getDate() >= dd);
    if (!hadBirthday) age -= 1;
    return String(age);
  } catch { return ''; }
}
async function downloadToTemp(urlOrPath: string): Promise<string> {
  if (urlOrPath.startsWith('/') || /^[a-zA-Z]:\\/.test(urlOrPath)) return urlOrPath;
  const resp = await fetch(urlOrPath);
  if (!resp.ok) throw new Error(`Failed to fetch file: ${urlOrPath}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  let ext = '';
  try { ext = path.extname(new URL(urlOrPath).pathname); } catch {}
  const tmp = path.join(os.tmpdir(), `upload-${crypto.randomBytes(6).toString('hex')}${ext}`);
  await fs.writeFile(tmp, buf);
  return tmp;
}
async function typeInto(page: Page, selector: string, text: string) {
  await page.waitForSelector(selector, { state: 'visible' });
  await page.fill(selector, '');
  await page.type(selector, text);
}
async function safeSelect(page: Page, selector: string, labelOrValue: string) {
  await page.waitForSelector(selector, { state: 'visible' });
  try {
    const byLabel = await page.selectOption(selector, { label: labelOrValue });
    if (byLabel && byLabel.length) return;
  } catch {}
  await page.selectOption(selector, labelOrValue);
}
async function setIfExists(page: Page, selectors: string[], value?: string) {
  if (!value) return;
  for (const sel of selectors) {
    if (await page.locator(sel).count()) {
      await typeInto(page, sel, value);
      return;
    }
  }
}
async function selectIfExists(page: Page, selectors: string[], value?: string) {
  if (!value) return;
  for (const sel of selectors) {
    if (await page.locator(sel).count()) {
      await safeSelect(page, sel, value);
      return;
    }
  }
}
async function selectWithPostback(page: Page, selector: string, labelOrValue: string, nextSelector: string) {
  await page.waitForSelector(selector, { state: 'visible' });
  try { await page.selectOption(selector, { label: labelOrValue }); }
  catch { await page.selectOption(selector, labelOrValue); }
  await page.waitForLoadState('networkidle');
  await page.waitForFunction((sel: string) => {
    const el = document.querySelector(sel) as HTMLSelectElement | null;
    return !!el && (el as any).options && (el as any).options.length > 1;
  }, nextSelector);
}

/* --------------------------------- Route --------------------------------- */
app.post('/api/police/submit/tenant', async (req, res) => {
  const p: PoliceFormData = req.body;
  try { assertDOB_DDMMYYYY(p.date_of_birth); }
  catch (e: any) { return res.status(400).json({ ok: false, error: e.message }); }

  if (!isReady) {
    return res.status(503).json({ ok: false, error: 'Service not ready yet, please try again' });
  }

  console.log(`📋 Processing police form submission for: ${p.first_name} ${p.last_name}`);

  const def = {
    availFrom: '10',
    availTo: '18',
    gender: 'Female',
    purpose: 'Residence',
    rentedAddress: p.address_of_rented_property || 'XYZ,ASD,JAIPUR',
    landlordFirst: p.landlord_first_name || 'ZZZ',
    landlordMiddle: p.landlord_middle_name || 'AAA',
    landlordLast: p.landlord_last_name || 'SSS',
    landlordFatherFirst: p.landlord_father_first || 'AAA',
    landlordFatherMiddle: p.landlord_father_middle || 'SSS',
    landlordFatherLast: p.landlord_father_last || 'DDD',
    landlordMobile: p.landlord_mobile || '9856325698',
    landlordAddress: p.landlord_address || 'XYZ,ASD,JAIPUR',
    landlordDistrict: p.landlord_police_district || 'JAIPUR EAST',
    landlordStation: p.landlord_police_station || 'RAMNAGARIYA',
    referencedBy: p.referenced_by || 'ONLINE',
  };
  const computedAge = p.age || computeAgeFromDob(p.date_of_birth);

  let browser = null;
  let ctx = null;
  
  try {
    browser = await launchBrowserWithRetry();
    ctx = await browser.newContext();
    const page = await ctx.newPage();

    console.log('🌐 Navigating to police website...');
    await page.goto('https://www.police.rajasthan.gov.in/old/verificationform.aspx', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    const tenantTab = page.locator('text=Tenant Uploads');
    if (await tenantTab.count()) {
      await tenantTab.first().click();
      await page.waitForLoadState('networkidle');
    }

    console.log('📝 Filling form fields...');
    // Tenant identity
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlTIdCardType'], p.id_type);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTIdNo'], p.id_number);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlTAvailFrom'], def.availFrom);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlTAvailTo'], def.availTo);

    // Tenant details
    await setIfExists(page, ['#ContentPlaceHolder1_txtTFirstName'], p.first_name);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTMIddleName'], p.middle_name);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTLastName'], p.last_name);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTFirstFName'], p.father_first_name);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTMIddleFName'], p.father_middle_name);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTLastFName'], p.father_last_name);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlTSex'], def.gender);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlTCaste'], p.caste);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTDOB'], p.date_of_birth);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTAge'], computedAge);
    await setIfExists(page, ['#ContentPlaceHolder1_txtTtntNo', '#ContentPlaceHolder1_txtTPhone'], p.phone);

    // Tenant location cascade
    if (await page.locator('#ContentPlaceHolder1_ddlTState').count()) {
      await selectWithPostback(page, '#ContentPlaceHolder1_ddlTState', p.tenant_state, '#ContentPlaceHolder1_ddlTDistrict');
      await selectWithPostback(page, '#ContentPlaceHolder1_ddlTDistrict', p.tenant_police_district, '#ContentPlaceHolder1_ddlTStation');
      await selectIfExists(page, ['#ContentPlaceHolder1_ddlTStation', '#ContentPlaceHolder1_ddlTPoliceStation'], p.tenant_police_station);
    }

    // Addresses & purpose
    await setIfExists(page, ['#ContentPlaceHolder1_txtTAddress'], p.permanent_address);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlpurpose'], def.purpose);
    await setIfExists(page, ['#ContentPlaceHolder1_txtaddressofrented', '#ContentPlaceHolder1_txtPAddress'], def.rentedAddress);

    // Optional property details
    await setIfExists(page, ['#ContentPlaceHolder1_txtPRent'], p.rent_amount);
    await setIfExists(page, ['#ContentPlaceHolder1_txtPDuration'], p.rental_duration);
    await selectIfExists(page, ['#ContentPlaceHolder1_ddlPType'], p.property_type);

    // Landlord details (+ fallbacks)
    await setIfExists(page, ['#ContentPlaceHolder1_txtLFirstName'], def.landlordFirst);
    await setIfExists(page, ['#ContentPlaceHolder1_txtLMIddleName'], def.landlordMiddle);
    await setIfExists(page, ['#ContentPlaceHolder1_txtLLastName'], def.landlordLast);
    await setIfExists(page, ['#ContentPlaceHolder1_txtLFirstFName'], def.landlordFatherFirst);
    await setIfExists(page, ['#ContentPlaceHolder1_txtLMIddleFName'], def.landlordFatherMiddle);
    await setIfExists(page, ['#ContentPlaceHolder1_txtLLastFName'], def.landlordFatherLast);
    await setIfExists(page, ['#ContentPlaceHolder1_txtlandMobno', '#ContentPlaceHolder1_txtLPhone'], def.landlordMobile);
    await setIfExists(page, ['#ContentPlaceHolder1_txtlandPAddress', '#ContentPlaceHolder1_txtLAddress'], def.landlordAddress);

    // Landlord district/station cascade
    if (await page.locator('#ContentPlaceHolder1_ddlLdistrict, #ContentPlaceHolder1_ddlLDistrict').count()) {
      const lDistSel = (await page.locator('#ContentPlaceHolder1_ddlLdistrict').count())
        ? '#ContentPlaceHolder1_ddlLdistrict'
        : '#ContentPlaceHolder1_ddlLDistrict';
      const lNext = (await page.locator('#ContentPlaceHolder1_ddlLStation').count())
        ? '#ContentPlaceHolder1_ddlLStation'
        : '#ContentPlaceHolder1_ddlLPoliceStation';
      await selectWithPostback(page, lDistSel, def.landlordDistrict, lNext);
      await selectIfExists(page, ['#ContentPlaceHolder1_ddlLStation', '#ContentPlaceHolder1_ddlLPoliceStation'], def.landlordStation);
    }

    await setIfExists(page, ['#ContentPlaceHolder1_txtLRefer'], def.referencedBy);

    console.log('📁 Processing file uploads...');
    // Files
    const tenantPhoto = await downloadToTemp(p.passport_photo_url);
    await page.setInputFiles('#ContentPlaceHolder1_flTPhoto', tenantPhoto).catch(() => {});
    if (p.combined_id_photo_url) {
      const idPhoto = await downloadToTemp(p.combined_id_photo_url);
      await page.setInputFiles('#ContentPlaceHolder1_flTPhotoId', idPhoto).catch(() => {});
    }

    console.log('🚀 Submitting form...');
    // Submit
    const SAVE_BTN = '#ContentPlaceHolder1_btnTSave, #ContentPlaceHolder1_btnSubmit';
    await page.waitForSelector(SAVE_BTN, { state: 'visible' });
    const prevHtml = await page.content();
    await Promise.all([
      page.click(SAVE_BTN),
      page.waitForLoadState('networkidle'),
      page.waitForFunction(
        (oldHtml: string) => document.documentElement.innerHTML !== oldHtml,
        prevHtml,
        { timeout: 25000 }
      ),
    ]);

    // Validation check
    const hasError = await page.evaluate(() => {
      const summary = document.querySelector('.validation-summary,.ValidationSummary');
      const spans = Array.from(document.querySelectorAll('span')) as HTMLSpanElement[];
      const withErr = spans.some(s => /required|invalid|please select|enter/i.test(String(s.textContent || '')));
      return !!summary || withErr;
    });
    if (hasError) throw new Error('Validation error on target site. Check required fields / formats.');

    console.log('🔍 Extracting reference number...');
    // Extract Reference No
    let referenceNo: string | null = null;
    const candidates = [
      '#ContentPlaceHolder1_lblRefNo',
      '#ContentPlaceHolder1_lblTRefNo',
      '#lblRefNo',
      '#lblReference',
    ];
    for (const sel of candidates) {
      if (await page.locator(sel).count()) {
        const txt = (await page.locator(sel).first().textContent())?.trim() || '';
        const m = txt.match(/([A-Za-z0-9\/\-]+)/);
        if (m) { referenceNo = m[1]; break; }
      }
    }
    if (!referenceNo) {
      const html = await page.content();
      const m = html.match(/Ref(?:erence)?\s*No\.?\s*[:\-]?\s*([A-Za-z0-9\/\-]+)/i);
      if (m) referenceNo = m[1].trim();
    }
    if (!referenceNo) throw new Error('Reference number not found after submission.');

    console.log(`✅ Form submitted successfully. Reference: ${referenceNo}`);
    res.json({ ok: true, referenceNo });
  } catch (e: any) {
    console.error('❌ Form submission failed:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  } finally {
    if (ctx) {
      await ctx.close().catch((err: any) => console.error('Error closing context:', err));
    }
    if (browser) {
      await browser.close().catch((err: any) => console.error('Error closing browser:', err));
    }
  }
});

/* --------------------------------- start --------------------------------- */
const port = Number(process.env.PORT || 3000);

// Graceful shutdown handling
let server: any;

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed.');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      console.log('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Startup sequence
async function startServer() {
  try {
    console.log('🚀 Starting Police Form Automation Service...');
    
    // Perform startup readiness checks
    await performStartupReadinessCheck();
    
    // Start the server
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`🚦 Server ready and listening on 0.0.0.0:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🔗 Police form API: http://localhost:${port}/api/police/submit/tenant`);
      console.log('✅ Service is fully operational');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
