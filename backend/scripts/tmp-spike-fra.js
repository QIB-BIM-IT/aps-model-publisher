// TEMPORAIRE (spike) — recrée la version FRA de l'activity 2024 avec la commandLine
// correctement échappée (double backslash, comme les activities qui fonctionnent).
require('dotenv').config();
(async () => {
  const qcDa = require('../src/services/qcDesignAutomation.service');
  const token = await qcDa.getToken();
  const BASE = 'https://developer.api.autodesk.com/da/us-east/v3';
  const NICK = 't9cxGIJFhT3L07FpOSj5lHiaQKIaDEpFcnvP5HDydxwWeUUd';
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const payload = {
    commandLine: ['$(engine.path)\\revitcoreconsole.exe /al "$(appbundles[qc_extractor_appbundle_2024].path)" /l FRA'],
    parameters: {
      inputParams: { verb: 'get', localName: 'params.json', required: true },
      result: { verb: 'put', localName: 'result.json', required: true },
    },
    engine: 'Autodesk.Revit+2024',
    appbundles: [`${NICK}.qc_extractor_appbundle_2024+spike`],
    description: 'SPIKE — G408 diagnostic, moteur en francais (/l FRA), echappement corrige',
  };

  let r = await fetch(`${BASE}/activities/qc_extractor_activity_2024/versions`, {
    method: 'POST', headers: H, body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (r.status >= 300) { console.error('POST version:', r.status, JSON.stringify(d)); process.exit(1); }
  console.log(`Version FRA v${d.version} créée — commandLine stockée: ${JSON.stringify(d.commandLine)}`);

  let a = await fetch(`${BASE}/activities/qc_extractor_activity_2024/aliases/spikefr`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ version: d.version }),
  });
  console.log(`Alias spikefr → v${d.version} (HTTP ${a.status})`);
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
