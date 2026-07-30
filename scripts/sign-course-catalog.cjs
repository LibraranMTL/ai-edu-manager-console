const fs = require('fs');
const path = require('path');
const {
  catalogChecksum,
  catalogSignaturePayload,
  validateCatalogPackage,
} = require('../electron/course-catalog.cjs');
const crypto = require('crypto');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`缺少环境变量 ${name}。签名私钥不得写入仓库或客户安装包。`);
  return value;
}

const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'course-catalog', 'catalog.source.json'));
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public', 'course-catalog', 'catalog.json'));
const privateKey = fs.readFileSync(path.resolve(required('COURSE_CATALOG_PRIVATE_KEY')), 'utf8');
const publicKeyPath = path.resolve(required('COURSE_CATALOG_PUBLIC_KEY'));
const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const checksum = catalogChecksum(source);
const signature = crypto.sign('RSA-SHA256', Buffer.from(catalogSignaturePayload(source)), privateKey).toString('base64');
const signed = { ...source, checksum, signature };
const checked = validateCatalogPackage(signed, { hostVersion: process.env.COURSE_CATALOG_HOST_VERSION || '999.0.0', publicKey });
if (!checked.ok) throw new Error(checked.message);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({ ok: true, outputPath, catalogVersion: signed.catalogVersion, checksum }, null, 2));
