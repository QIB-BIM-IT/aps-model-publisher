// src/services/qcDesignatedElements.service.js
// Aplatit les listes d'éléments/objets désignés depuis valeur_json (addin)
// vers des lignes LONGUES, et réduit valeur_json à un extrait court pour
// l'UI / la fiche Excel existantes. Le scoring n'utilise PAS ce module.

const SAFETY_CAP = 50000;
const VALEUR_JSON_EXCERPT = 100;

function asId(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asUniqueId(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > 128 ? null : s;
}

function asStr(v, max) {
  if (v == null) return null;
  const s = String(v);
  if (!s) return null;
  return max && s.length > max ? s.slice(0, max) : s;
}

function row({
  id,
  uniqueId,
  category,
  familyName,
  typeName,
  levelName,
  label,
  kind,
  details,
}) {
  const revitElementId = asId(id);
  return {
    revitElementId,
    revitUniqueId: asUniqueId(uniqueId),
    category: asStr(category, 255),
    familyName: asStr(familyName, 255),
    typeName: asStr(typeName, 255),
    levelName: asStr(levelName, 255),
    label: asStr(label, 512) || (revitElementId != null ? String(revitElementId) : null),
    kind: kind || (revitElementId != null ? 'element' : 'name'),
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : {},
  };
}

function push(rows, item) {
  if (rows.length >= SAFETY_CAP) return false;
  rows.push(item);
  return true;
}

function namedRows(list, kind, labelOf) {
  const rows = [];
  if (!Array.isArray(list)) return { rows, realCount: 0 };
  for (const item of list) {
    const label = labelOf ? labelOf(item) : typeof item === 'string' ? item : item?.nom || item?.name;
    if (!push(rows, row({ label, kind, id: item?.id, details: typeof item === 'object' ? { ...item } : { nom: item } }))) {
      break;
    }
  }
  return { rows, realCount: list.length };
}

/**
 * @returns {{ rows: object[], realCount: number, hitSafetyCap: boolean }}
 */
function extractRows(controlCode, valeurJson) {
  const empty = { rows: [], realCount: 0, hitSafetyCap: false };
  if (!valeurJson || typeof valeurJson !== 'object') return empty;

  let extracted;
  switch (controlCode) {
    case 'G111':
    case 'G203':
    case 'G205':
      extracted = fromFautifs(valeurJson.fautifs);
      break;
    case 'G314':
      extracted = fromG314(valeurJson);
      break;
    case 'G210':
      extracted = fromG210(valeurJson);
      break;
    case 'G410':
      extracted = fromG410(valeurJson);
      break;
    case 'G412':
      extracted = fromG412(valeurJson);
      break;
    case 'G504':
      extracted = fromG504(valeurJson);
      break;
    case 'G508':
      extracted = fromG508(valeurJson);
      break;
    case 'G402':
      extracted = namedRows(valeurJson.variantes, 'option', (v) => (typeof v === 'string' ? v : v?.nom));
      break;
    case 'G404':
      extracted = namedRows(valeurJson.sousProjets, 'workset');
      break;
    case 'G406':
    case 'G407':
      extracted = namedRows(valeurJson.phases, 'phase');
      break;
    case 'G411':
      extracted = namedRows(valeurJson.groupesInutilises, 'type');
      break;
    case 'G502':
      extracted = namedRows(valeurJson.parametres, 'parameter');
      break;
    case 'G507':
      extracted = fromG507(valeurJson);
      break;
    default:
      return empty;
  }

  return {
    rows: extracted.rows,
    realCount: extracted.realCount,
    hitSafetyCap: extracted.realCount > SAFETY_CAP || extracted.rows.length >= SAFETY_CAP && extracted.realCount > extracted.rows.length,
  };
}

function fromFautifs(fautifs) {
  const rows = [];
  if (!Array.isArray(fautifs)) return { rows, realCount: 0 };
  for (const f of fautifs) {
    if (
      !push(
        rows,
        row({
          id: f.id,
          uniqueId: f.uniqueId,
          category: f.categorie,
          familyName: f.familleRevit || f.famille,
          typeName: f.type || f.nomType,
          levelName: f.niveauDeclare || f.niveau,
          label: f.nom || f.type || f.familleRevit,
          kind: 'element',
          details: { ...f },
        })
      )
    ) {
      break;
    }
  }
  return { rows, realCount: fautifs.length };
}

function fromG314(j) {
  const liste = j.fautifsDetail?.liste;
  const realCount = Number.isFinite(j.fautifsDetail?.total)
    ? j.fautifsDetail.total
    : Number.isFinite(j.fautifs)
      ? j.fautifs
      : Array.isArray(liste)
        ? liste.length
        : 0;
  const rows = [];
  if (!Array.isArray(liste)) return { rows, realCount };
  for (const f of liste) {
    if (
      !push(
        rows,
        row({
          id: f.id,
          uniqueId: f.uniqueId,
          category: f.categorie,
          familyName: f.familleRevit,
          typeName: f.type,
          levelName: f.niveauDeclare || f.niveauPlage || f.baseLevel,
          label: f.type || f.familleRevit || (f.id != null ? String(f.id) : null),
          kind: 'element',
          details: {
            famille: f.famille,
            groupe: f.groupe,
            raison: f.raison,
            niveauDeclare: f.niveauDeclare,
            niveauPlage: f.niveauPlage,
            decalageMm: f.decalageMm,
            elevationEffectiveMm: f.elevationEffectiveMm,
            plageNiveauMm: f.plageNiveauMm,
            baseLevel: f.baseLevel,
            topLevel: f.topLevel,
          },
        })
      )
    ) {
      break;
    }
  }
  return { rows, realCount };
}

function fromG210(j) {
  const rows = [];
  let realCount = 0;
  for (const cat of ['axes', 'niveaux']) {
    const block = j[cat]?.nonMonitoresFautifs;
    if (!block) continue;
    const total = Number.isFinite(block.total) ? block.total : 0;
    realCount += total;
    const elements = Array.isArray(block.elements) ? block.elements : null;
    const noms = Array.isArray(block.noms) ? block.noms : [];
    const ids = Array.isArray(block.ids) ? block.ids : [];
    const uniqueIds = Array.isArray(block.uniqueIds) ? block.uniqueIds : [];
    const n = elements ? elements.length : Math.max(noms.length, ids.length);
    for (let i = 0; i < n; i++) {
      const el = elements ? elements[i] : null;
      const nom = el?.nom || noms[i];
      const id = el?.id != null ? el.id : ids[i];
      const uniqueId = el?.uniqueId != null ? el.uniqueId : uniqueIds[i];
      if (
        !push(
          rows,
          row({
            id,
            uniqueId,
            label: nom,
            kind: asId(id) != null ? 'element' : 'name',
            category: cat === 'axes' ? 'Grilles' : 'Niveaux',
            levelName: cat === 'niveaux' ? nom : null,
            details: { categorieAudit: cat, nom },
          })
        )
      ) {
        return { rows, realCount };
      }
    }
  }
  return { rows, realCount: realCount || rows.length };
}

function fromG410(j) {
  const noms = Array.isArray(j.vuesNonPlacees) ? j.vuesNonPlacees : [];
  const ids = Array.isArray(j.vuesIds) ? j.vuesIds : [];
  const uniqueIds = Array.isArray(j.vuesUniqueIds) ? j.vuesUniqueIds : [];
  const realCount = Number.isFinite(j.nbVuesNonPlacees) ? j.nbVuesNonPlacees : noms.length;
  const rows = [];
  const n = Math.max(noms.length, ids.length);
  for (let i = 0; i < n; i++) {
    if (
      !push(
        rows,
        row({
          id: ids[i],
          uniqueId: uniqueIds[i],
          label: noms[i],
          kind: asId(ids[i]) != null ? 'view' : 'view',
          details: { nom: noms[i] },
        })
      )
    ) {
      break;
    }
  }
  return { rows, realCount };
}

function fromG412(j) {
  const rows = [];
  const inPlace = Array.isArray(j.famillesInPlace?.liste) ? j.famillesInPlace.liste : [];
  const unique = Array.isArray(j.groupes?.listeInstanceUnique) ? j.groupes.listeInstanceUnique : [];
  const realCount =
    (Number.isFinite(j.famillesInPlace?.nbFamillesInPlace) ? j.famillesInPlace.nbFamillesInPlace : inPlace.length) +
    (Number.isFinite(j.groupes?.nbGroupesInstanceUnique) ? j.groupes.nbGroupesInstanceUnique : unique.length);

  for (const f of inPlace) {
    if (
      !push(
        rows,
        row({
          id: f.id,
          uniqueId: f.uniqueId,
          familyName: f.famille,
          label: f.famille,
          kind: 'family',
          details: { nbInstances: f.nbInstances, source: 'famillesInPlace' },
        })
      )
    ) {
      return { rows, realCount };
    }
  }
  for (const g of unique) {
    if (
      !push(
        rows,
        row({
          id: g.idInstance,
          uniqueId: g.uniqueId,
          category: g.categorie,
          typeName: g.nomType,
          label: g.nomType,
          kind: 'element',
          details: {
            source: 'groupesInstanceUnique',
            idType: g.idType,
            nbMembres: g.nbMembres,
            pinned: g.pinned,
            viewSpecific: g.viewSpecific,
          },
        })
      )
    ) {
      break;
    }
  }
  return { rows, realCount };
}

function fromG504(j) {
  const rows = [];
  if (Array.isArray(j.instancesFautives)) {
    for (const f of j.instancesFautives) {
      if (
        !push(
          rows,
          row({
            id: f.id,
            uniqueId: f.uniqueId,
            category: f.categorie,
            familyName: f.famille,
            typeName: f.nomType,
            label: f.nomType || f.famille,
            kind: 'element',
            details: { raison: f.raison, nature: 'instance' },
          })
        )
      ) {
        break;
      }
    }
    const realCount = Number.isFinite(j.nbEntitesFautives) ? j.nbEntitesFautives : j.instancesFautives.length;
    return { rows, realCount };
  }
  if (Array.isArray(j.typesFautifs)) {
    let instanceCount = 0;
    for (const t of j.typesFautifs) {
      const ids = Array.isArray(t.idsEchantillon) ? t.idsEchantillon : [];
      const uniqueIds = Array.isArray(t.uniqueIdsEchantillon) ? t.uniqueIdsEchantillon : [];
      instanceCount += Number.isFinite(t.nbInstances) ? t.nbInstances : ids.length;
      if (ids.length) {
        for (let i = 0; i < ids.length; i++) {
          if (
            !push(
              rows,
              row({
                id: ids[i],
                uniqueId: uniqueIds[i],
                category: t.categorie,
                familyName: t.famille,
                typeName: t.nomType,
                label: t.nomType || t.famille,
                kind: 'element',
                details: { raison: t.raison, nature: 'type', nbInstances: t.nbInstances },
              })
            )
          ) {
            return { rows, realCount: instanceCount };
          }
        }
      } else {
        if (
          !push(
            rows,
            row({
              category: t.categorie,
              familyName: t.famille,
              typeName: t.nomType,
              label: t.nomType || t.famille,
              kind: 'type',
              details: { raison: t.raison, nature: 'type', nbInstances: t.nbInstances },
            })
          )
        ) {
          return { rows, realCount: instanceCount || j.typesFautifs.length };
        }
      }
    }
    return { rows, realCount: instanceCount || j.typesFautifs.length };
  }
  return { rows, realCount: 0 };
}

function fromG508(j) {
  const rows = [];
  const params = Array.isArray(j.parametres) ? j.parametres : [];
  let realCount = 0;
  for (const p of params) {
    const ids = Array.isArray(p.idsEchantillon) ? p.idsEchantillon : [];
    const uniqueIds = Array.isArray(p.uniqueIdsEchantillon) ? p.uniqueIdsEchantillon : [];
    realCount += Number.isFinite(p.nbFautifs) ? p.nbFautifs : ids.length;
    for (let i = 0; i < ids.length; i++) {
      if (
        !push(
          rows,
          row({
            id: ids[i],
            uniqueId: uniqueIds[i],
            label: p.nom,
            kind: 'element',
            details: {
              parametre: p.nom,
              natureDetectee: p.natureDetectee,
              parametreAbsent: p.parametreAbsent,
            },
          })
        )
      ) {
        return { rows, realCount };
      }
    }
  }
  return { rows, realCount };
}

function fromG507(j) {
  if (Array.isArray(j.parametres) && j.parametres.some((p) => p && typeof p === 'object' && 'present' in p)) {
    const manquants = j.parametres.filter((p) => p && p.present === false);
    return namedRows(manquants.length ? manquants : j.parametres, 'parameter', (p) => p.nom);
  }
  if (Array.isArray(j.detail)) {
    return namedRows(j.detail, 'parameter', (p) => p.nom);
  }
  return namedRows(j.parametresPartages, 'parameter');
}

function sliceArr(arr, n) {
  if (!Array.isArray(arr)) return arr;
  return arr.slice(0, n);
}

/**
 * Conserve compteurs / synthèses ; réduit les listes autrefois plafonnées à 100/200
 * pour ne pas casser la page de détail ni gonfler valeur_json.
 */
function slimValeurJson(controlCode, valeurJson, { hitSafetyCap, realCount } = {}) {
  if (!valeurJson || typeof valeurJson !== 'object') return valeurJson;
  const j = { ...valeurJson };

  if (Array.isArray(j.fautifs)) j.fautifs = sliceArr(j.fautifs, VALEUR_JSON_EXCERPT);

  if (j.fautifsDetail && typeof j.fautifsDetail === 'object') {
    j.fautifsDetail = {
      ...j.fautifsDetail,
      liste: sliceArr(j.fautifsDetail.liste, VALEUR_JSON_EXCERPT),
      listeTronquee: hitSafetyCap ? true : false,
    };
  }

  for (const cat of ['axes', 'niveaux']) {
    if (j[cat]?.nonMonitoresFautifs) {
      const block = { ...j[cat].nonMonitoresFautifs };
      block.noms = sliceArr(block.noms, VALEUR_JSON_EXCERPT);
      if (Array.isArray(block.elements)) block.elements = sliceArr(block.elements, VALEUR_JSON_EXCERPT);
      if (Array.isArray(block.ids)) block.ids = sliceArr(block.ids, VALEUR_JSON_EXCERPT);
      if (Array.isArray(block.uniqueIds)) block.uniqueIds = sliceArr(block.uniqueIds, VALEUR_JSON_EXCERPT);
      block.listeTronquee = hitSafetyCap ? true : false;
      j[cat] = { ...j[cat], nonMonitoresFautifs: block };
    }
  }

  if (Array.isArray(j.vuesNonPlacees)) j.vuesNonPlacees = sliceArr(j.vuesNonPlacees, VALEUR_JSON_EXCERPT);
  if (Array.isArray(j.vuesIds)) j.vuesIds = sliceArr(j.vuesIds, VALEUR_JSON_EXCERPT);
  if (Array.isArray(j.vuesUniqueIds)) j.vuesUniqueIds = sliceArr(j.vuesUniqueIds, VALEUR_JSON_EXCERPT);

  if (j.famillesInPlace && typeof j.famillesInPlace === 'object') {
    j.famillesInPlace = {
      ...j.famillesInPlace,
      liste: sliceArr(j.famillesInPlace.liste, VALEUR_JSON_EXCERPT),
      listeTronquee: hitSafetyCap ? true : false,
    };
  }
  if (j.groupes && typeof j.groupes === 'object') {
    j.groupes = {
      ...j.groupes,
      listeInstanceUnique: sliceArr(j.groupes.listeInstanceUnique, VALEUR_JSON_EXCERPT),
      listeTronquee: hitSafetyCap ? true : false,
    };
  }

  if (Array.isArray(j.typesFautifs)) {
    j.typesFautifs = j.typesFautifs.map((t) => ({
      ...t,
      idsEchantillon: sliceArr(t.idsEchantillon, VALEUR_JSON_EXCERPT),
      uniqueIdsEchantillon: sliceArr(t.uniqueIdsEchantillon, VALEUR_JSON_EXCERPT),
      listeIdsTronquee: hitSafetyCap ? true : false,
    }));
  }
  if (Array.isArray(j.instancesFautives)) j.instancesFautives = sliceArr(j.instancesFautives, VALEUR_JSON_EXCERPT);

  if (Array.isArray(j.parametres) && j.parametres.some((p) => p && Array.isArray(p.idsEchantillon))) {
    j.parametres = j.parametres.map((p) => ({
      ...p,
      idsEchantillon: sliceArr(p.idsEchantillon, VALEUR_JSON_EXCERPT),
      uniqueIdsEchantillon: sliceArr(p.uniqueIdsEchantillon, VALEUR_JSON_EXCERPT),
      listeTronquee: hitSafetyCap ? true : false,
    }));
  }

  if (controlCode === 'G111' || controlCode === 'G203' || controlCode === 'G205' || controlCode === 'G410' || controlCode === 'G504') {
    j.listeTronquee = hitSafetyCap ? true : false;
  }

  if (hitSafetyCap) {
    j.listePlafondSecurite = true;
    j.listePlafondSecuriteCompte = realCount;
  }

  return j;
}

async function bulkInsert(Model, rows, transaction) {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Model.bulkCreate(rows.slice(i, i + CHUNK), { transaction });
  }
}

module.exports = {
  SAFETY_CAP,
  VALEUR_JSON_EXCERPT,
  extractRows,
  slimValeurJson,
  bulkInsert,
};
