const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { fileURLToPath } = require('url');
const ExcelJS = require('exceljs');
const { HTTP_ONLY_COURSE_HOSTS, normalizeCourseItem, relatedCourseHosts } = require('./course-catalog.cjs');

const CUSTOM_COURSE_IMPORT_PLANS = new Set(['PRO', 'ORG', 'PLATFORM']);
const MAX_CUSTOM_COURSES = 200;
const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const HEADER_ALIASES = {
  name: new Set(['课程名称', '名称']),
  image: new Set(['课程图片', '图片']),
  summary: new Set(['课程简介', '简介']),
  url: new Set(['课程链接', '课程连接', '链接']),
};

function canImportCustomCourses(license = {}) {
  return license.active === true && (
    (Array.isArray(license.capabilities) && license.capabilities.includes('tenant_course_manage'))
    || CUSTOM_COURSE_IMPORT_PLANS.has(String(license.edition || license.plan || '').toUpperCase())
  );
}

function cellText(cell, preferHyperlink = false) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value.richText)) return value.richText.map((item) => String(item?.text || '')).join('').trim();
  if (preferHyperlink && value.hyperlink) return String(value.hyperlink).trim();
  if (value.text != null) return String(value.text).trim();
  if (value.result != null) return String(value.result).trim();
  if (value.hyperlink) return String(value.hyperlink).trim();
  return String(cell?.text || '').trim();
}

function findHeader(worksheet) {
  const limit = Math.min(10, worksheet.rowCount || 0);
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns = {};
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const heading = cellText(cell).replace(/\s+/g, '');
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.has(heading)) columns[field] = columnNumber;
      }
    });
    if (Object.keys(columns).length === Object.keys(HEADER_ALIASES).length) return { rowNumber, columns };
  }
  throw new Error('未找到四个必填表头：课程名称、课程图片、课程简介、课程链接。');
}

function parseCourseUrl(value, rowNumber) {
  const prefix = Number.isInteger(rowNumber) ? `第 ${rowNumber} 行` : '';
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${prefix}课程链接不是有效网址。`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${prefix}课程链接必须使用 HTTP 或 HTTPS。`);
  if (parsed.username || parsed.password) throw new Error(`${prefix}课程链接不能包含用户名或密码。`);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (HTTP_ONLY_COURSE_HOSTS.has(parsed.hostname)) parsed.protocol = 'http:';
  return parsed;
}

async function readCustomCourseWorkbook(workbookPath) {
  const stat = fs.statSync(workbookPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_WORKBOOK_BYTES) {
    throw new Error('Excel 文件为空或超过 10 MB。');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 文件中没有工作表。');
  const header = findHeader(worksheet);
  const rows = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const raw = {
      rowNumber,
      name: cellText(row.getCell(header.columns.name)),
      image: cellText(row.getCell(header.columns.image), true),
      summary: cellText(row.getCell(header.columns.summary)),
      url: cellText(row.getCell(header.columns.url), true),
    };
    if (!raw.name && !raw.image && !raw.summary && !raw.url) continue;
    const missing = Object.entries(raw)
      .filter(([field, value]) => field !== 'rowNumber' && !value)
      .map(([field]) => ({ name: '课程名称', image: '课程图片', summary: '课程简介', url: '课程链接' })[field]);
    if (missing.length) throw new Error(`第 ${rowNumber} 行缺少：${missing.join('、')}。`);
    if (raw.name.length > 120) throw new Error(`第 ${rowNumber} 行课程名称超过 120 个字符。`);
    if (raw.summary.length > 1200) throw new Error(`第 ${rowNumber} 行课程简介超过 1200 个字符。`);
    rows.push(raw);
    if (rows.length > MAX_CUSTOM_COURSES) throw new Error(`一次最多导入 ${MAX_CUSTOM_COURSES} 门自选课程。`);
  }
  if (!rows.length) throw new Error('Excel 中没有可导入的课程数据。');
  return rows;
}

function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  throw new Error('课程图片只支持 PNG、JPG/JPEG 或 WebP。');
}

