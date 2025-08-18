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
let serverReady = false;
let playwrightReady = false;
let lastBrowserCheckTime = 0;
const BROWSER_CHECK_CACHE_DURATION = 120000; // Cache browser check result for 2 minutes

// Get timeout from environment or default
const getPlaywrightTimeout = () => {
  const envTimeout = process.env.PLAYWRIGHT_TIMEOUT;
  return envTimeout ? parseInt(envTimeout, 10) : 30000;
};

/* --------------------------- Health Checks ------------------------------ */
app.get('/health', async (_req, res) => {
  // Lightweight health check - just verify server is running
  if (!serverReady) {
    return res.status(503).type('text/plain').send('Server starting...');
  }
  
  // Server is ready - always return 200 for health check
  // Browser readiness is checked separately and cached
  res.status(200).type('text/plain').send('OK');
});

// Add /api/health endpoint for compatibility
app.get('/api/health', async (_req, res) => {
  // Same as /health but under /api path
  if (!serverReady) {
    return res.status(503).json({ status: 'Server starting...', ready: false });
  }
  
  res.status(200).json({ status: 'OK', ready: true });
});

/* ----------------------- Background Browser Check ----------------------- */
async function checkBrowserAvailability(): Promise<boolean> {
  try {
    const timeout = getPlaywrightTimeout();
    console.log('🔍 Testing browser availability...');
    
    const browser = await chromium.launch({ 
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
      timeout: Math.min(timeout, 30000), // Cap at 30s for background checks
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
    
    await browser.close();
    console.log('✅ Browser availability check passed');
    return true;
  } catch (error) {
    console.error('❌ Browser availability check failed:', error);
    return false;
  }
}

/* ----------------------- Browser Status Endpoint ----------------------- */
app.get('/browser-status', async (_req, res) => {
  const now = Date.now();
  
  // Use cached result if recent enough
  if ((now - lastBrowserCheckTime) < BROWSER_CHECK_CACHE_DURATION) {
    return res.json({ 
      ready: playwrightReady, 
      lastChecked: new Date(lastBrowserCheckTime).toISOString(),
      cached: true 
    });
  }
  
  // Perform fresh browser check
  playwrightReady = await checkBrowserAvailability();
  lastBrowserCheckTime = now;
  
  res.json({ 
    ready: playwrightReady, 
    lastChecked: new Date(lastBrowserCheckTime).toISOString(),
    cached: false 
  });
});

// Add /api/browser-status endpoint for consistency
app.get('/api/browser-status', async (_req, res) => {
  const now = Date.now();
  
  // Use cached result if recent enough
  if ((now - lastBrowserCheckTime) < BROWSER_CHECK_CACHE_DURATION) {
    return res.json({ 
      ready: playwrightReady, 
      lastChecked: new Date(lastBrowserCheckTime).toISOString(),
      cached: true 
    });
  }
  
  // Perform fresh browser check
  playwrightReady = await checkBrowserAvailability();
  lastBrowserCheckTime = now;
  
  res.json({ 
    ready: playwrightReady, 
    lastChecked: new Date(lastBrowserCheckTime).toISOString(),
    cached: false 
  });
});

/* ------------------------------- CORS setup ------------------------------- */
/** Static allowlist + env (comma-separated) */
const staticAllow = [
  'https://hostel-hub-tenant-ma-production.up.railway.app',
  'https://anandpg.netlify.app',
  'https://railway.com',
];

// Parse environment origins with robust cleaning
const envAllow = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .filter(s => s.length > 0); // Extra filtering to remove empty strings

const ALLOWLIST = Array.from(new Set([...staticAllow, ...envAllow]));

console.log('🔧 CORS Configuration:');
console.log('📋 Static Origins:', staticAllow);
console.log('📋 Environment Origins:', envAllow);
console.log('📋 Combined Allowed Origins:', ALLOWLIST);
console.log('📋 Environment variable value:', JSON.stringify(process.env.ALLOWED_ORIGINS));

// Function to check if origin is allowed
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    console.log('✅ No origin - allowing (same-origin or non-browser request)');
    return true;
  }

  console.log(`🔍 CORS check for origin: "${origin}"`);
  console.log(`📋 Current allowlist: ${JSON.stringify(ALLOWLIST)}`);
  
  // Check direct match with case sensitivity
  const directMatch = ALLOWLIST.some(allowed => {
    const matches = allowed === origin;
    if (matches) {
      console.log(`✅ Direct match found: "${origin}" === "${allowed}"`);
    }
    return matches;
  });
  
  if (directMatch) {
    return true;
  }
  
  // Check wildcard patterns
  for (const allowed of ALLOWLIST) {
    if (allowed.includes('*')) {
      console.log(`🔍 Checking wildcard pattern: "${allowed}"`);
      
      // Extract the pattern part after *
      let pattern: string;
      if (allowed.includes('://')) {
        // https://*.domain.com -> .domain.com
        const parts = allowed.split('://');
        if (parts[1] && parts[1].startsWith('*')) {
          pattern = parts[1].slice(1); // remove * from *.domain.com
        } else {
          continue;
        }
      } else {
        // *.domain.com -> .domain.com  
        pattern = allowed.slice(1); // remove * from *.domain.com
      }
      
      console.log(`🔍 Extracted pattern: "${pattern}"`);
      console.log(`🔍 Checking if "${origin}" ends with "${pattern}"`);
      
      if (origin.endsWith(pattern)) {
        console.log(`✅ Origin "${origin}" matches wildcard pattern "${allowed}"`);
        return true;
      }
    }
  }
  
  console.log(`❌ Origin "${origin}" not allowed - access denied`);
  console.log(`❌ Available origins: ${JSON.stringify(ALLOWLIST)}`);
  return false;
}

