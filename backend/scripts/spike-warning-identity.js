// SPIKE chantier 2 — soumission directe de 3 workitems de diagnostic (alias spike/spikefr).
// Aucune écriture en base qc, aucun backend : qcDa + apsAuth seulement.
// À exécuter depuis backend/ avec DATABASE_URL local (apsAuth lit users en base locale).
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const NICK = 't9cxGIJFhT3L07FpOSj5lHiaQKIaDEpFcnvP5HDydxwWeUUd';
const USER_ID = '27fa5963-d58e-404c-a8a1-e2309fc41101';
const OUT_DIR = process.env.SPIKE_OUT_DIR || __dirname;

const TESTS = [
  {
    key: 'diag-2024-enu',
    activityId: `${NICK}.qc_extractor_activity_2024+spike`,
    params: { controlCode: 'G408', region: 'US', projectGuid: '5338c410-63b9-40b8-bda4-f12bb2081ca9', modelGuid: '3f5e4045-3ccc-4249-98f5-5dacf97453ca', diagnostic: true },
  },
  {
    key: 'diag-2025-enu',
    activityId: `${NICK}.qc_extractor_activity_2025+spike`,
    params: { controlCode: 'G408', region: 'US', projectGuid: '574e3e33-8dda-4955-92cc-9337d3836c7b', modelGuid: '0840e95b-02dc-40c2-858a-9833f42156cc', diagnostic: true },
  },
  {
    key: 'diag-2024-fra',
    activityId: `${NICK}.qc_extractor_activity_2024+spikefr`,
    params: { controlCode: 'G408', region: 'US', projectGuid: '5338c410-63b9-40b8-bda4-f12bb2081ca9', modelGuid: '3f5e4045-3ccc-4249-98f5-5dacf97453ca', diagnostic: true },
  },
];

(async () => {
  const qcDa = require('../src/services/qcDesignAutomation.service');
  const apsAuth = require('../src/services/apsAuth.service');
  const token3 = await apsAuth.ensureValidToken(USER_ID);
  await qcDa.ensureBucket();

  // Soumission des 3
  for (const t of TESTS) {
    t.resultUrl = await qcDa.createSignedResultUrl(`spike-${t.key}-${Date.now()}.json`);
    t.workitemId = await qcDa.submitWorkitem({
      activityId: t.activityId,
      inputParams: t.params,
      resultUrl: t.resultUrl,
      threeLeggedToken: token3,
      onCompleteUrl: null,
    });
    console.log(`[${t.key}] workitem=${t.workitemId} activity=${t.activityId.split('.').pop()}`);
  }

  // Polling jusqu'à complétion des 3 (timeout 15 min)
  const deadline = Date.now() + 15 * 60 * 1000;
  const pending = new Set(TESTS.map((t) => t.key));
  while (pending.size && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25000));
    for (const t of TESTS) {
      if (!pending.has(t.key)) continue;
      const wi = await qcDa.getWorkitem(t.workitemId);
      const st = String(wi.status || '').toLowerCase();
      console.log(`[${t.key}] ${new Date().toISOString().slice(11, 19)} ${st}`);
      if (['pending', 'inprogress'].includes(st)) continue;
      pending.delete(t.key);
      t.finalStatus = st;
      t.reportUrl = wi.reportUrl || null;
      if (st === 'success') {
        const result = await qcDa.downloadResult(t.resultUrl);
        fs.writeFileSync(path.join(OUT_DIR, `${t.key}.json`), JSON.stringify(result, null, 1));
        console.log(`[${t.key}] ✅ résultat sauvegardé (total=${result.total}, critical=${result.critical})`);
      } else {
        console.log(`[${t.key}] ❌ ${st} — report: ${t.reportUrl}`);
        const report = await qcDa.downloadReport(t.reportUrl);
        if (report) fs.writeFileSync(path.join(OUT_DIR, `${t.key}-report.txt`), report);
      }
    }
  }
  for (const t of TESTS) {
    console.log(`FIN [${t.key}] status=${t.finalStatus || 'TIMEOUT'} workitem=${t.workitemId} report=${(t.reportUrl || '').split('?')[0]}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
