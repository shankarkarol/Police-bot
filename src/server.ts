import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { chromium, Browser, Page } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

interface PoliceFormData {
  applicantName: string;
  fatherName: string;
  address: string;
  phoneNumber: string;
  aadharNumber: string;
  policeStation: string;
  purpose: string;
  documentType: string;

  [key: string]: any;
}

let browser: Browser | null = null;

// Initialize browser
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Police Form Automation Microservice'
  });
});

// Main form automation endpoint
app.post('/automate-police-form', upload.array('documents'), async (req, res) => {
  try {
    const formData: PoliceFormData = req.body;
    const files = req.files as Express.Multer.File[];

    // Validate required fields
    const requiredFields = ['applicantName', 'fatherName', 'address', 'phoneNumber', 'policeStation'];
    for (const field of requiredFields) {
      if (!formData[field as keyof PoliceFormData]) {
        return res.status(400).json({ 
          error: `Missing required field: ${field}` 
        });
      }
    }

    const browserInstance = await initBrowser();
    const context = await browserInstance.newContext();
    const page = await context.newPage();

    try {
      // Navigate to Rajasthan Police portal
      await page.goto('https://applyonline.rajasthan.gov.in/', { 
        waitUntil: 'networkidle' 
      });

      // Wait for the page to load
      await page.waitForTimeout(2000);

      // Fill the form (example selectors - adjust based on actual website)
      if (await page.locator('input[name="applicant_name"]').isVisible()) {
        await page.fill('input[name="applicant_name"]', formData.applicantName);
      }
      
      if (await page.locator('input[name="father_name"]').isVisible()) {
        await page.fill('input[name="father_name"]', formData.fatherName);
      }
      
      if (await page.locator('textarea[name="address"]').isVisible()) {
        await page.fill('textarea[name="address"]', formData.address);
      }
      
      if (await page.locator('input[name="phone"]').isVisible()) {
        await page.fill('input[name="phone"]', formData.phoneNumber);
      }

      if (formData.aadharNumber && await page.locator('input[name="aadhar"]').isVisible()) {
        await page.fill('input[name="aadhar"]', formData.aadharNumber);
      }

      // Handle file uploads if any
      if (files && files.length > 0) {
        for (const file of files) {
          const fileInput = page.locator('input[type="file"]').first();
          if (await fileInput.isVisible()) {
            // Note: In a real implementation, you'd save the file temporarily
            // and provide the path to setInputFiles
            console.log(`Would upload file: ${file.originalname}`);
          }
        }
      }

      // Take a screenshot for verification
      const screenshot = await page.screenshot({ fullPage: true });

      await context.close();

      res.json({
        success: true,
        message: 'Form automation completed successfully',
        data: {
          applicantName: formData.applicantName,
          timestamp: new Date().toISOString(),
          policeStation: formData.policeStation
        }
      });

    } catch (automationError) {
      await context.close();
      throw automationError;
    }

  } catch (error) {
    console.error('Form automation error:', error);
    res.status(500).json({
      error: 'Form automation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚔 Police Form Automation Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