function downloadHttps(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) {
      reject(new Error('课程图片网址重定向次数过多。'));
      return;
    }
    const request = https.get(url, {
      headers: { 'User-Agent': 'AI-Education-Manager-Course-Importer/1.0' },
      timeout: 12_000,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        let next;
        try {
          next = new URL(response.headers.location, url);
        } catch {
          reject(new Error('课程图片重定向网址无效。'));
          return;
        }
        if (next.protocol !== 'https:') {
          reject(new Error('课程图片重定向后必须继续使用 HTTPS。'));
          return;
        }
        downloadHttps(next.toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`课程图片下载失败（HTTP ${status || '未知'}）。`));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_IMAGE_BYTES) {
        response.resume();
        reject(new Error('课程图片超过 5 MB。'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          request.destroy(new Error('课程图片超过 5 MB。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => request.destroy(new Error('课程图片下载超时。')));
    request.on('error', reject);
  });
}

async function readImageReference(reference, workbookDir) {
  const value = String(reference || '').trim().replace(/^"(.*)"$/, '$1');
  if (/^https:\/\//i.test(value)) return downloadHttps(value);
  let sourcePath = value;
  if (/^file:\/\//i.test(value)) sourcePath = fileURLToPath(value);
  if (!path.isAbsolute(sourcePath)) sourcePath = path.resolve(workbookDir, sourcePath);
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) throw new Error('本地课程图片为空或超过 5 MB。');
  return fs.readFileSync(sourcePath);
}

function writeImageAsset(assetDir, buffer) {
  const extension = imageExtension(buffer);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${digest}${extension}`;
  const target = path.join(assetDir, filename);
  fs.mkdirSync(assetDir, { recursive: true });
  if (!fs.existsSync(target)) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, target);
  }
  return `custom-assets/${filename}`;
}

async function inspectCustomCourseImage(imagePath) {
  const buffer = await readImageReference(imagePath, '');
  return {
    bytes: buffer.length,
    extension: imageExtension(buffer),
  };
}

async function createCustomCourseFromForm(input = {}, options = {}) {
  const name = String(input.name || '').trim();
  const summary = String(input.summary || '').trim();
  const url = String(input.url || '').trim();
  const imagePath = String(input.imagePath || '').trim();
  const missing = [
    !name ? '课程名称' : '',
    !summary ? '课程简介' : '',
    !url ? '课程链接' : '',
    !imagePath ? '课程图片' : '',
  ].filter(Boolean);
  if (missing.length) throw new Error(`请填写或选择：${missing.join('、')}。`);
  if (name.length > 120) throw new Error('课程名称不能超过 120 个字符。');
  if (summary.length > 1200) throw new Error('课程简介不能超过 1200 个字符。');

  const parsed = parseCourseUrl(url);
  const normalizedUrl = parsed.toString();
  let imageBuffer;
  try {
    imageBuffer = await readImageReference(imagePath, '');
  } catch (error) {
    throw new Error(`课程图片读取失败：${error.message}`);
  }
  const requestedCourseId = String(options.courseId || '').trim();
  if (requestedCourseId && !requestedCourseId.startsWith('tenant:')) {
    throw new Error('只能编辑机构自选课程。');
  }
  const courseId = requestedCourseId || `tenant:custom-${crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 20)}`;
  const coverAsset = writeImageAsset(options.assetDir, imageBuffer);
  const course = normalizeCourseItem({
    courseId,
    type: 'tenant_custom',
    name,
    provider: '机构自选课程',
    url: normalizedUrl,
    allowedHosts: relatedCourseHosts(parsed.hostname),
    coverAsset,
    summary,
    subjects: [],
    gradeRange: [],
    languages: [],
    accountRequirement: '账号、会员、收费和年龄要求以课程网站当时说明为准。',
    effectiveAt: options.now || new Date().toISOString(),
    expiresAt: null,
    legalNotice: '本课程由当前专业版或机构版用户自行选择并上传。课程内容、图片、链接、商标、账号及服务条款由上传方和课程提供方负责；AI教育管家仅提供受限访问入口与用户主动资料采集能力，不构成隶属、代理或学习效果保证。',
    status: 'active',
  });
  return { course };
}

async function importCustomCoursesFromExcel(workbookPath, options = {}) {
  const rows = await readCustomCourseWorkbook(workbookPath);
  const workbookDir = path.dirname(workbookPath);
  const courses = [];
  const seen = new Set();
  for (const row of rows) {
    const parsed = parseCourseUrl(row.url, row.rowNumber);
    const normalizedUrl = parsed.toString();
    if (seen.has(normalizedUrl)) throw new Error(`第 ${row.rowNumber} 行课程链接重复。`);
    seen.add(normalizedUrl);
    let imageBuffer;
    try {
      imageBuffer = await readImageReference(row.image, workbookDir);
    } catch (error) {
      throw new Error(`第 ${row.rowNumber} 行课程图片读取失败：${error.message}`);
    }
    const courseId = `tenant:custom-${crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 20)}`;
    const coverAsset = writeImageAsset(options.assetDir, imageBuffer);
    courses.push(normalizeCourseItem({
      courseId,
      type: 'tenant_custom',
      name: row.name,
      provider: '机构自选课程',
      url: normalizedUrl,
      allowedHosts: relatedCourseHosts(parsed.hostname),
      coverAsset,
      summary: row.summary,
      subjects: [],
      gradeRange: [],
      languages: [],
      accountRequirement: '账号、会员、收费和年龄要求以课程网站当时说明为准。',
      effectiveAt: options.now || new Date().toISOString(),
      expiresAt: null,
      legalNotice: '本课程由当前专业版或机构版用户自行选择并导入。课程内容、图片、链接、商标、账号及服务条款由导入方和课程提供方负责；AI教育管家仅提供受限访问入口与用户主动资料采集能力，不构成隶属、代理或学习效果保证。',
      status: 'active',
    }));
  }
  return { courses, imported: courses.length };
}

async function writeCustomCourseTemplate(targetPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Education Manager';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('课程导入', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  worksheet.columns = [
    { header: '课程名称', key: 'name', width: 24 },
    { header: '课程图片', key: 'image', width: 38 },
    { header: '课程简介', key: 'summary', width: 48 },
    { header: '课程链接', key: 'url', width: 44 },
  ];
  worksheet.getRow(1).height = 28;
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  for (let rowNumber = 2; rowNumber <= 51; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 34;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FCFB' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFDDE9E6' } },
        right: { style: 'thin', color: { argb: 'FFDDE9E6' } },
      };
    });
  }
  worksheet.autoFilter = 'A1:D51';

  const guide = workbook.addWorksheet('填写说明', { views: [{ showGridLines: false }] });
  guide.columns = [{ width: 12 }, { width: 86 }];
  guide.mergeCells('A1:B1');
  guide.getCell('A1').value = 'AI教育管家自选课程 Excel 填写说明';
  guide.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 };
  guide.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  guide.getCell('A1').alignment = { vertical: 'middle' };
  guide.getRow(1).height = 34;
  guide.addRows([
    [],
    ['步骤', '说明'],
    ['1', '只在“课程导入”工作表填写数据，不要修改四个表头。'],
    ['2', '每门课程填写一行，四列都必须填写；空白行会自动忽略。'],
    ['3', '课程图片可填写：与 Excel 同目录的图片文件名、完整本地路径，或 HTTPS 图片网址。'],
    ['4', '课程链接必须以 https:// 开头；请尽量填写完成登录跳转后的最终课程网址。'],
    ['5', '支持 PNG、JPG/JPEG、WebP 图片，单张不超过 5 MB；一次最多导入 200 门课程。'],
  ]);
  guide.getRow(3).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF0B5F59' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDF3EC' } };
  });
  for (let rowNumber = 4; rowNumber <= 8; rowNumber += 1) {
    const row = guide.getRow(rowNumber);
    row.height = 38;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDE9E6' } } };
    });
  }
  await workbook.xlsx.writeFile(targetPath);
  return targetPath;
}

module.exports = {
  CUSTOM_COURSE_IMPORT_PLANS,
  MAX_CUSTOM_COURSES,
  canImportCustomCourses,
  cellText,
  findHeader,
  createCustomCourseFromForm,
  importCustomCoursesFromExcel,
  inspectCustomCourseImage,
  readCustomCourseWorkbook,
  writeCustomCourseTemplate,
};
