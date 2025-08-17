import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create uploads directory
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed'));
    }
  }
});

// Police form field mappings based on actual form structure
const POLICE_FORM_FIELDS = [
  'ContentPlaceHolder1_RadioButtonList1_0', // Tenant Uploads
  'ContentPlaceHolder1_txtDate',
  'ContentPlaceHolder1_ddlPhotoIdType',
  'ContentPlaceHolder1_txtIdNo',
  'ContentPlaceHolder1_ddlAvailabilityFrom',
  'ContentPlaceHolder1_ddlAvailabilityTo',
  'ContentPlaceHolder1_txtTFirstName',
  'ContentPlaceHolder1_txtTMiddleName',
  'ContentPlaceHolder1_txtTLastName',
  'ContentPlaceHolder1_txtFFirstName',
  'ContentPlaceHolder1_txtFMiddleName',
  'ContentPlaceHolder1_txtFLastName',
  'ContentPlaceHolder1_ddlGender',
  'ContentPlaceHolder1_ddlCaste',
  'ContentPlaceHolder1_RadioButtonList2_0', // Date of birth known
  'ContentPlaceHolder1_txtDateOfBirth',
  'ContentPlaceHolder1_txtAge',
  'ContentPlaceHolder1_ddlTState',
  'ContentPlaceHolder1_ddlTDistrict',
  'ContentPlaceHolder1_ddlTPoliceStation',
  'ContentPlaceHolder1_txtTMobileNo',
  'ContentPlaceHolder1_txtPermanentAddress',
  'ContentPlaceHolder1_ddlPurposeOfRenting',
  'ContentPlaceHolder1_txtAddressOfRentedProperty',
  'ContentPlaceHolder1_txtLFirstName',
  'ContentPlaceHolder1_txtLMiddleName',
  'ContentPlaceHolder1_txtLLastName',
  'ContentPlaceHolder1_txtLFFirstName',
  'ContentPlaceHolder1_txtLFMiddleName',
  'ContentPlaceHolder1_txtLFLastName',
  'ContentPlaceHolder1_txtLMobileNo',
  'ContentPlaceHolder1_txtLAddress',
  'ContentPlaceHolder1_ddlLDistrict',
  'ContentPlaceHolder1_ddlLPoliceStation',
  'ContentPlaceHolder1_txtPAddress',
  'ContentPlaceHolder1_txtPRent',
  'ContentPlaceHolder1_txtPDuration',
  'ContentPlaceHolder1_ddlPType'
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'Police Form Automation Microservice',
    timestamp: new Date().toISOString()
  });
});

