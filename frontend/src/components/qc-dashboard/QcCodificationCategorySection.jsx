import React, { useCallback, useEffect, useState } from 'react';
import { fetchQcProjectDesignatedElements } from '../../services/api';
import { card } from '../qc-config/qcTheme';
import { labelBuiltinCategoryFr } from '../qc-config/builtinCategoryLabelsFr';
import QcRunViewerPane from '../QcRunViewerPane';
import QcElementsSplitLayout from '../QcElementsSplitLayout';
import { formatDateTime, formatNumber, modelLabel, versionLabel } from './qcDashboardShared';

const VIOLET = '#7c3aed';
const VIOLET_DARK = '#6d28d9';

const IDLE_ALL_MODELS =
  'Choisissez une maquette dans le filtre pour afficher sa vue 3D. Aucun modèle unique ne peut être chargé tant que toutes les maquettes sont listées.';

/**
 * Répartition G504 par catégorie + isolation des éléments sans code.
 * Les totaux « concernés / taux » par catégorie n’existent pas dans la valeur
 * structurée : on affiche le nombre d’éléments désignés (sans code) et on
 * isole leurs GUID, déjà portés par qc.designated_elements.
 */
export default function QcCodificationCategorySection({
  projectId,
  accModelGuid,
  current,
}) {
  const selected = accModelGuid
    ? (current || []).find(
        (m) => String(m.accModelGuid).toLowerCase() === String(accModelGuid).toLowerCase()
      )
    : null;
  const singleModel = Boolean(accModelGuid && selected);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [isolateRequest, setIsolateRequest] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    setActiveCategory(null);
    setIsolateRequest(null);
    setStatusMsg('');
  }, [accModelGuid, projectId]);

  useEffect(() => {
    if (!projectId || !singleModel) {
      setGroups([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchQcProjectDesignatedElements(projectId, {
      controlCode: 'G504',
      accModelGuid,
      groupBy: 'category',
    })
      .then((data) => {
        if (cancelled) return;
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Impossible de charger la répartition par catégorie');
        setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, accModelGuid, singleModel]);

  const isolateCategory = useCallback(
    async (group) => {
      if (!singleModel || !group) return;
      setActiveCategory(group.category);
      setStatusMsg('');
      if (!group.withUniqueId) {
        setIsolateRequest({
          uniqueIds: [],
          label: labelBuiltinCategoryFr(group.category) || 'Cette catégorie',
          emptyMessage: 'Aucun élément sans code isolable dans cette catégorie.',
        });
        setStatusMsg('Aucun élément sans code isolable dans cette catégorie.');
        return;
      }
      try {
        const data = await fetchQcProjectDesignatedElements(projectId, {
          controlCode: 'G504',
          accModelGuid,
          category: group.category,
          idsOnly: 1,
        });
        const uniqueIds = data?.revitUniqueIds || [];
        const label = labelBuiltinCategoryFr(group.category) || 'Cette catégorie';
        if (!uniqueIds.length) {
          setIsolateRequest({
            uniqueIds: [],
            label,
            emptyMessage: 'Aucun élément sans code isolable dans cette catégorie.',
          });
          setStatusMsg('Aucun élément sans code isolable dans cette catégorie.');
          return;
        }
        setIsolateRequest({
          uniqueIds,
          label,
          notFoundMessage:
            'Ces objets n’apparaissent pas dans la vue 3D (vue, famille, ou éléments absents de la traduction).',
        });
        setViewerOpen(true);
      } catch (err) {
        setStatusMsg(err?.message || 'Impossible de charger les identifiants de cette catégorie.');
      }
    },
    [projectId, accModelGuid, singleModel]
  );

  const left = (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
        Éléments sans code, par catégorie
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
        Catégories du contrôle de codification UNIFORMAT. Un clic isole dans la maquette les
        objets sans code de cette catégorie. Les libellés sont ceux de l’interface Revit.
      </p>
      {!singleModel ? (
        <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          {IDLE_ALL_MODELS}
        </p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Chargement de la répartition…</p>
      ) : error ? (
        <p style={{ margin: 0, fontSize: 13, color: '#b45309' }}>{error}</p>
      ) : !groups.length ? (
        <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          Aucun élément sans code sur cette maquette. Rien à isoler par catégorie.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map((g) => {
            const active = g.category === activeCategory;
            const label = labelBuiltinCategoryFr(g.category) || 'Sans catégorie';
            return (
              <button
                key={g.category || '(vide)'}
                type="button"
                onClick={() => isolateCategory(g)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: active ? `1px solid ${VIOLET}` : '1px solid rgba(148, 163, 184, 0.35)',
                  background: active ? 'rgba(124, 58, 237, 0.1)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'baseline',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: active ? VIOLET_DARK : '#0f172a' }}>
                  {label}
                </span>
                <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                  {formatNumber(g.count)} sans code
                  {g.withUniqueId ? ` · ${formatNumber(g.withUniqueId)} isolables` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {statusMsg ? (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#92400e',
            fontSize: 13,
          }}
        >
          {statusMsg}
        </div>
      ) : null}
    </div>
  );

  const runId = singleModel ? selected.runId : null;
  const subtitle = singleModel
    ? `${modelLabel(selected)} · ${formatDateTime(selected.endedAtUtc || selected.startedAtUtc)} · ${versionLabel(selected.modelVersion)}. Les identifiants 3D correspondent à cette version ; une publication ultérieure peut les invalider.`
    : null;

  const right = (
    <QcRunViewerPane
      runId={runId}
      open={viewerOpen}
      onToggle={() => setViewerOpen((v) => !v)}
      isolateRequest={singleModel ? isolateRequest : null}
      subtitle={subtitle}
      idleMessage={IDLE_ALL_MODELS}
    />
  );

  return (
    <div style={card}>
      <QcElementsSplitLayout open={viewerOpen} left={left} right={right} />
    </div>
  );
}
