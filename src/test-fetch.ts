/**
 * Test script to fetch a URL and display results
 * Run with: npx tsx src/test-fetch.ts [url]
 */

import { fetchUrl, isReachable } from './utils/index.js';

async function testFetch(url: string): Promise<void> {
  console.log('='.repeat(60));
  console.log(`Testing fetch: ${url}`);
  console.log('='.repeat(60));
  console.log();

  // First check if URL is reachable
  console.log('Checking if URL is reachable...');
  const reachable = await isReachable(url);
  console.log(`Reachable: ${reachable}`);
  console.log();

  // Now do a full GET request
  console.log('Performing GET request...');
  const result = await fetchUrl(url, {
    timeout: 10000,
    retries: 2,
    retryDelay: 1000,
  });

  console.log();
  console.log('Result:');
  console.log('-'.repeat(40));
  console.log(`Success: ${result.success}`);
  console.log(`Status: ${result.statusCode || 'N/A'} ${result.statusText || ''}`);
  console.log(`Response time: ${result.responseTime}ms`);

  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  if (result.headers) {
    console.log();
    console.log('Response Headers:');
    for (const [key, value] of Object.entries(result.headers)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  if (result.data) {
    console.log();
    console.log('Response Data:');
    const dataStr = typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data, null, 2);

    // Truncate if too long
    if (dataStr.length > 2000) {
      console.log(dataStr.slice(0, 2000) + '\n... (truncated)');
    } else {
      console.log(dataStr);
    }
  }

  console.log();
  console.log('='.repeat(60));
}

// Run the test
const url = process.argv[2] || 'http://138.68.12.201:3000/';
testFetch(url).catch(console.error);