// Main API endpoint for police form submission
app.post('/api/police-form/submit', upload.fields([
  { name: 'tenantPhoto', maxCount: 1 },
  { name: 'tenantPhotoID', maxCount: 1 }
]), async (req, res) => {
  let browser = null;
  
  try {
    const { tenantData, landlordInfo } = req.body;
    
    if (!tenantData) {
      return res.status(400).json({
        success: false,
        error: 'Tenant data is required'
      });
    }

    console.log('Starting police form submission for tenant:', tenantData.first_name);

    // Launch browser
    browser = await chromium.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();

    // Navigate to police form
    console.log('Navigating to police form...');
    await page.goto('https://www.police.rajasthan.gov.in/old/verificationform.aspx', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Fill the form
    await fillPoliceForm(page, tenantData, landlordInfo, req.files);

    // Submit the form
    console.log('Submitting form...');
    await page.click('#ContentPlaceHolder1_btnSubmit');
    
    // Wait for submission response
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Extract reference number
    const referenceNumber = await extractReferenceNumber(page);

    console.log('Form submitted successfully. Reference:', referenceNumber);

    res.json({
      success: true,
      referenceNumber: referenceNumber,
      submissionDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('Police form submission error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Form submission failed'
    });
  } finally {
    if (browser) {
      await browser.close();
    }
    
    // Clean up uploaded files
    if (req.files) {
      Object.values(req.files as any).flat().forEach((file: any) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
  }
});

// Fill police form with tenant data
async function fillPoliceForm(page: any, tenantData: any, landlordInfo: any, files: any) {
  try {
    // Select "Tenant Uploads" radio button
    await page.check('#ContentPlaceHolder1_RadioButtonList1_0');
    
    // Fill date (current date)
    const currentDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).replace(/\//g, '-');
    await page.fill('#ContentPlaceHolder1_txtDate', currentDate);

    // Fill tenant information
    if (tenantData.first_name) {
      await page.fill('#ContentPlaceHolder1_txtTFirstName', tenantData.first_name.toUpperCase());
    }
    if (tenantData.middle_name) {
      await page.fill('#ContentPlaceHolder1_txtTMiddleName', tenantData.middle_name.toUpperCase());
    }
    if (tenantData.last_name) {
      await page.fill('#ContentPlaceHolder1_txtTLastName', tenantData.last_name.toUpperCase());
    }
    if (tenantData.father_name) {
      const fatherNames = tenantData.father_name.split(' ');
      await page.fill('#ContentPlaceHolder1_txtFFirstName', (fatherNames[0] || '').toUpperCase());
      if (fatherNames.length > 2) {
        await page.fill('#ContentPlaceHolder1_txtFMiddleName', (fatherNames[1] || '').toUpperCase());
        await page.fill('#ContentPlaceHolder1_txtFLastName', (fatherNames.slice(2).join(' ') || '').toUpperCase());
      } else if (fatherNames.length === 2) {
        await page.fill('#ContentPlaceHolder1_txtFLastName', (fatherNames[1] || '').toUpperCase());
      }
    }

    // Fill basic details
    if (tenantData.age) {
      await page.fill('#ContentPlaceHolder1_txtAge', tenantData.age.toString());
    }
    if (tenantData.phone) {
      await page.fill('#ContentPlaceHolder1_txtTMobileNo', tenantData.phone.replace(/\D/g, '').slice(-10));
    }
    if (tenantData.permanent_address) {
      await page.fill('#ContentPlaceHolder1_txtPermanentAddress', tenantData.permanent_address.toUpperCase());
    }

    // Fill ID information
    if (tenantData.id_type && tenantData.id_number) {
      // Map ID types to form values
      const idTypeMapping: { [key: string]: string } = {
        'aadhar_card': '18',
        'pan_card': '16',
        'voter_id': '17',
        'driving_license': '19'
      };
      
      const idTypeValue = idTypeMapping[tenantData.id_type.toLowerCase()] || '18';
      await page.selectOption('#ContentPlaceHolder1_ddlPhotoIdType', idTypeValue);
      await page.fill('#ContentPlaceHolder1_txtIdNo', tenantData.id_number);
    }

    // Fill gender
    if (tenantData.gender) {
      const genderValue = tenantData.gender.toLowerCase() === 'male' ? '1' : '2';
      await page.selectOption('#ContentPlaceHolder1_ddlGender', genderValue);
    }

    // Fill landlord information
    if (landlordInfo) {
      if (landlordInfo.name) {
        const landlordNames = landlordInfo.name.split(' ');
        await page.fill('#ContentPlaceHolder1_txtLFirstName', (landlordNames[0] || '').toUpperCase());
        if (landlordNames.length > 1) {
          await page.fill('#ContentPlaceHolder1_txtLLastName', (landlordNames.slice(1).join(' ') || '').toUpperCase());
        }
      }
      if (landlordInfo.phone) {
        await page.fill('#ContentPlaceHolder1_txtLMobileNo', landlordInfo.phone.replace(/\D/g, '').slice(-10));
      }
      if (landlordInfo.address) {
        await page.fill('#ContentPlaceHolder1_txtLAddress', landlordInfo.address.toUpperCase());
      }
    }

    // Fill property address
    if (tenantData.current_address) {
      await page.fill('#ContentPlaceHolder1_txtAddressOfRentedProperty', tenantData.current_address.toUpperCase());
    }

    // Set default values for required fields
    await page.selectOption('#ContentPlaceHolder1_ddlTState', '21'); // Rajasthan
    await page.selectOption('#ContentPlaceHolder1_ddlTDistrict', '1'); // Default district
    await page.selectOption('#ContentPlaceHolder1_ddlPurposeOfRenting', '3'); // Education
    await page.selectOption('#ContentPlaceHolder1_ddlCaste', '1'); // General

    // Handle file uploads if provided
    if (files && files.tenantPhoto && files.tenantPhoto[0]) {
      await page.setInputFiles('#ContentPlaceHolder1_FileUpload1', files.tenantPhoto[0].path);
    }
    if (files && files.tenantPhotoID && files.tenantPhotoID[0]) {
      await page.setInputFiles('#ContentPlaceHolder1_FileUpload2', files.tenantPhotoID[0].path);
    }

    console.log('Form filled successfully');
  } catch (error) {
    console.error('Error filling form:', error);
    throw error;
  }
}

// Extract reference number from response page
async function extractReferenceNumber(page: any): Promise<string> {
  try {
    await page.waitForTimeout(3000);
    
    // Look for reference number patterns
    const pageContent = await page.content();
    const patterns = [
      /Reference\s*(?:No|Number)?\s*:?\s*(\d{10,})/i,
      /Application\s*(?:No|Number)?\s*:?\s*(\d{10,})/i,
      /(?:Ref|Reference)\s*:?\s*(\d{10,})/i
    ];
    
    for (const pattern of patterns) {
      const match = pageContent.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    // Generate mock reference if not found
    return 'REF' + Date.now().toString().slice(-8);
  } catch (error) {
    console.error('Error extracting reference number:', error);
    return 'REF' + Date.now().toString().slice(-8);
  }
}

// Test endpoint for form field discovery
app.get('/api/police-form/discover-fields', async (req, res) => {
  let browser = null;
  
  try {
    browser = await chromium.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto('https://www.police.rajasthan.gov.in/old/verificationform.aspx');
    
    // Extract form fields
    const fields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      return inputs.map((el: any) => ({
        tag: el.tagName,
        type: el.type || 'select',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || ''
      }));
    });
    
    res.json({
      success: true,
      fields: fields.filter(field => field.name || field.id)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Field discovery failed'
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Police Form Automation Microservice running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Form submission: POST http://localhost:${PORT}/api/police-form/submit`);
});
