'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  helperPath,
  productFirewallRuleSpecs,
  summarizeFirewallInspection,
  validatePort,
} = require('../electron/windows-firewall.cjs');

test('packaged firewall helper resolves to app.asar.unpacked instead of the virtual asar path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-firewall-helper-'));
  const virtualDir = path.join(root, 'resources', 'app.asar', 'electron');
  const unpackedDir = path.join(root, 'resources', 'app.asar.unpacked', 'electron');
  fs.mkdirSync(virtualDir, { recursive: true });
  fs.mkdirSync(unpackedDir, { recursive: true });
  fs.writeFileSync(path.join(virtualDir, 'windows-firewall.ps1'), 'virtual');
  fs.writeFileSync(path.join(unpackedDir, 'windows-firewall.ps1'), 'real');
  assert.equal(helperPath(virtualDir), path.join(unpackedDir, 'windows-firewall.ps1'));
});

test('private host rules use stable ports and LocalSubnet instead of portable exe paths', () => {
  const rules = productFirewallRuleSpecs({ tcpPort: 18777, discoveryPort: 18778 });
  assert.equal(rules.length, 2);
  const tcp = rules.find((rule) => rule.protocol === 'TCP');
  const udp = rules.find((rule) => rule.protocol === 'UDP');
  for (const rule of rules) {
    assert.equal(rule.profile, 'Private');
    assert.equal(rule.remoteAddress, 'LocalSubnet');
    assert.equal(rule.direction, 'Inbound');
    assert.equal(rule.action, 'Allow');
    assert.equal(rule.program, undefined);
  }
  assert.equal(tcp.localPort, 18777);
  assert.equal(udp.localPort, 18778);
});

test('repeated inspection collapses duplicate product rules to two active specifications', () => {
  const specs = productFirewallRuleSpecs({ tcpPort: 18777, discoveryPort: 18778 });
  const existing = [...specs, ...specs].map((item, index) => ({ ...item, instanceId: `instance-${index}` }));
  const result = summarizeFirewallInspection({ rules: existing, legacyRules: [], networkProfiles: ['Private'] }, specs);
  assert.equal(result.activeProductRules.length, 2);
  assert.equal(result.duplicateProductRuleCount, 2);
  assert.equal(result.applicableRuleCount, 2);
});

test('legacy rules are diagnosed but never included in automatic deletion', () => {
  const specs = productFirewallRuleSpecs({ tcpPort: 18777, discoveryPort: 18778 });
  const legacyRules = Array.from({ length: 58 }, (_, index) => ({ name: `AI Education Manager legacy ${index}` }));
  const result = summarizeFirewallInspection({ rules: specs, legacyRules, networkProfiles: ['Private'] }, specs);
  assert.equal(result.staleRuleCount, 58);
  assert.equal(result.deletedRuleCount, 0);
  assert.deepEqual(result.legacyRules, legacyRules);
});

test('only valid user ports are accepted', () => {
  assert.equal(validatePort(18777), 18777);
  for (const value of [0, 65536, 1.5, '18777', NaN]) assert.throws(() => validatePort(value));
});