// Simplified CORS configuration using array approach for better reliability
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    try {
      const allowed = isOriginAllowed(origin);
      console.log(`🔍 CORS decision for "${origin}": ${allowed ? 'ALLOWED' : 'DENIED'}`);
      
      if (allowed) {
        callback(null, true);
      } else {
        // Don't use an error - just deny with false to ensure headers are still set
        callback(null, false);
      }
    } catch (error) {
      console.error('🚨 CORS origin check error:', error);
      // In case of error, deny access but don't crash
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  credentials: false,
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: 86400, // 24 hours
};

// Apply CORS middleware globally with error handling
app.use((req, res, next) => {
  console.log(`📍 Incoming ${req.method} ${req.path} from origin: "${req.headers.origin || 'none'}"`);
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      console.error('🚨 CORS middleware error:', err);
      // Set basic CORS headers manually as fallback
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }
    next(err);
  });
});

// Request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path} from origin: "${req.headers.origin || 'none'}"`);
  
  // Log response headers after they're set
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override send method
  res.send = function(body) {
    console.log(`📤 Response headers for ${req.method} ${req.path}:`, {
      'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
      'access-control-allow-methods': res.getHeader('access-control-allow-methods'),
      'access-control-allow-headers': res.getHeader('access-control-allow-headers'),
      'access-control-allow-credentials': res.getHeader('access-control-allow-credentials'),
      'status': res.statusCode
    });
    return originalSend.call(this, body);
  };
  
  // Override json method
  res.json = function(body) {
    console.log(`📤 Response headers for ${req.method} ${req.path}:`, {
      'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
      'access-control-allow-methods': res.getHeader('access-control-allow-methods'),
      'access-control-allow-headers': res.getHeader('access-control-allow-headers'),
      'access-control-allow-credentials': res.getHeader('access-control-allow-credentials'),
      'status': res.statusCode
    });
    return originalJson.call(this, body);
  };
  
  next();
});

// Explicit preflight handling for all routes with comprehensive debugging
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  console.log(`🔍 OPTIONS (preflight) request from origin: "${origin}"`);
  console.log(`🔍 Request headers:`, {
    'origin': origin,
    'access-control-request-method': req.headers['access-control-request-method'],
    'access-control-request-headers': req.headers['access-control-request-headers'],
    'user-agent': req.headers['user-agent']
  });
  
  const allowed = isOriginAllowed(origin);
  console.log(`🔍 Preflight decision for "${origin}": ${allowed ? 'ALLOWED' : 'DENIED'}`);
  
  if (allowed) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.header('Access-Control-Max-Age', '86400');
  
  console.log(`📤 Preflight response headers:`, {
    'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
    'access-control-allow-methods': res.getHeader('access-control-allow-methods'),
    'access-control-allow-headers': res.getHeader('access-control-allow-headers'),
    'access-control-max-age': res.getHeader('access-control-max-age')
  });
  
  res.status(200).end();
});

