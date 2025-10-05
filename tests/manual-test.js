/**
 * Manual test script for the Amount Detection API
 * Run with: node tests/manual-test.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Test data
const testCases = [
  {
    name: 'Test 1: Simple text with clear labels',
    endpoint: '/api/extract',
    data: {
      text: 'Total: INR 1200 | Paid: 1000 | Due: 200 | Discount: 10%'
    }
  },
  {
    name: 'Test 2: OCR errors simulation',
    endpoint: '/api/final',
    data: {
      text: 'T0tal: Rs l200 | Pald: 1O00 | Due: 2OO | Balance: 200'
    }
  },
  {
    name: 'Test 3: Normalization only',
    endpoint: '/api/normalize',
    data: {
      raw_tokens: ['l200', '1O00', '2OO', '10%', 'Rs.500']
    }
  },
  {
    name: 'Test 4: Classification with context',
    endpoint: '/api/classify',
    data: {
      text: 'Bill Total: 5000\nAmount Paid: 3000\nBalance Due: 2000',
      normalized_amounts: [5000, 3000, 2000]
    }
  },
  {
    name: 'Test 5: Noisy document (Guardrail test)',
    endpoint: '/api/final',
    data: {
      text: 'This is a document with no numbers or amounts in it at all.'
    }
  },
  {
    name: 'Test 6: Medical bill format',
    endpoint: '/api/final',
    data: {
      text: `
        MEDICAL BILL
        Patient: John Doe
        Date: 2024-01-15
        
        Consultation Fee: Rs 500
        Lab Tests: Rs 1500
        Medicines: Rs 800
        
        Subtotal: Rs 2800
        GST (18%): Rs 504
        Total Bill: Rs 3304
        
        Amount Paid: Rs 2000
        Balance Due: Rs 1304
      `
    }
  },
  {
    name: 'Test 7: Multiple currencies',
    endpoint: '/api/extract',
    data: {
      text: 'Total: $100 | Paid: €80 | Due: £20'
    }
  }
];

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

async function runTest(testCase, index) {
  console.log(`\n${colors.cyan}${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}${testCase.name}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
  
  try {
    const startTime = Date.now();
    const response = await axios.post(`${BASE_URL}${testCase.endpoint}`, testCase.data);
    const duration = Date.now() - startTime;
    
    console.log(`${colors.green}✓ Success${colors.reset} (${duration}ms)`);
    console.log(`\n${colors.bold}Response:${colors.reset}`);
    console.log(JSON.stringify(response.data, null, 2));
    
    return { success: true, name: testCase.name };
  } catch (error) {
    console.log(`${colors.red}✗ Failed${colors.reset}`);
    if (error.response) {
      console.log(`${colors.red}Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.bold}Error Response:${colors.reset}`);
      console.log(JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
    }
    
    return { success: false, name: testCase.name, error: error.message };
  }
}

async function checkHealth() {
  console.log(`${colors.yellow}Checking server health...${colors.reset}`);
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log(`${colors.green}✓ Server is healthy${colors.reset}`);
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.log(`${colors.red}✗ Server is not responding${colors.reset}`);
    console.log(`${colors.red}Make sure the server is running: npm start${colors.reset}`);
    return false;
  }
}

async function runAllTests() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     AI Amount Detection API - Test Suite             ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  // Check server health first
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    process.exit(1);
  }
  
  const results = [];
  
  for (let i = 0; i < testCases.length; i++) {
    const result = await runTest(testCases[i], i + 1);
    results.push(result);
    
    // Wait a bit between tests
    if (i < testCases.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Print summary
  console.log(`\n${colors.cyan}${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}TEST SUMMARY${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\nTotal Tests: ${testCases.length}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  
  if (failed > 0) {
    console.log(`\n${colors.red}Failed Tests:${colors.reset}`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`  ${colors.red}✗${colors.reset} ${r.name}`);
    });
  }
  
  console.log(`\n${colors.cyan}${colors.bold}═══════════════════════════════════════════════${colors.reset}\n`);
}

// Run tests
runAllTests().catch(console.error);