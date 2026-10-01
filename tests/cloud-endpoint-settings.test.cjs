'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkedServerUrl, cloudRequestUrl } = require('../electron/cloud-endpoint.cjs');
test('HTTPS cloud service prefixes survive every request while signed routes remain canonical', () => {
  assert.equal(checkedServerUrl('https://www.greatbg.com/edu-cloud/'), 'https://www.greatbg.com/edu-cloud');
  assert.equal(cloudRequestUrl('https://www.greatbg.com/edu-cloud', '/v1/students?cursor=x'), 'https://www.greatbg.com/edu-cloud/v1/students?cursor=x');
  assert.equal(cloudRequestUrl('http://127.0.0.1:8755', '/health'), 'http://127.0.0.1:8755/health');
  for (const value of ['http://example.com', 'https://name:secret@example.com', 'https://example.com/x?token=y', 'https://example.com/%2e%2e']) assert.throws(() => checkedServerUrl(value));
  for (const value of ['https://bad.com', '//bad.com', '/v1/../x', '/other']) assert.throws(() => cloudRequestUrl('https://example.com', value));
});
