// src/services/qcFicheExcel.service.js
// Génération de la fiche de contrôle QC (Excel) à partir du gabarit versionné.
// Source de données : qcRunDetail.service uniquement (pas de seconde lecture DB).
// Le gabarit est ouvert en lecture ; jamais réécrit sur le disque.

const path = require('path');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const logger = require('../config/logger');
const qcRunDetailService = require('./qcRunDetail.service');

/**
 * Compense deux écarts de schéma OOXML d'exceljs (4.4.x) que les parseurs XML
 * génériques ne voient pas. Excel valide la séquence CT_* et refuse la partie.
 * Réévaluer à toute mise à jour d'exceljs en rouvrant une fiche dans Excel.
 *
 * 1) pageSetup.horizontalDpi/verticalDpi = 4294967295 (uint32 -1) — absent du
 *    gabarit ; Excel échoue au chargement XML de la feuille.
 * 2) Dans sheetPr, exceljs inverse outlinePr et pageSetUpPr. Le schéma
 *    (CT_SheetPr) exige tabColor?, outlinePr?, pageSetUpPr?.
 */
const EXCELJS_INVALID_DPI = '4294967295';

function reorderSheetPrChildren(xml) {
  return xml.replace(/<sheetPr([^>]*)>([\s\S]*?)<\/sheetPr>/g, (full, attrs, inner) => {
    const tabColor = inner.match(/<tabColor\b[^>]*\/>/);
    const outlinePr = inner.match(/<outlinePr\b[^>]*\/>/);
    const pageSetUpPr = inner.match(/<pageSetUpPr\b[^>]*\/>/);
    if (!outlinePr || !pageSetUpPr) return full;
    const outlineIdx = inner.indexOf(outlinePr[0]);
    const pageIdx = inner.indexOf(pageSetUpPr[0]);
    if (pageIdx >= outlineIdx) return full;
    let rest = inner.replace(outlinePr[0], '').replace(pageSetUpPr[0], '');
    if (tabColor) rest = rest.replace(tabColor[0], '');
    const ordered = `${tabColor ? tabColor[0] : ''}${outlinePr[0]}${pageSetUpPr[0]}${rest}`;
    return `<sheetPr${attrs}>${ordered}</sheetPr>`;
  });
}

function sanitizeExceljsWorksheetXml(buffer) {
  const zip = new AdmZip(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  let patched = 0;
  for (const entry of zip.getEntries()) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName)) continue;
    let xml = entry.getData().toString('utf8');
    const before = xml;
    if (xml.includes(EXCELJS_INVALID_DPI)) {
      const dpiAttr = new RegExp(`\\s+(horizontalDpi|verticalDpi)="${EXCELJS_INVALID_DPI}"`, 'g');
      xml = xml.replace(dpiAttr, '');
    }
    xml = reorderSheetPrChildren(xml);
    if (xml !== before) {
      zip.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
      patched += 1;
    }
  }
  return patched ? zip.toBuffer() : Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

const TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'templates',
  'ANNEXE_F_-_Checklist_CQ_BIM.xlsx'
);

const SHEET_FICHE = 'Fiche modèle';
const SHEET_SYNTHESE = 'Synthèse';

/** Lignes d'identité : libellé en A (fusion A:B), valeur en C (fusion C:H). */
const IDENTITY_ROWS = {
  projet: 2,
  numeroProjet: 3,
  client: 4,
  maquette: 5,
  // 6–10, 13–14 : laissés vides (signature / décisions humaines)
  dateControle: 11,
  revision: 12,
};

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
  }
  return String(value);
}

function formatNum(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.?0+$/, '');
}

/**
 * Formulation courte FR pour la colonne « Valeur relevée » (pas de JSON).
 * Alignée sur la logique d'affichage UI.
 */
