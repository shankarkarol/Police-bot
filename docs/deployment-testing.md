# Police Bot Deployment Testing Guide

This guide explains how to verify that the Police Bot service is properly deployed and functioning correctly.

## Quick Testing

### Automated Testing

Run the automated deployment verification script:

```bash
# Test against production
npm run test:deployment:prod

# Test against local development server
npm run test:deployment:local

# Test against custom URL
npm run test:deployment -- https://your-custom-url.com
```

### Manual Testing

You can also test endpoints manually using curl or any HTTP client:

## Endpoint Testing

### 1. Service Accessibility

```bash
curl -i https://police-bot-production.up.railway.app
```

**Expected Response:** HTTP 404 (service is accessible but no root route)

### 2. Health Check

```bash
curl -i https://police-bot-production.up.railway.app/health
```

**Expected Response:** 
- HTTP 200 
- Body: `OK`

### 3. API Health Check

```bash
curl -i https://police-bot-production.up.railway.app/api/health
```

**Expected Response:**
- HTTP 200
- Body: `{"status":"OK","ready":true}`

### 4. Browser Status

```bash
curl -i https://police-bot-production.up.railway.app/api/browser-status
```

**Expected Response:**
- HTTP 200
- Body: JSON with browser readiness status

### 5. Police Form Submit Endpoint (Test Mode)

```bash
curl -X POST https://police-bot-production.up.railway.app/api/police-form/submit \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Expected Response:**
- HTTP 200
- Body: JSON with test confirmation and server status

### 6. Legacy Police Submit Endpoint (Test Mode)

```bash
curl -X POST https://police-bot-production.up.railway.app/api/police/submit/tenant \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Expected Response:**
- HTTP 400 (validation error for incomplete data)
- Body: JSON with error message about missing required fields

### 7. CORS Test

```bash
curl -i https://police-bot-production.up.railway.app/api/cors-test
```

**Expected Response:**
- HTTP 200
- Body: JSON with CORS test confirmation

## Full Functional Testing

### Police Form Submission (Production)

To test the actual form submission functionality, you need to provide all required fields:

```bash
curl -X POST https://police-bot-production.up.railway.app/api/police/submit/tenant \
  -H "Content-Type: application/json" \
  -d '{
    "id_type": "AADHAR CARD",
    "id_number": "123456789012",
    "first_name": "John",
    "last_name": "Doe", 
    "father_first_name": "Robert",
    "father_last_name": "Doe",
    "caste": "GENERAL",
    "date_of_birth": "01-01-1990",
    "tenant_state": "RAJASTHAN",
    "tenant_police_district": "JAIPUR EAST", 
    "tenant_police_station": "CIVIL LINES",
    "phone": "9876543210",
    "permanent_address": "123 Main St, Jaipur",
    "passport_photo_url": "https://example.com/photo.jpg"
  }'
```

**Expected Response:**
- HTTP 200: Form submitted successfully with reference number
- HTTP 400: Validation error 
- HTTP 503: Server or browser not ready

## Troubleshooting

### Common Issues

#### 1. Connection Timeouts

**Symptoms:** Requests fail with timeout errors

**Solutions:**
- Check if the service URL is correct
- Verify network connectivity
- Try increasing timeout values in the test script

#### 2. Service Unavailable (503)

**Symptoms:** HTTP 503 responses

**Possible Causes:**
- Server is starting up (temporary)
- Browser automation services not ready
- High load on the service

**Solutions:**
- Wait a few minutes and retry
- Check `/api/browser-status` for browser availability
- Contact system administrator if persists

#### 3. CORS Errors

**Symptoms:** CORS-related errors in browser console

**Solutions:**
- Verify the origin is in the allowed list
- Check CORS configuration
- Use server-side requests instead of browser requests

#### 4. Validation Errors (400)

**Symptoms:** HTTP 400 with validation error messages

**Solutions:**
- Check required fields in the request
- Verify data formats (especially date_of_birth as DD-MM-YYYY)
- Review the API documentation

### Environment Variables

The service behavior can be configured with these environment variables:

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)
- `PLAYWRIGHT_TIMEOUT`: Browser operation timeout in ms
- `PLAYWRIGHT_HEADLESS`: Run browser in headless mode (true/false)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins

### Monitoring

#### Health Monitoring

Set up monitoring for these endpoints:

1. `GET /health` - Basic server health
2. `GET /api/browser-status` - Browser automation health
3. Test submission with `{"test": true}` payload

#### Expected Response Times

- Health checks: < 500ms
- Browser status: < 2s
- Test submissions: < 5s
- Full form submissions: 30-60s (depending on external site)

### Alerting

Consider setting up alerts for:

- Health check failures
- Browser unavailability for > 5 minutes
- Response time > 60s for form submissions
- Error rate > 5% over 15 minutes

## Advanced Testing

### Load Testing

For load testing, use the test endpoints:

```bash
# Simple load test with curl
for i in {1..10}; do
  curl -X POST https://police-bot-production.up.railway.app/api/police-form/submit \
    -H "Content-Type: application/json" \
    -d '{"test": true}' &
done
wait
```

### Monitoring Scripts

Create monitoring scripts that run the deployment tests periodically:

```bash
#!/bin/bash
# monitoring.sh

while true; do
  echo "Running health check at $(date)"
  npm run test:deployment:prod
  
  if [ $? -eq 0 ]; then
    echo "✅ All tests passed"
  else
    echo "❌ Some tests failed - check logs"
    # Add notification logic here (email, Slack, etc.)
  fi
  
  sleep 300  # Check every 5 minutes
done
```

## Integration with CI/CD

### GitHub Actions

See `.github/workflows/deployment-test.yml` for automated testing in CI/CD pipeline.

### Manual Deployment Verification

After each deployment:

1. Wait 2-3 minutes for service to fully start
2. Run `npm run test:deployment:prod`
3. Verify all tests pass
4. Check browser status endpoint separately
5. Perform one manual form submission test

## Support

If you encounter issues not covered in this guide:

1. Check the server logs in Railway dashboard
2. Verify all environment variables are set correctly
3. Test against a local development instance
4. Contact the development team with specific error messages and request details