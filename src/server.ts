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
const PORT = process.env.PORT || 3000;

// ---------- CORS allowlist ----------
const raw = process.env.ALLOWED_ORIGINS || '';
const ALLOWLIST = raw.split(',').map(s => s.trim()).filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server, curl, etc.
    if (ALLOWLIST.includes(origin)) return cb(null, true);
    // optional wildcard support for subdomains, e.g., *.railway.app
    if (ALLOWLIST.some(pat => pat.startsWith('*.') && origin.endsWith(pat.slice(1)))) {
      return cb(null, true);
    }
    cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  credentials: false,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---------- API key guard (optional) ----------
app.use((req, res, next) => {
  const required = process.env.API_KEY;
  if (!required) return next();
  const key = req.headers['x-api-key'];
  if (key === required) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
});

// ---------- Body parsing ----------
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- Types & helpers ----------
interface PoliceFormData {
  // required core fields
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

  // optional extras / fallbacks
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

  // allow dynamic lookups
  [key: string]: any;
}

function assertDOB_DDMMYYYY(input: string) {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(input)) {
    throw new Error('DOB must be in DD-MM-YYYY format');
  }
  return input;
}

function computeAgeFromDob(dob: string): string {
  // dob: DD-MM-YYYY
  try {
    const [dd, mm, yyyy] = dob.split('-').map(Number);
    const now = new Date();
    let age = now.getFullYear() - yyyy;
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const hadBirthday = (m > mm) || (m === mm && d >= dd);
    if (!hadBirthday) age -= 1;
    return String(age);
  } catch {
    return '';
  }
}

async function downloadToTemp(urlOrPath: string): Promise<string> {
  // If given an absolute local path, use it directly
  if (urlOrPath.startsWith('/') || /^[a-zA-Z]:\\/.test(urlOrPath)) return urlOrPath;

  // Otherwise assume URL – use global fetch (Node 18+)
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
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel) as HTMLSelectElement | null;
    return el && el.options && el.options.length > 1;
  }, nextSelector);
}

// ---------- Health ----------
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// ---------- Main route ----------
app.post('/api/police/submit/tenant', async (req, res) => {
  const p: PoliceFormData = req.body;
  try { assertDOB_DDMMYYYY(p.date_of_birth); } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  // Defaults
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

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await page.goto('https://www.police.rajasthan.gov.in/old/verificationform.aspx', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Switch to Tenant Uploads tab if present
    const tenantTab = page.locator('text=Tenant Uploads');
    if (await tenantTab.count()) {
      await tenantTab.first().click();
      await page.waitForLoadState('networkidle');
    }

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

    // Cascading selects: Tenant location
    if (await page.locator('#ContentPlaceHolder1_ddlTState').count()) {
      await selectWithPostback(page, '#ContentPlaceHolder1_ddlTState', p.tenant_state, '#ContentPlaceHolder1_ddlTDistrict');
      await selectWithPostback(page, '#ContentPlaceHolder1_ddlTDistrict', p.tenant_police_district, '#ContentPlaceHolder1_ddlTStation');
      await selectIfExists(page, ['#ContentPlaceHolder1_ddlTStation', '#ContentPlaceHolder1_ddlTPoliceStation'], p.tenant_police_station);
    }

    // Address & purpose
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

    // Landlord district/station (postback)
    if (await page.locator('#ContentPlaceHolder1_ddlLdistrict, #ContentPlaceHolder1_ddlLDistrict').count()) {
      const lDistSel = (await page.locator('#ContentPlaceHolder1_ddlLdistrict').count()) ? '#ContentPlaceHolder1_ddlLdistrict' : '#ContentPlaceHolder1_ddlLDistrict';
      const lNext = (await page.locator('#ContentPlaceHolder1_ddlLStation').count()) ? '#ContentPlaceHolder1_ddlLStation' : '#ContentPlaceHolder1_ddlLPoliceStation';
      await selectWithPostback(page, lDistSel, def.landlordDistrict, lNext);
      await selectIfExists(page, ['#ContentPlaceHolder1_ddlLStation', '#ContentPlaceHolder1_ddlLPoliceStation'], def.landlordStation);
    }

    await setIfExists(page, ['#ContentPlaceHolder1_txtLRefer'], def.referencedBy);

    // Files
    const tenantPhoto = await downloadToTemp(p.passport_photo_url);
    await page.setInputFiles('#ContentPlaceHolder1_flTPhoto', tenantPhoto).catch(() => {});
    if (p.combined_id_photo_url) {
      const idPhoto = await downloadToTemp(p.combined_id_photo_url);
      await page.setInputFiles('#ContentPlaceHolder1_flTPhotoId', idPhoto).catch(() => {});
    }

    // Submit
    const SAVE_BTN = '#ContentPlaceHolder1_btnTSave, #ContentPlaceHolder1_btnSubmit';
    await page.waitForSelector(SAVE_BTN, { state: 'visible' });
    const prevHtml = await page.content();
    await Promise.all([
      page.click(SAVE_BTN),
      page.waitForLoadState('networkidle'),
      page.waitForFunction(
        (oldHtml) => document.documentElement.innerHTML !== oldHtml,
        prevHtml,
        { timeout: 25000 }
      ),
    ]);

    // Check for validation errors
    const hasError = await page.evaluate(() => {
      const summary = document.querySelector('.validation-summary,.ValidationSummary');
      const spans = Array.from(document.querySelectorAll('span'));
      const withErr = spans.some(s => /required|invalid|please select|enter/i.test(s.textContent || ''));
      return !!summary || withErr;
    });
    if (hasError) {
      throw new Error('Validation error on target site. Check required fields / formats.');
    }

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

    res.json({ ok: true, referenceNo });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`🚔 Police Form Automation Service running on :${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