function formatValeurRelevee(result) {
  if (!result) return '';
  if (result.etat_extraction === 'echec') {
    return 'Échec d’extraction';
  }
  const j = result.valeur_json;
  const u = result.unite ? ` ${result.unite}` : '';

  if (result.controlCode === 'G408' && j) {
    const crit = j.parNiveau?.critique ?? j.critical ?? 0;
    const faible = j.parNiveau?.faible ?? 0;
    return `${j.total ?? result.valeur_num ?? 0} avertissement(s) — ${crit} critique(s), ${faible} faible(s)`;
  }
  if (result.controlCode === 'G504' && j?.couverture) {
    const c = j.couverture;
    return `Couverture ${formatNum(c.pourcentage ?? result.valeur_num)} % (${c.numerateur ?? '—'}/${c.denominateur ?? '—'})`;
  }
  if (result.controlCode === 'G102' && (result.valeur_num != null || j?.mo != null)) {
    return `${formatNum(result.valeur_num ?? j.mo)} Mo`;
  }
  if (j?.couverture && j.couverture.pourcentage != null) {
    return `${formatNum(j.couverture.pourcentage)} % (${j.couverture.numerateur}/${j.couverture.denominateur})`;
  }
  if (j?.global?.pourcentage != null) {
    return `${formatNum(j.global.pourcentage)} %`;
  }
  if (j?.pourcentageConformite != null) {
    return `${formatNum(j.pourcentageConformite)} % de conformité`;
  }
  if (Array.isArray(j?.phases)) {
    return j.phases.length ? j.phases.join(', ') : 'Aucune phase';
  }
  if (Array.isArray(j?.variantes)) {
    return `${j.variantes.length} variante(s)`;
  }
  if (j?.nomFichier) return String(j.nomFichier);
  if (j?.ecartMaxAbs != null) return `Écart max. ${formatNum(j.ecartMaxAbs)} ${j.unite || 'm'}`;
  if (j?.angleNordProjet != null) return `${formatNum(j.angleNordProjet, 3)}°`;
  if (j?.aucunParametre) return 'Aucun paramètre configuré';
  if (j?.nbFautifs != null) return `${j.nbFautifs} élément(s) fautif(s)`;
  if (result.valeur_text) return String(result.valeur_text);
  if (result.valeur_num != null) return `${formatNum(result.valeur_num)}${u}`;
  return '';
}

/** conforme → OK ; non_conforme → À réviser ; sinon vide. */
function formatStatutFiche(result) {
  if (!result || result.etat_extraction === 'echec') return '';
  if (result.statut === 'conforme') return 'OK';
  if (result.statut === 'non_conforme') return 'À réviser';
  return '';
}

function extractG105Identity(result) {
  if (!result || result.etat_extraction === 'echec') return { numeroProjet: null, client: null };
  const j = result.valeur_json || {};
  const champs = j.champs && typeof j.champs === 'object' ? j.champs : {};
  // Infos projet enrichies éventuelles
  const fromTable = Array.isArray(j.infosProjet?.champs) ? j.infosProjet.champs : [];
  const byCle = {};
  for (const ch of fromTable) {
    if (ch?.cle) byCle[ch.cle] = ch.valeurRelevee;
  }
  const numero =
    (champs.number && String(champs.number).trim()) ||
    (byCle.number && String(byCle.number).trim()) ||
    null;
  const client =
    (champs.clientName && String(champs.clientName).trim()) ||
    (byCle.clientName && String(byCle.clientName).trim()) ||
    null;
  return {
    numeroProjet: numero || null,
    client: client || null,
  };
}

function modelBaseName(modelName) {
  const raw = String(modelName || 'modele').trim() || 'modele';
  return raw.replace(/\.rvt$/i, '');
}

function sanitizeFileName(name) {
  return String(name || 'modele')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'modele';
}

function buildDownloadFileName(modelName) {
  return `QC_${sanitizeFileName(modelBaseName(modelName))}.xlsx`;
}

function formatDateControle(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-CA');
  } catch {
    return '';
  }
}

/** Index colonne A → numéro de ligne (identifiants Gxxx uniquement). */
function indexControlRows(worksheet) {
  const map = new Map();
  worksheet.eachRow((row, rowNumber) => {
    const id = cellText(row.getCell(1).value).trim();
    if (/^G\d{3}$/i.test(id)) {
      map.set(id.toUpperCase(), rowNumber);
    }
  });
  return map;
}

