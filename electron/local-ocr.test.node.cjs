const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('./local-ocr.cjs');
test('OCR rejects path injection, unsupported formats and oversized input before native dispatch', async () => {
  await assert.rejects(ocr.recognize({ language: 'en-US; command', mime: 'image/png', data: 'YWJj' }), /invalid-language/);
  await assert.rejects(ocr.recognize({ language: 'en-US', mime: 'image/svg+xml', data: 'YWJj' }), /invalid-image/);
  await assert.rejects(ocr.recognize({ language: 'en-US', mime: 'image/png', data: '../private/file' }), /invalid-image/);
  await assert.rejects(ocr.recognize({ language: 'en-US', mime: 'image/png', data: 'a'.repeat(14 * 1024 * 1024 + 1) }), /invalid-image/);
});
