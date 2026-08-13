// scripts/qc-provision-dev-alias.js
// Provisionne UNIQUEMENT l'alias `dev` (appbundles + activities QC).
// L'alias `prod` n'est JAMAIS créé, patché, ni mentionné en écriture.
//
// Usage (depuis backend/) :
//   node scripts/qc-provision-dev-alias.js
//
// Prérequis : zips locaux QcExtractor2024/2025.bundle.zip, APS_CLIENT_ID/SECRET.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const qcDa = require('../src/services/qcDesignAutomation.service');
const { apsConfig } = require('../src/config/aps.config');

const BASE = apsConfig.apis.baseUrl;
const DA = apsConfig.apis.designAutomation;
const DEV = 'dev';
const PROD = 'prod';

const RESOURCES = [
  { kind: 'appbundles', id: 'qc_extractor_appbundle_2024' },
  { kind: 'appbundles', id: 'qc_extractor_appbundle_2025' },
  { kind: 'appbundles', id: 'qc_extractor_appbundle_2026' },
  { kind: 'activities', id: 'qc_extractor_activity_2024' },
  { kind: 'activities', id: 'qc_extractor_activity_2025' },
  { kind: 'activities', id: 'qc_extractor_activity_2026' },
];

function listPath(kind) {
  return kind === 'appbundles' ? DA.appBundles : DA.activities;
}