function setIdentityValue(ws, row, value) {
  if (value == null || value === '') return;
  // Valeur dans la zone C:H (pas A:B = libellés fusionnés)
  ws.getCell(row, 3).value = value;
}

class QcFicheExcelService {
  /**
   * @param {string} runId
   * @returns {Promise<{ buffer: Buffer, fileName: string, meta: object }>}
   */
  async buildFiche(runId) {
    const detail = await qcRunDetailService.getRunDetail(runId);
    const { run, results, summary } = detail;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);

    const fiche = workbook.getWorksheet(SHEET_FICHE);
    const synthese = workbook.getWorksheet(SHEET_SYNTHESE);
    if (!fiche || !synthese) {
      throw httpError(500, 'Gabarit QC incomplet (feuilles manquantes)');
    }

    const g105 = results.find((r) => r.controlCode === 'G105');
    const fromG105 = extractG105Identity(g105);

    setIdentityValue(fiche, IDENTITY_ROWS.projet, run.projectName || '');
    setIdentityValue(fiche, IDENTITY_ROWS.numeroProjet, fromG105.numeroProjet || '');
    setIdentityValue(fiche, IDENTITY_ROWS.client, fromG105.client || '');
    setIdentityValue(fiche, IDENTITY_ROWS.maquette, run.modelName || '');
    setIdentityValue(fiche, IDENTITY_ROWS.dateControle, formatDateControle(run.startedAtUtc));
    setIdentityValue(
      fiche,
      IDENTITY_ROWS.revision,
      run.modelVersion != null ? String(run.modelVersion) : ''
    );

    const ficheIndex = indexControlRows(fiche);
    const syntheseIndex = indexControlRows(synthese);
    const missingInTemplate = [];
    let okCount = 0;
    let aReviserCount = 0;

    for (const result of results) {
      const code = String(result.controlCode || '').toUpperCase();
      const rowFiche = ficheIndex.get(code);
      if (!rowFiche) {
        missingInTemplate.push(code);
        continue;
      }

      const valeur = formatValeurRelevee(result);
      const statut = formatStatutFiche(result);
      const commentaire =
        result.etat_extraction === 'echec' && result.erreur_extraction
          ? String(result.erreur_extraction)
          : '';

      // F = valeur relevée, G = statut, H = commentaire (échec extraction seulement)
      fiche.getCell(rowFiche, 6).value = valeur || null;
      fiche.getCell(rowFiche, 7).value = statut || null;
      if (commentaire) {
        fiche.getCell(rowFiche, 8).value = commentaire;
      }

      if (statut === 'OK') okCount += 1;
      if (statut === 'À réviser') aReviserCount += 1;

      const rowSyn = syntheseIndex.get(code);
      if (rowSyn) {
        synthese.getCell(rowSyn, 3).value = statut || null;
      }
    }

    // En-tête Modèle 1 → nom de maquette (sans .rvt)
    synthese.getCell(2, 3).value = modelBaseName(run.modelName);

    if (missingInTemplate.length) {
      logger.warn(
        `[QC] Fiche Excel run=${run.id}: identifiants absents du gabarit: ${missingInTemplate.join(', ')}`
      );
    }

    const raw = Buffer.from(await workbook.xlsx.writeBuffer());
    const buffer = sanitizeExceljsWorksheetXml(raw);
    const fileName = buildDownloadFileName(run.modelName);

    return {
      buffer,
      fileName,
      meta: {
        runId: run.id,
        modelName: run.modelName,
        summary,
        okCount,
        aReviserCount,
        missingInTemplate,
        filledControls: results.length - missingInTemplate.length,
      },
    };
  }
}

module.exports = new QcFicheExcelService();
module.exports.TEMPLATE_PATH = TEMPLATE_PATH;
module.exports.formatValeurRelevee = formatValeurRelevee;
module.exports.formatStatutFiche = formatStatutFiche;
module.exports.buildDownloadFileName = buildDownloadFileName;
module.exports.sanitizeExceljsWorksheetXml = sanitizeExceljsWorksheetXml;
