/**
 * Police Bot Deployment Verification and API Testing Script
 * 
 * This script verifies that the police bot service is properly deployed
 * and that API endpoints are functioning correctly.
 */

// Configuration
const DEFAULT_BASE_URL = 'https://police-bot-production.up.railway.app';
const TIMEOUT_MS = 30000; // 30 seconds
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration: number;
  details?: any;
}

interface TestConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

class DeploymentTester {
  private config: TestConfig;
  private results: TestResult[] = [];

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.config = {
      baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: TIMEOUT_MS,
      retries: RETRY_COUNT
    };
  }

  /**
   * Run all deployment verification tests
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Police Bot Deployment Verification Tests');
    console.log(`📍 Target URL: ${this.config.baseUrl}`);
    console.log(`⏱️  Timeout: ${this.config.timeout}ms`);
    console.log(`🔄 Retries: ${this.config.retries}`);
    console.log('─'.repeat(60));

    // Test suite
    await this.testServiceAccessibility();
    await this.testHealthEndpoint();
    await this.testApiHealthEndpoint();
    await this.testBrowserStatusEndpoint();
    await this.testPoliceFormSubmitEndpoint();
    await this.testLegacyPoliceSubmitEndpoint();
    await this.testCorsEndpoint();

    // Print summary
    this.printSummary();
  }

  /**
   * Test if the service URL is accessible
   */
  private async testServiceAccessibility(): Promise<void> {
    const testName = 'Service Accessibility';
    const startTime = Date.now();

    try {
      const response = await this.fetchWithRetry(this.config.baseUrl, {
        method: 'GET'
      });

      const duration = Date.now() - startTime;
      
      if (response.status === 200 || response.status === 404) {
        // 404 is acceptable for root path - service is accessible
        this.results.push({
          name: testName,
          success: true,
          message: `Service accessible (HTTP ${response.status})`,
          duration,
          details: { status: response.status, url: this.config.baseUrl }
        });
      } else {
        this.results.push({
          name: testName,
          success: false,
          message: `Unexpected status code: ${response.status}`,
          duration,
          details: { status: response.status, url: this.config.baseUrl }
        });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.results.push({
        name: testName,
        success: false,
        message: `Connection failed: ${error.message}`,
        duration,
        details: { error: error.message, url: this.config.baseUrl }
      });
    }
  }

  /**
   * Test the /health endpoint
   */
  private async testHealthEndpoint(): Promise<void> {
    await this.testEndpoint('Health Check', '/health', 'GET', undefined, 200);
  }

  /**
   * Test the /api/health endpoint
   */
  private async testApiHealthEndpoint(): Promise<void> {
    await this.testEndpoint('API Health Check', '/api/health', 'GET', undefined, 200);
  }

  /**
   * Test the /browser-status endpoint
   */
  private async testBrowserStatusEndpoint(): Promise<void> {
    await this.testEndpoint('Browser Status', '/api/browser-status', 'GET', undefined, 200);
  }

  /**
   * Test the /api/police-form/submit endpoint (as specified in requirements)
   */
  private async testPoliceFormSubmitEndpoint(): Promise<void> {
    const testData = { test: true };
    await this.testEndpoint(
      'Police Form Submit Endpoint',
      '/api/police-form/submit',
      'POST',
      testData,
      [200, 400, 422] // Accept various valid response codes
    );
  }

  /**
   * Test the legacy /api/police/submit/tenant endpoint
   */
  private async testLegacyPoliceSubmitEndpoint(): Promise<void> {
    const testData = { test: true };
    await this.testEndpoint(
      'Legacy Police Submit Endpoint',
      '/api/police/submit/tenant',
      'POST',
      testData,
      [200, 400, 422] // Accept various valid response codes
    );
  }

  /**
   * Test the CORS endpoint
   */
  private async testCorsEndpoint(): Promise<void> {
    await this.testEndpoint('CORS Test', '/api/cors-test', 'GET', undefined, 200);
  }

  /**
   * Generic endpoint testing method
   */
  private async testEndpoint(
    testName: string,
    endpoint: string,
    method: string,
    data?: any,
    expectedStatus: number | number[] = 200
  ): Promise<void> {
    const startTime = Date.now();
    const url = `${this.config.baseUrl}${endpoint}`;

    try {
      const options: any = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Police-Bot-Deployment-Tester/1.0.0'
        }
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
      }

      const response = await this.fetchWithRetry(url, options);
      const duration = Date.now() - startTime;
      
      let responseBody: any;
      try {
        const text = await response.text();
        responseBody = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text;
      } catch {
        responseBody = 'Unable to parse response';
      }

      const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      const success = expectedStatuses.includes(response.status);

      this.results.push({
        name: testName,
        success,
        message: success 
          ? `✅ ${method} ${endpoint} (HTTP ${response.status})`
          : `❌ Expected status ${expectedStatuses.join('|')}, got ${response.status}`,
        duration,
        details: {
          url,
          method,
          status: response.status,
          response: responseBody,
          expectedStatus: expectedStatuses
        }
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.results.push({
        name: testName,
        success: false,
        message: `❌ Request failed: ${error.message}`,
        duration,
        details: {
          url,
          method,
          error: error.message
        }
      });
    }
  }

  /**
   * Fetch with retry logic and timeout handling
   */
  private async fetchWithRetry(url: string, options: any): Promise<Response> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${this.config.retries}: ${options.method || 'GET'} ${url}`);
        
        // Use dynamic import for fetch since this will be compiled to JS
        const { default: fetch } = await import('node-fetch');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        }) as any;
        
        clearTimeout(timeoutId);
        return response;

      } catch (error: any) {
        lastError = error;
        console.log(`⚠️ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < this.config.retries) {
          console.log(`⏳ Waiting ${RETRY_DELAY_MS}ms before retry...`);
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print test results summary
   */
  private printSummary(): void {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('═'.repeat(60));

    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const failed = total - successful;

    // Print individual results
    this.results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`${index + 1}. ${status} ${result.name} (${duration})`);
      console.log(`   ${result.message}`);
      
      if (!result.success && result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }
      console.log('');
    });

    // Overall summary
    console.log('─'.repeat(60));
    console.log(`📈 OVERALL: ${successful}/${total} tests passed`);
    
    if (failed > 0) {
      console.log(`❌ ${failed} test(s) failed`);
      console.log('🔧 Check the details above for troubleshooting information');
    } else {
      console.log('🎉 All tests passed! Deployment is healthy.');
    }

    console.log('═'.repeat(60));

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || DEFAULT_BASE_URL;

  console.log('🤖 Police Bot Deployment Verification Tool');
  console.log('─'.repeat(60));

  const tester = new DeploymentTester(baseUrl);
  await tester.runAllTests();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { DeploymentTester, TestResult, TestConfig };