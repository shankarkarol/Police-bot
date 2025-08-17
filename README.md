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

## Security Notes

- All form data is processed in memory
- No persistent storage of sensitive information
- Stateless design for better security
- Input validation on all endpoints

## License

MIT License - see LICENSE file for details