// Enhanced CORS test endpoint with detailed debugging
app.get('/api/cors-test', (req, res) => {
  const origin = req.headers.origin;
  const userAgent = req.headers['user-agent'];
  const allowed = isOriginAllowed(origin);
  
  console.log(`🔍 CORS test request from origin: "${origin}", allowed: ${allowed}`);
  
  res.json({ 
    message: 'CORS test successful',
    timestamp: new Date().toISOString(),
    origin: origin,
    originAllowed: allowed,
    corsHeaders: {
      'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
      'access-control-allow-methods': res.getHeader('access-control-allow-methods'),
      'access-control-allow-headers': res.getHeader('access-control-allow-headers'),
      'access-control-allow-credentials': res.getHeader('access-control-allow-credentials'),
      'access-control-max-age': res.getHeader('access-control-max-age')
    },
    requestHeaders: {
      origin: origin,
      userAgent: userAgent,
      referer: req.headers.referer,
      host: req.headers.host,
      'access-control-request-method': req.headers['access-control-request-method'],
      'access-control-request-headers': req.headers['access-control-request-headers']
    },
    configuration: {
      allowlist: ALLOWLIST,
      staticOrigins: staticAllow,
      envOrigins: envAllow,
      env: {
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
        NODE_ENV: process.env.NODE_ENV,
      }
    },
    serverInfo: {
      serverReady: serverReady,
      playwrightReady: playwrightReady,
      lastBrowserCheck: lastBrowserCheckTime ? new Date(lastBrowserCheckTime).toISOString() : null
    }
  });
});

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
  
  // Mark server as ready immediately - health checks should pass
  serverReady = true;
  
  // Perform background browser check without blocking startup
  setTimeout(async () => {
    try {
      console.log('🔍 Background browser availability check...');
      playwrightReady = await checkBrowserAvailability();
      lastBrowserCheckTime = Date.now();
      
      if (playwrightReady) {
        console.log('✅ Browser availability verified in background');
      } else {
        console.log('⚠️  Browser not available - API requests will fail until browsers are ready');
      }
    } catch (error) {
      console.error('❌ Background browser check failed:', error);
      playwrightReady = false;
    }
  }, 2000); // Start browser check 2 seconds after server startup
  
  return true;
}

/* ----------------------- Enhanced Browser Management ---------------------- */
async function launchBrowserWithRetry(maxRetries = 3): Promise<any> {
  const timeout = getPlaywrightTimeout();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to launch browser (attempt ${attempt}/${maxRetries}) with ${timeout}ms timeout...`);
      
      const browser = await chromium.launch({ 
        headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
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
      
      // Wait before retry with exponential backoff
      const delay = 2000 * Math.pow(2, attempt - 1);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
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

  if (!serverReady) {
    return res.status(503).json({ ok: false, error: 'Server not ready yet, please try again' });
  }

  // Check browser availability with current cache
  const now = Date.now();
  if ((now - lastBrowserCheckTime) >= BROWSER_CHECK_CACHE_DURATION) {
    // Refresh browser status in background
    setTimeout(async () => {
      playwrightReady = await checkBrowserAvailability();
      lastBrowserCheckTime = Date.now();
    }, 0);
  }

  if (!playwrightReady) {
    return res.status(503).json({ 
      ok: false, 
      error: 'Browser services not available yet, please try again in a moment',
      hint: 'Check /browser-status for current browser availability'
    });
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
    console.log(`📊 Environment: NODE_ENV=${process.env.NODE_ENV}`);
    console.log(`📊 Playwright Headless: ${process.env.PLAYWRIGHT_HEADLESS !== 'false'}`);
    console.log(`📊 Playwright Timeout: ${getPlaywrightTimeout()}ms`);
    console.log(`📊 Port: ${port}`);
    
    // Perform startup readiness checks
    await performStartupReadinessCheck();
    
    // Start the server
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`🚦 Server ready and listening on 0.0.0.0:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`📊 API Health check: http://localhost:${port}/api/health`);
      console.log(`🔍 Browser status: http://localhost:${port}/browser-status`);
      console.log(`🔍 API Browser status: http://localhost:${port}/api/browser-status`);
      console.log(`🔗 Police form API: http://localhost:${port}/api/police/submit/tenant`);
      console.log(`✅ Service is operational (server=${serverReady}, browser_check_in_progress)`);
      console.log(`💡 Browser availability will be verified in background`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('💡 This is likely due to Playwright browser unavailability in production');
    process.exit(1);
  }
}

// Start the server
startServer();
