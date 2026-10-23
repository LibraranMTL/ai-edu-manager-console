'use strict';

const REQUIRED_SOURCE_FILES = Object.freeze([
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/asset-index-store.cjs',
  'electron/asset-index-worker.cjs',
  'electron/asset-governance-worker.cjs',
  'electron/invoke-agent.ps1',
  'electron/capture-timeline-ocr.ps1',
  'electron/project-knowledge-guard.ps1',
  'public/brand/robogala.ico',
  'public/course-catalog/catalog.json',
  'public/course-catalog/public-key.pem',
  'public/license/trusted-issuers.json',
]);

const REQUIRED_PACKAGED_RESOURCES = Object.freeze([
  'resources/app.asar',
  'resources/app.asar.unpacked/electron/invoke-agent.ps1',
  'resources/app.asar.unpacked/electron/capture-timeline-ocr.ps1',
  'resources/app.asar.unpacked/electron/project-knowledge-guard.ps1',
  'resources/material-pdf-runtime/manifest.json',
  'resources/material-pdf-runtime/pdfjs/LICENSE',
  'resources/material-pdf-runtime/pdfjs/legacy/build/pdf.mjs',
  'resources/material-pdf-runtime/pdfjs/legacy/build/pdf.worker.mjs',
]);

const REQUIRED_PACKAGED_DIRECTORIES = Object.freeze([
  'locales',
  'resources/material-pdf-runtime/pdfjs/cmaps',
  'resources/material-pdf-runtime/pdfjs/standard_fonts',
  'resources/material-pdf-runtime/pdfjs/wasm',
]);

const DYNAMIC_PUBLIC_RESOURCE_PATTERNS = Object.freeze([
  /^skins\/skin-[a-z0-9_-]+\.jpg$/i,
]);

module.exports = {
  POLICY_VERSION: 1,
  REQUIRED_SOURCE_FILES,
  REQUIRED_PACKAGED_RESOURCES,
  REQUIRED_PACKAGED_DIRECTORIES,
  DYNAMIC_PUBLIC_RESOURCE_PATTERNS,
};
