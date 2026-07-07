// scripts/qc-batch-inventory.js
// Batch runner d'inventaire : lance l'extraction G408 NORMALE (chemin prouvé —
// resolver, garde workshared, routage par version, scoring inclus) sur une liste
// de modèles désignés, puis attend la complétion de tous les runs.
//
// Les modèles non workshared ou hors versions supportées sont SAUTÉS avec un
// message clair (le run refusé existe en base pour la trace), jamais une erreur
// fatale du batch. Aucune nouvelle plomberie : réutilise qcRun.service tel quel.
//
// Usage :
//   DATABASE_URL=<base locale> QC_DA_ACTIVITY_ID_2024=... QC_DA_ACTIVITY_ID_2025=... \
//     node scripts/qc-batch-inventory.js --models <liste.json> [--user <email>]
//
// Format de <liste.json> : tableau de désignations acceptées par le resolver :
//   [{ "label": "...", "hubId|hubName": "...", "projectId|projectName": "...", "fileName": "x.rvt" },
//    { "label": "...", "accUrl": "https://acc.autodesk.com/docs/files/projects/...?...entityId=..." },
//    { "label": "...", "projectId": "b.xxx", "itemUrn": "urn:adsk.wipprod:dm.lineage:..." }]
// Voir scripts/qc-inventory-models.example.json.

require('dotenv').config();
const fs = require('fs');
const { sequelize } = require('../src/config/database');

const POLL_MS = 20000;
const GLOBAL_TIMEOUT_MS = 45 * 60 * 1000;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  // Garde-fou hôte local — refus de toute cible non locale
  const host = sequelize.config.host || '(inconnu)';
  console.log(`Hôte PostgreSQL effectif : ${host} | base : ${sequelize.config.database}`);
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.error('❌ CIBLE NON LOCALE — ARRÊT');
    process.exit(2);
  }

  const modelsPath = arg('--models');
  if (!modelsPath || !fs.existsSync(modelsPath)) {
    console.error('Usage: node scripts/qc-batch-inventory.js --models <liste.json> [--user <email>]');
    process.exit(1);
  }
  const designations = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  if (!Array.isArray(designations) || !designations.length) {
    console.error('Liste de modèles vide ou invalide');
    process.exit(1);
  }

  const qcRunService = require('../src/services/qcRun.service');
  await qcRunService.init(); // migrations qc + modèles (jamais le schéma public)

  // Utilisateur exécutant : par email si fourni, sinon premier utilisateur Autodesk avec refresh token
  const User = require('../src/models/User');
  const where = arg('--user') ? { email: arg('--user') } : {};
  const user = await User.findOne({ where });
  if (!user || !user.refreshToken) {
    console.error('Aucun utilisateur avec tokens Autodesk en base locale — se connecter d\'abord (voir QC_MODULE.md)');
    process.exit(1);
  }
  console.log(`Utilisateur exécutant : ${user.name} <${user.email}>\n`);

  const { QCRun } = require('../src/models/qc');
  const results = [];

  // Soumission séquentielle (le resolver fait ~2-10 appels DM par modèle)
  for (const d of designations) {
    const label = d.label || d.fileName || d.accUrl || d.itemUrn;
    try {
      const run = await qcRunService.startRun({
        user: { id: user.id, name: user.name, autodeskId: user.autodeskId },
        designation: d,
        runType: 'quotidien',
      });
      if (run.status === 'failed') {
        // Garde (non workshared, version non supportée…) : sauté, pas fatal
        console.log(`⏭️  SAUTÉ  ${label} — ${run.message}`);
        results.push({ label, runId: run.id, outcome: 'sauté', reason: run.message });
      } else {
        console.log(`▶️  SOUMIS ${label} — run=${run.id} workitem=${run.daWorkitemId} revit=${run.revitVersion}`);
        results.push({ label, runId: run.id, outcome: 'en cours' });
      }
    } catch (e) {
      console.log(`⏭️  SAUTÉ  ${label} — ${e.message}`);
      results.push({ label, runId: null, outcome: 'sauté', reason: e.message });
    }
  }

  // Attente de complétion (le polling DA tourne dans ce process via qcRun.service)
  const deadline = Date.now() + GLOBAL_TIMEOUT_MS;
  const pending = () => results.filter((r) => r.outcome === 'en cours');
  while (pending().length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    for (const r of pending()) {
      const run = await QCRun.findByPk(r.runId, { attributes: ['status', 'message', 'stats'] });
      if (!run || !['success', 'failed'].includes(run.status)) continue;
      r.outcome = run.status === 'success' ? 'succès' : 'échec';
      r.reason = run.message || null;
      r.stats = run.stats || {};
      console.log(
        `${run.status === 'success' ? '✅' : '❌'} ${r.label} — ${run.status}` +
          (run.status === 'success'
            ? ` (total=${run.stats?.total} critique=${run.stats?.critical})`
            : ` — ${run.message}`)
      );
    }
    const left = pending().length;
    if (left) console.log(`   … ${left} run(s) encore en cours`);
  }
  for (const r of pending()) {
    r.outcome = 'timeout';
    console.log(`⏱️ TIMEOUT ${r.label} (run ${r.runId} laissé au polling du service)`);
  }

  // Bilan
  console.log('\n================ BILAN DU BATCH ================');
  const byOutcome = {};
  for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
  console.log(Object.entries(byOutcome).map(([k, v]) => `${k}: ${v}`).join(' | '));
  for (const r of results) {
    console.log(`  [${r.outcome}] ${r.label}${r.reason ? ` — ${r.reason}` : ''}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
