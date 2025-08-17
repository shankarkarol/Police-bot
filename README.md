# Police Form Automation Microservice

A standalone microservice that uses Playwright to automatically fill and submit the Rajasthan Police tenant verification form.

## API Endpoints

### POST /api/police-form/submit
Submits tenant data to the police verification form.

**Request Body:**
```json
{
  "tenantData": {
    "first_name": "John",
    "middle_name": "Kumar",
    "last_name": "Doe",
    "father_name": "Ram Chandra Singh",
    "age": 25,
    "gender": "male",
    "phone": "9876543210",
    "id_type": "aadhar_card",
    "id_number": "123456789012",
    "permanent_address": "123 Main St, City, State",
    "current_address": "456 Hostel St, Jaipur, Rajasthan"
  },
  "landlordInfo": {
    "name": "Landlord Name",
    "phone": "9876543211",
    "address": "Landlord Address, Jaipur"
  }
}
```

**Response:**
```json
{
  "success": true,
  "referenceNumber": "REF123456789",
  "submissionDate": "2025-08-17T17:38:15.000Z"
}
```

### GET /health
Health check endpoint.

### GET /api/police-form/discover-fields
Discovers form fields from the target website (for development).

## Deployment on Railway

1. Create a new repository with these files
2. Connect to Railway.app
3. Set environment variables:
   - `NODE_ENV=production`
   - `PORT=$PORT`
4. Deploy automatically

## Environment Variables

- `NODE_ENV`: Set to "production" for Railway
- `PORT`: Railway assigns automatically
- `PLAYWRIGHT_HEADLESS`: Set to "true" for production
- `PLAYWRIGHT_TIMEOUT`: Optional, defaults to 60000ms

## Usage from Your Main App

Update your main application to call this microservice:

```typescript
const MICROSERVICE_URL = 'https://your-police-microservice.railway.app';

const response = await fetch(`${MICROSERVICE_URL}/api/police-form/submit`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    tenantData: tenantData,
    landlordInfo: landlordInfo
  })
});

const result = await response.json();
```