async function daFetch(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function fail(step, r) {
  throw new Error(`${step} → HTTP ${r.status}: ${JSON.stringify(r.data)}`);
}

async function getAlias(kind, id, alias, token) {
  const r = await daFetch('GET', `${BASE}${listPath(kind)}/${id}/aliases/${alias}`, null, token);
  if (r.status === 404) return { exists: false, version: null, raw: r.data };
  if (r.status >= 300) fail(`GET ${kind}/${id}+${alias}`, r);
  return { exists: true, version: r.data.version, raw: r.data };
}

async function snapshotAliases(token, label) {
  console.log(`\n===== SNAPSHOT ${label} =====`);
  const snap = {};
  for (const res of RESOURCES) {
    const prod = await getAlias(res.kind, res.id, PROD, token);
    const dev = await getAlias(res.kind, res.id, DEV, token);
    const key = `${res.kind}/${res.id}`;
    snap[key] = { prod: prod.version, dev: dev.version };
    console.log(
      `${key}: prod=${prod.exists ? prod.version : 'ABSENT'}  dev=${dev.exists ? dev.version : 'ABSENT'}`
    );
  }
  return snap;
}

function assertProdUnchanged(before, after) {
  const mismatches = [];
  for (const key of Object.keys(before)) {
    if (before[key].prod !== after[key].prod) {
      mismatches.push(`${key}: prod ${before[key].prod} → ${after[key].prod}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`PROD A BOUGÉ — arrêt: ${mismatches.join('; ')}`);
  }
  console.log('\nPROD INCHANGÉ (2024/2025/2026 appbundles + activities).');
}

async function uploadBundleZip(uploadParameters, zipPath) {
  const { endpointURL, formData } = uploadParameters;
  const form = new FormData();
  for (const [k, v] of Object.entries(formData)) form.append(k, v);
  form.append('file', new Blob([fs.readFileSync(zipPath)]), path.basename(zipPath));
  const res = await fetch(endpointURL, { method: 'POST', body: form });
  if (res.status >= 300) {
    throw new Error(`Upload du bundle échoué → HTTP ${res.status}: ${await res.text()}`);
  }
  console.log(`Bundle uploadé (${Math.round(fs.statSync(zipPath).size / 1024)} Ko) ← ${path.basename(zipPath)}`);
}

async function newAppbundleVersion(id, engine, zipPath, token) {
  const r = await daFetch(
    'POST',
    `${BASE}${DA.appBundles}/${id}/versions`,
    { engine, description: `QC BIM — bundle ${id} (alias dev, ne pas pointer prod)` },
    token
  );
  if (r.status >= 300) fail(`POST appbundles/${id}/versions`, r);
  if (!r.data.uploadParameters) throw new Error(`uploadParameters manquants pour ${id}`);
  await uploadBundleZip(r.data.uploadParameters, zipPath);
  return r.data.version;
}

async function ensureDevAlias(kind, id, version, token) {
  const r = await daFetch('POST', `${BASE}${listPath(kind)}/${id}/aliases`, { id: DEV, version }, token);
  if (r.status === 409) {
    const p = await daFetch('PATCH', `${BASE}${listPath(kind)}/${id}/aliases/${DEV}`, { version }, token);
    if (p.status >= 300) fail(`PATCH ${kind}/${id}+${DEV}`, p);
    console.log(`Alias ${id}+${DEV} mis à jour → version ${version} (prod non touché)`);
    return;
  }
  if (r.status >= 300) fail(`POST ${kind}/${id}+${DEV}`, r);
  console.log(`Alias ${id}+${DEV} créé → version ${version} (prod non touché)`);
}

async function getQualified(kind, qualifiedId, token) {
  const r = await daFetch('GET', `${BASE}${listPath(kind)}/${qualifiedId}`, null, token);
  if (r.status >= 300) fail(`GET ${kind}/${qualifiedId}`, r);
  return r.data;
}

async function newActivityVersion(id, payload, token) {
  const r = await daFetch('POST', `${BASE}${DA.activities}/${id}/versions`, payload, token);
  if (r.status >= 300) fail(`POST activities/${id}/versions`, r);
  return r.data.version;
}

async function main() {
  if (!process.env.APS_CLIENT_ID || !process.env.APS_CLIENT_SECRET) {
    throw new Error('APS_CLIENT_ID / APS_CLIENT_SECRET manquants');
  }

  const zip2024 = path.join(__dirname, '../../da-appbundle/QcExtractor/output/QcExtractor2024.bundle.zip');
  const zip2025 = path.join(__dirname, '../../da-appbundle/QcExtractor/output/QcExtractor2025.bundle.zip');
  if (!fs.existsSync(zip2024) || !fs.existsSync(zip2025)) {
    throw new Error('Zips 2024/2025 introuvables — rebuild d\'abord');
  }

  const token = await qcDa.getToken();
  const nickname = process.env.QC_DA_NICKNAME || process.env.APS_CLIENT_ID;

  const before = await snapshotAliases(token, 'AVANT');

  // --- AppBundles : nouvelles versions + alias dev uniquement ---
  const bundleVer2024 = await newAppbundleVersion(
    'qc_extractor_appbundle_2024',
    'Autodesk.Revit+2024',
    zip2024,
    token
  );
  await ensureDevAlias('appbundles', 'qc_extractor_appbundle_2024', bundleVer2024, token);

  const bundleVer2025 = await newAppbundleVersion(
    'qc_extractor_appbundle_2025',
    'Autodesk.Revit+2025',
    zip2025,
    token
  );
  await ensureDevAlias('appbundles', 'qc_extractor_appbundle_2025', bundleVer2025, token);

  // 2026 : pas de zip dédié (engine 2026 réutilise le bundle net8 2025).
  // Si un appbundle_2026 existe, on ne le versionne pas ici.

  // --- Activities : nouvelle version qui référence le bundle +dev ---
  const actSpecs = [
    {
      id: 'qc_extractor_activity_2024',
      engine: 'Autodesk.Revit+2024',
      bundle: `${nickname}.qc_extractor_appbundle_2024+${DEV}`,
    },
    {
      id: 'qc_extractor_activity_2025',
      engine: 'Autodesk.Revit+2025',
      bundle: `${nickname}.qc_extractor_appbundle_2025+${DEV}`,
    },
    {
      id: 'qc_extractor_activity_2026',
      engine: 'Autodesk.Revit+2026',
      bundle: `${nickname}.qc_extractor_appbundle_2025+${DEV}`,
    },
  ];

  for (const spec of actSpecs) {
    const qualifiedProd = `${nickname}.${spec.id}+${PROD}`;
    const current = await getQualified('activities', qualifiedProd, token);
    const payload = {
      commandLine: current.commandLine,
      parameters: current.parameters,
      engine: spec.engine,
      appbundles: [spec.bundle],
      description: current.description || `QC BIM ${spec.id} (alias dev)`,
    };
    const ver = await newActivityVersion(spec.id, payload, token);
    await ensureDevAlias('activities', spec.id, ver, token);
    console.log(`Activity ${spec.id}+${DEV} → v${ver} bundle=${spec.bundle}`);
  }

  const after = await snapshotAliases(token, 'APRÈS');
  assertProdUnchanged(before, after);

  console.log('\n===== ACTIVITY IDs DEV (à poser en local uniquement) =====');
  for (const v of ['2024', '2025', '2026']) {
    console.log(`QC_DA_ACTIVITY_ID_${v}=${nickname}.qc_extractor_activity_${v}+${DEV}`);
  }
}

main().catch((e) => {
  console.error(`❌ qc-provision-dev-alias: ${e.message}`);
  process.exitCode = 1;
});
