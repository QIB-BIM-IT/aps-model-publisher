// TEMPORAIRE (spike) — diagnostic sur MHM-TETE-ZZZ-XXX-M3-FEDE.rvt (2024) pour la
// comparaison inter-modèles des Guids (même hub/projet que le pilote ELEC).
require('dotenv').config();
const fs = require('fs');
(async () => {
  const qcDa = require('../src/services/qcDesignAutomation.service');
  const apsAuth = require('../src/services/apsAuth.service');
  const NICK = 't9cxGIJFhT3L07FpOSj5lHiaQKIaDEpFcnvP5HDydxwWeUUd';
  const token3 = await apsAuth.ensureValidToken('27fa5963-d58e-404c-a8a1-e2309fc41101');
  const resultUrl = await qcDa.createSignedResultUrl(`spike-diag-2024-fede-${Date.now()}.json`);
  const wi = await qcDa.submitWorkitem({
    activityId: `${NICK}.qc_extractor_activity_2024+spike`,
    inputParams: {
      controlCode: 'G408', region: 'US', diagnostic: true,
      projectGuid: '5338c410-63b9-40b8-bda4-f12bb2081ca9',
      modelGuid: 'a6a77f1f-7096-47f4-820d-739ac4d58807',
    },
    resultUrl, threeLeggedToken: token3, onCompleteUrl: null,
  });
  console.log('workitem=' + wi);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25000));
    const w = await qcDa.getWorkitem(wi);
    const st = String(w.status || '').toLowerCase();
    console.log(new Date().toISOString().slice(11, 19), st);
    if (['pending', 'inprogress'].includes(st)) continue;
    if (st === 'success') {
      const result = await qcDa.downloadResult(resultUrl);
      fs.writeFileSync(`${process.env.SPIKE_OUT_DIR}/diag-2024-fede.json`, JSON.stringify(result, null, 1));
      console.log(`✅ FEDE total=${result.total} critical=${result.critical}`);
    } else {
      console.log(`❌ ${st} report=${(w.reportUrl || '').split('?')[0]}`);
    }
    break;
  }
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
