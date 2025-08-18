# Police Form Automation Microservice

A standalone microservice for automating Rajasthan Police form submissions using Playwright automation.

## Features

- 🤖 Automated form filling for police applications
- 📁 File upload support for required documents
- 🔒 Secure and stateless design
- 🐳 Docker containerized
- 🚀 Ready for Railway deployment
- 💾 Health check endpoints

## API Endpoints

### Health Check
```http
GET /health
```

### Form Automation
```http
POST /automate-police-form
Content-Type: multipart/form-data
```

**Request Body:**
- `applicantName` (required): Full name of applicant
- `fatherName` (required): Father's name
- `address` (required): Complete address
- `phoneNumber` (required): Contact number
- `aadharNumber` (optional): Aadhar card number
- `policeStation` (required): Police station name
- `purpose` (optional): Purpose of application
- `documentType` (optional): Type of document required
- `documents` (optional): File uploads

## Local Development

1. **Install dependencies:**
```bash
npm install
```

2. **Start development server:**
```bash
npm run dev
```

3. **Build for production:**
```bash
npm run build
npm start
```

## Docker Deployment

1. **Build the image:**
```bash
docker build -t police-form-automation .
```

2. **Run the container:**
```bash
docker run -p 3000:3000 police-form-automation
```

## Railway Deployment

1. Connect your GitHub repository to Railway
2. Set environment variables (if needed):
   - `PORT` (optional, defaults to 3000)
3. Deploy automatically from the main branch

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Usage Example

```javascript
const formData = new FormData();
formData.append('applicantName', 'John Doe');
formData.append('fatherName', 'Robert Doe');
formData.append('address', '123 Main St, Jaipur, Rajasthan');
formData.append('phoneNumber', '9876543210');
formData.append('policeStation', 'Civil Lines Police Station');

// Add file if needed
formData.append('documents', fileInput.files[0]);

fetch('/automate-police-form', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

## Technical Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Automation**: Playwright
- **Language**: TypeScript
- **Container**: Docker
- **Deployment**: Railway

## Deployment Verification and Testing

### Automated Testing

Run comprehensive deployment verification tests:

```bash
# Test production deployment
npm run test:deployment:prod

# Test local development server
npm run test:deployment:local

# Test custom URL
npm run test:deployment -- https://your-custom-url.com
```

### Manual Testing

Quick health checks:

```bash
# Basic health check
curl https://police-bot-production.up.railway.app/health

# API health check with JSON response
curl https://police-bot-production.up.railway.app/api/health

# Test endpoint with sample data
curl -X POST https://police-bot-production.up.railway.app/api/police-form/submit \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Continuous Monitoring

Monitor service health continuously:

```bash
# Start monitoring with default 5-minute intervals
./scripts/monitor.sh

# Monitor with custom interval (in seconds)
./scripts/monitor.sh https://police-bot-production.up.railway.app 120
```

### Documentation

- [Deployment Testing Guide](docs/deployment-testing.md) - Comprehensive testing instructions
- [Troubleshooting Guide](docs/deployment-testing.md#troubleshooting) - Common issues and solutions

## API Endpoints

### Health Check
```http
GET /health
GET /api/health
```

### Browser Status
```http
GET /api/browser-status
```

### Form Automation
```http
POST /api/police/submit/tenant
POST /api/police-form/submit  # Compatibility endpoint
Content-Type: application/json
```

**Test Request:**
```json
{"test": true}
```

**Production Request Body:**
- `id_type` (required): ID card type
- `id_number` (required): ID number
- `first_name` (required): Full name of applicant
- `last_name` (required): Last name
- `father_first_name` (required): Father's first name
- `father_last_name` (required): Father's last name
- `caste` (required): Caste category
- `date_of_birth` (required): Date in DD-MM-YYYY format
- `tenant_state` (required): State name
- `tenant_police_district` (required): Police district
- `tenant_police_station` (required): Police station name
- `phone` (required): Contact number
- `permanent_address` (required): Complete address
- `passport_photo_url` (required): URL to passport photo
- Additional optional fields available

## Security Notes

- All form data is processed in memory
- No persistent storage of sensitive information
- Stateless design for better security
- Input validation on all endpoints

## License

MIT License - see LICENSE file for details
