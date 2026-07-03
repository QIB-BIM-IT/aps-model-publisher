// scripts/setup-da.js
// Provisioning one-shot Design Automation pour le module QC (idempotent, relançable).
//
// Étapes (ressources préfixées qc_extractor, suffixées par version d'engine — cloisonnement) :
//   1. Lecture du nickname (JAMAIS de PATCH : compte APS partagé, nickname global quasi irréversible)
//   2. AppBundle qc_extractor_appbundle_<version> (create ou new version) + upload du zip + alias
//   3. Activity qc_extractor_activity_<version> (engine Autodesk.Revit+<version>) + alias
//   4. Bucket OSS transient pour les result.json
//
// Les anciennes ressources non suffixées (tranche 1) restent en place, inertes :
// leur suppression serait destructive et est hors périmètre.
//
// Usage :
//   node scripts/setup-da.js --engine-version 2025 --zip ../da-appbundle/QcExtractor/output/QcExtractor2025.bundle.zip
//   node scripts/setup-da.js --engine-version 2024   (zip par défaut: output/QcExtractor2024.bundle.zip)
//
// À la fin, le script affiche la valeur de QC_DA_ACTIVITY_ID à poser dans l'environnement.
// Prérequis env : APS_CLIENT_ID, APS_CLIENT_SECRET (le token 2 legs demandé porte code:all).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const qcDa = require('../src/services/qcDesignAutomation.service');
const { apsConfig } = require('../src/config/aps.config');

const BASE = apsConfig.apis.baseUrl;
const DA = apsConfig.apis.designAutomation;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
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

// ⚠️ Le compte APS est PARTAGÉ avec le publisher et le nickname est global et quasi
// irréversible : ce script ne fait JAMAIS de PATCH forgeapps/me. Lecture seule,
// uniquement pour construire les identifiants qualifiés (par défaut = client id).
async function readNickname(token) {
  const me = await daFetch('GET', `${BASE}/da/us-east/v3/forgeapps/me`, null, token);
  if (me.status !== 200) fail('GET forgeapps/me', me);
  console.log(`Nickname du compte (lecture seule, jamais modifié ici): ${me.data}`);
  return me.data;
}

async function createOrVersion(kind, listPath, id, payload, token) {
  // kind: 'appbundles' | 'activities'
  let r = await daFetch('POST', `${BASE}${listPath}`, { id, ...payload }, token);
  if (r.status === 409) {
    console.log(`${kind}/${id} existe déjà → nouvelle version`);
    r = await daFetch('POST', `${BASE}${listPath}/${id}/versions`, payload, token);
  }
  if (r.status >= 300) fail(`POST ${kind} ${id}`, r);
  return r.data; // contient version (+ uploadParameters pour appbundles)
}

async function ensureAlias(listPath, id, alias, version, token) {
  let r = await daFetch('POST', `${BASE}${listPath}/${id}/aliases`, { id: alias, version }, token);
  if (r.status === 409) {
    r = await daFetch('PATCH', `${BASE}${listPath}/${id}/aliases/${alias}`, { version }, token);
  }
  if (r.status >= 300) fail(`alias ${id}+${alias}`, r);
  console.log(`Alias ${id}+${alias} → version ${version}`);
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
  console.log(`Bundle uploadé (${Math.round(fs.statSync(zipPath).size / 1024)} Ko)`);
}

async function main() {
  const engineVersion = arg('--engine-version') || '2024';
  if (!['2024', '2025'].includes(engineVersion)) {
    throw new Error(`--engine-version invalide: ${engineVersion} (attendu: 2024 | 2025)`);
  }
  const cfg = { ...qcDa.config, ...qcDa.namesFor(engineVersion) };
  const zipPath =
    arg('--zip') || path.join(__dirname, `../../da-appbundle/QcExtractor/output/QcExtractor${engineVersion}.bundle.zip`);

  if (!process.env.APS_CLIENT_ID || !process.env.APS_CLIENT_SECRET) {
    throw new Error('APS_CLIENT_ID / APS_CLIENT_SECRET manquants dans l\'environnement');
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(
      `Zip du bundle introuvable: ${zipPath} ` +
        `(builder d'abord: da-appbundle/QcExtractor/build-bundle.ps1 -EngineVersion ${engineVersion})`
    );
  }
  console.log(`Provisioning DA pour l'engine ${cfg.engine} (ressources ${cfg.appBundleName} / ${cfg.activityName})`);

  const token = await qcDa.getToken();

  // 1. Nickname : lecture seule (jamais de PATCH — compte partagé avec le publisher)
  const nickname = await readNickname(token);

  // 2. AppBundle + upload + alias
  const bundleData = await createOrVersion(
    'appbundles',
    DA.appBundles,
    cfg.appBundleName,
    { engine: cfg.engine, description: 'QC BIM — extraction G408 (warnings Revit) depuis modèle cloud ACC' },
    token
  );
  if (!bundleData.uploadParameters) throw new Error('uploadParameters manquants dans la réponse appbundle');
  await uploadBundleZip(bundleData.uploadParameters, zipPath);
  await ensureAlias(DA.appBundles, cfg.appBundleName, cfg.alias, bundleData.version, token);

  // 3. Activity + alias
  const qualifiedBundle = `${nickname}.${cfg.appBundleName}+${cfg.alias}`;
  const activityData = await createOrVersion(
    'activities',
    DA.activities,
    cfg.activityName,
    {
      commandLine: [`$(engine.path)\\revitcoreconsole.exe /al "$(appbundles[${cfg.appBundleName}].path)"`],
      parameters: {
        inputParams: { verb: 'get', localName: 'params.json', required: true, description: 'region/projectGuid/modelGuid' },
        result: { verb: 'put', localName: 'result.json', required: true, description: 'résultat G408' },
      },
      engine: cfg.engine,
      appbundles: [qualifiedBundle],
      description: 'QC BIM — contrôle G408 sur modèle cloud ACC (Revit 2024)',
    },
    token
  );
  await ensureAlias(DA.activities, cfg.activityName, cfg.alias, activityData.version, token);

  // 4. Bucket OSS
  await qcDa.ensureBucket();
  console.log(`Bucket OSS prêt: ${cfg.bucketKey}`);

  const activityId = `${nickname}.${cfg.activityName}+${cfg.alias}`;
  console.log('\n========================================================');
  console.log('Provisioning DA terminé. Variables à poser dans l\'environnement :');
  console.log(`  QC_DA_ACTIVITY_ID_${engineVersion}=${activityId}`);
  console.log(`  QC_OSS_BUCKET=${cfg.bucketKey}`);
  console.log('  QC_CALLBACK_BASE_URL=<URL publique de l\'app> (optionnel, sinon polling seul)');
  console.log('========================================================');
}

main().catch((e) => {
  console.error(`❌ setup-da: ${e.message}`);
  process.exitCode = 1;
});
