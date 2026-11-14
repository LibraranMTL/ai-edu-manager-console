'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const RULE_GROUP = 'AI Education Manager Host';
const RULE_NAMES = Object.freeze({
  tcp: 'AI-Education-Manager-Host-TCP-Private',
  udp: 'AI-Education-Manager-Discovery-UDP-Private',
});

function validatePort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw Error('invalid_firewall_port');
  return value;
}

function productFirewallRuleSpecs({ tcpPort, discoveryPort }) {
  return [
    { name: RULE_NAMES.tcp, displayName: 'AI教育管家 主机服务（专用网络）', group: RULE_GROUP,
      direction: 'Inbound', action: 'Allow', enabled: true, profile: 'Private', remoteAddress: 'LocalSubnet', protocol: 'TCP', localPort: validatePort(tcpPort) },
    { name: RULE_NAMES.udp, displayName: 'AI教育管家 局域网发现（专用网络）', group: RULE_GROUP,
      direction: 'Inbound', action: 'Allow', enabled: true, profile: 'Private', remoteAddress: 'LocalSubnet', protocol: 'UDP', localPort: validatePort(discoveryPort) },
  ];
}

function sameRule(left, right) {
  return left && right && String(left.name) === right.name && String(left.profile) === right.profile
    && String(left.remoteAddress) === right.remoteAddress && String(left.protocol).toUpperCase() === right.protocol
    && Number(left.localPort) === right.localPort && String(left.direction) === right.direction
    && String(left.action) === right.action && left.enabled !== false;
}

function summarizeFirewallInspection(raw = {}, specs = []) {
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  const activeProductRules = [];
  let duplicateProductRuleCount = 0;
  for (const spec of specs) {
    const matches = rules.filter((item) => sameRule(item, spec));
    if (matches.length) activeProductRules.push(spec);
    duplicateProductRuleCount += Math.max(0, matches.length - 1);
  }
  const legacyRules = Array.isArray(raw.legacyRules) ? raw.legacyRules : [];
  const networkProfiles = Array.isArray(raw.networkProfiles) ? raw.networkProfiles.map(String) : [];
  return {
    applicable: process.platform === 'win32',
    networkProfiles,
    rules,
    activeProductRules,
    applicableRuleCount: activeProductRules.length,
    duplicateProductRuleCount,
    staleRuleCount: legacyRules.length,
    legacyRules,
    deletedRuleCount: 0,
    reasonCode: activeProductRules.length === specs.length ? 'ready'
      : networkProfiles.includes('Private') ? 'rules_missing_or_stale' : 'network_not_private',
  };
}

function helperPath(baseDir = __dirname) {
  const direct = path.join(baseDir, 'windows-firewall.ps1');
  const unpacked = direct.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (unpacked !== direct && fs.existsSync(unpacked)) return unpacked;
  return direct;
}

function defaultRunner(file, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => execFile(file, args, {
    windowsHide: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
}

function parseResult(stdout) {
  const text = String(stdout || '').trim();
  const line = text.split(/\r?\n/).filter(Boolean).at(-1) || '';
  const parsed = JSON.parse(line);
  if (!parsed || typeof parsed !== 'object') throw Error('invalid_firewall_result');
  return parsed;
}

async function inspectHostFirewall({ tcpPort, discoveryPort, runner = defaultRunner } = {}) {
  const specs = productFirewallRuleSpecs({ tcpPort, discoveryPort });
  if (process.platform !== 'win32' && runner === defaultRunner) return summarizeFirewallInspection({ networkProfiles: [], rules: [], legacyRules: [] }, specs);
  const result = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(),
    '-Action', 'Inspect', '-TcpPort', String(validatePort(tcpPort)), '-DiscoveryPort', String(validatePort(discoveryPort))]);
  return summarizeFirewallInspection(parseResult(result.stdout), specs);
}

async function repairHostFirewall({ tcpPort, discoveryPort, runner = defaultRunner } = {}) {
  const ports = { tcpPort: validatePort(tcpPort), discoveryPort: validatePort(discoveryPort) };
  const resultPath = path.join(os.tmpdir(), `edu-firewall-${process.pid}-${crypto.randomUUID()}.json`);
  try {
    const result = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(),
      '-Action', 'Repair', '-TcpPort', String(ports.tcpPort), '-DiscoveryPort', String(ports.discoveryPort), '-ResultPath', resultPath], 120_000);
    const parsed = parseResult(result.stdout);
    return { ...parsed, rules: productFirewallRuleSpecs(ports), deletedLegacyRuleCount: 0 };
  } finally {
    try { fs.rmSync(resultPath, { force: true }); } catch { /* best effort */ }
  }
}

module.exports = {
  RULE_GROUP,
  RULE_NAMES,
  helperPath,
  inspectHostFirewall,
  productFirewallRuleSpecs,
  repairHostFirewall,
  summarizeFirewallInspection,
  validatePort,
};
