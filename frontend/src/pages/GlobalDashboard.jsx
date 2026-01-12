import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublishJobs, getPDFExportJobs, getRuns, getPDFExportRuns } from '../services/api';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Composant Card
function Card({ children, title, style = {} }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 100%)',
      backdropFilter: 'blur(20px)',
      borderRadius: 16,
      border: '1px solid rgba(148, 163, 184, 0.2)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      padding: 24,
      ...style
    }}>
      {title && (
        <h3 style={{
          margin: '0 0 20px 0',
          fontSize: 18,
          fontWeight: 600,
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

// KPI Card
function KPICard({ icon, label, value, color = '#2563eb' }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${color}20 0%, ${color}10 100%)`,
      backdropFilter: 'blur(10px)',
      borderRadius: 12,
      padding: '20px 24px',
      border: `1px solid ${color}40`,
      boxShadow: `0 4px 16px ${color}20, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      transition: 'transform 0.2s, box-shadow 0.2s'
    }}>
      <div style={{
        fontSize: 36,
        width: 60,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `${color}30`,
        borderRadius: 12,
        boxShadow: `0 4px 12px ${color}30`
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
      </div>
    </div>
  );
}

export default function GlobalDashboard() {
  const navigate = useNavigate();
  const [publishJobs, setPublishJobs] = React.useState([]);
  const [pdfJobs, setPdfJobs] = React.useState([]);
  const [publishRuns, setPublishRuns] = React.useState([]);
  const [pdfRuns, setPdfRuns] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [timeFilter, setTimeFilter] = React.useState('forever'); // day, week, month, year, forever

  function handleJobClick(job, jobType) {
    if (!job) return;
    
    // Utiliser hubId s'il existe (pour publish et pdf si disponible)
    // Sinon, passer null et PlanningPage devra trouver le hub depuis le projet
    const hubId = job.hubId || null;
    
    navigate('/planning', {
      state: {
        preSelectHub: hubId,
        preSelectProject: job.projectId,
        highlightJobId: job.id,
        preSelectJobType: jobType,
      },
    });
  }

  async function loadAllData() {
    setLoading(true);
    setError('');
    try {
      const [pjobs, pdfjobs, pruns, pdfruns] = await Promise.all([
        getPublishJobs({}),
        getPDFExportJobs({}),
        getRuns({ limit: 100 }),
        getPDFExportRuns({ limit: 100 }),
      ]);
      
      setPublishJobs(pjobs);
      setPdfJobs(pdfjobs);
      setPublishRuns(pruns);
      setPdfRuns(pdfruns);
    } catch (e) {
      setError(e?.message || 'Erreur chargement des données');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 30000);
    return () => clearInterval(interval);
  }, []);

  // ========== CALCULS ==========
  const allJobs = [...publishJobs, ...pdfJobs];
  const allRuns = [...publishRuns, ...pdfRuns];
  
  // Filtrage temporel
  const getFilteredRuns = React.useCallback((runs) => {
    if (timeFilter === 'forever') return runs;
    
    const now = Date.now();
    const filters = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    
    const threshold = now - filters[timeFilter];
    return runs.filter(r => {
      const createdAt = new Date(r.createdAt).getTime();
      return createdAt >= threshold;
    });
  }, [timeFilter]);
  
  const filteredRuns = React.useMemo(() => getFilteredRuns(allRuns), [allRuns, getFilteredRuns]);
  
  // KPIs de configuration (statiques - représentent l'état actuel du système)
  const totalJobs = allJobs.length;
  const activeJobs = allJobs.filter(j => j.scheduleEnabled).length;
  const totalModels = publishJobs.reduce((sum, j) => sum + (Array.isArray(j.models) ? j.models.length : 0), 0);
  
  // Nombre de sheets exportées en PDF (pas le nombre de PDFs)
  // Utilise stats.sheetCount qui compte les sheets réelles (même en mode combined)
  const totalSheetsExported = React.useMemo(() => {
    return filteredRuns
      .filter(r => r.jobType === 'pdf-export' || pdfRuns.some(pr => pr.id === r.id))
      .reduce((sum, r) => {
        const sheetCount = r.stats?.sheetCount || r.stats?.uploaded || r.stats?.okCount || 0;
        return sum + sheetCount;
      }, 0);
  }, [filteredRuns, pdfRuns]);
  
  const totalRunsInPeriod = filteredRuns.length;
  
  // 🆕 Métriques de performance par type de job
  const performanceMetrics = React.useMemo(() => {
    // Identifier les runs publish vs PDF
    const completedRuns = filteredRuns.filter(r => 
      r.status === 'success' || r.status === 'partial' || r.status === 'completed'
    );
    
    const publishRunsFiltered = completedRuns.filter(r => {
      // Si jobType est défini, l'utiliser
      if (r.jobType === 'publish') return true;
      // Sinon, vérifier si c'est dans publishRuns
      return publishRuns.some(pr => pr.id === r.id);
    });
    
    const pdfRunsFiltered = completedRuns.filter(r => {
      // Si jobType est défini, l'utiliser
      if (r.jobType === 'pdf-export') return true;
      // Sinon, vérifier si c'est dans pdfRuns
      return pdfRuns.some(pr => pr.id === r.id);
    });
    
    // Calculer temps moyen pour publish
    const publishDurations = publishRunsFiltered.map(r => {
      // 🆕 TODO: Quand webhooks seront actifs, utiliser webhookEndTime - startedAt
      // Pour l'instant, utiliser durationMs ou endedAt - startedAt
      if (r.stats?.webhookEndTime) {
        return new Date(r.stats.webhookEndTime) - new Date(r.startedAt);
      }
      return r.stats?.durationMs || (r.endedAt && r.startedAt ? new Date(r.endedAt) - new Date(r.startedAt) : 0);
    }).filter(d => d > 0);
    
    // Calculer temps moyen pour PDF
    const pdfDurations = pdfRunsFiltered.map(r => {
      // 🆕 TODO: Quand webhooks seront actifs, utiliser webhookEndTime - startedAt
      if (r.stats?.webhookEndTime) {
        return new Date(r.stats.webhookEndTime) - new Date(r.startedAt);
      }
      return r.stats?.durationMs || r.stats?.timing?.totalMs || (r.endedAt && r.startedAt ? new Date(r.endedAt) - new Date(r.startedAt) : 0);
    }).filter(d => d > 0);
    
    // 🆕 Autres métriques intéressantes
    const avgSheetsPerRun = pdfRunsFiltered.length > 0 
      ? Math.round(pdfRunsFiltered.reduce((sum, r) => sum + (r.stats?.sheetCount || 0), 0) / pdfRunsFiltered.length)
      : 0;
    
    const avgModelsPerRun = publishRunsFiltered.length > 0
      ? Math.round(publishRunsFiltered.reduce((sum, r) => sum + (r.stats?.okCount || r.stats?.uploaded || 0), 0) / publishRunsFiltered.length)
      : 0;
    
    // Jobs en file d'attente (si on a cette info dans les stats)
    const queuedJobs = allJobs.filter(j => {
      // 🆕 TODO: Ajouter un champ queuePosition dans les jobs quand ils sont en file
      return j.status === 'queued' || j.status === 'waiting';
    }).length;
    
    // 🆕 Fréquence d'exécution (jobs/jour)
    const getDaysInPeriod = () => {
      const now = Date.now();
      const filters = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
        forever: null,
      };
      return filters[timeFilter] || null;
    };
    
    const daysInPeriod = getDaysInPeriod();
    const executionFrequency = daysInPeriod && daysInPeriod > 0
      ? Math.round((completedRuns.length / daysInPeriod) * 10) / 10
      : null;
    
    // 🆕 Temps d'attente moyen dans la file
    // Utiliser queueWaitMs directement si disponible, sinon calculer
    const queueWaitTimes = completedRuns
      .map(r => {
        // Priorité 1: Utiliser queueWaitMs directement (déjà calculé par le backend)
        if (r.stats?.queueWaitMs && r.stats.queueWaitMs > 0) {
          return r.stats.queueWaitMs;
        }
        // Priorité 2: Calculer depuis queueStartTime et queueEndTime
        if (r.stats?.queueStartTime && r.stats?.queueEndTime) {
          return new Date(r.stats.queueEndTime) - new Date(r.stats.queueStartTime);
        }
        // Priorité 3: Calculer depuis scheduledStartTime (pour jobs schedulés)
        if (r.stats?.scheduledStartTime && r.startedAt) {
          const waitTime = new Date(r.startedAt) - new Date(r.stats.scheduledStartTime);
          // Ne compter que les attentes positives (pas les jobs en avance)
          return waitTime > 0 ? waitTime : 0;
        }
        return null;
      })
      .filter(t => t !== null && t > 0);
    
    const avgQueueWaitMs = queueWaitTimes.length > 0
      ? Math.round(queueWaitTimes.reduce((a, b) => a + b, 0) / queueWaitTimes.length)
      : 0;
    
    return {
      avgPublishMs: publishDurations.length > 0 
        ? Math.round(publishDurations.reduce((a, b) => a + b, 0) / publishDurations.length)
        : 0,
      avgPdfMs: pdfDurations.length > 0
        ? Math.round(pdfDurations.reduce((a, b) => a + b, 0) / pdfDurations.length)
        : 0,
      avgSheetsPerRun,
      avgModelsPerRun,
      queuedJobs,
      executionFrequency,
      avgQueueWaitMs,
      publishRunsCount: publishRunsFiltered.length,
      pdfRunsCount: pdfRunsFiltered.length,
    };
  }, [filteredRuns, publishRuns, pdfRuns, allJobs, timeFilter]);

  const hourlyData = React.useMemo(() => {
    const hours = {};
    allJobs.forEach(job => {
      const cronParts = job.cronExpression?.split(' ') || [];
      const hour = parseInt(cronParts[1] || '0', 10);
      hours[hour] = (hours[hour] || 0) + 1;
    });
    
    return Array.from({ length: 24 }, (_, i) => ({
      heure: `${i}h`,
      jobs: hours[i] || 0
    }));
  }, [allJobs]);

  const projectData = React.useMemo(() => {
    const projects = {};
    allJobs.forEach(job => {
      const projectName = job.projectName || job.projectId?.slice(0, 8) || 'Inconnu';
      projects[projectName] = (projects[projectName] || 0) + 1;
    });
    
    return Object.entries(projects)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [allJobs]);

  // Graphique basé sur les fichiers individuels (pas les runs)
  const fileStatusData = React.useMemo(() => {
    let successFiles = 0;
    let failedFiles = 0;
    let runningFiles = 0;
    
    filteredRuns.forEach(run => {
      if (run.status === 'running') {
        // Pour les runs en cours, estimer basé sur les items
        const items = run.items || [];
        runningFiles += items.length;
      } else {
        // Pour les runs terminés, utiliser les stats
        const stats = run.stats || {};
        successFiles += stats.okCount || stats.uploaded || 0;
        failedFiles += stats.failCount || stats.failed || 0;
      }
    });
    
    return [
      { name: 'Fichiers réussis', value: successFiles, color: '#10b981' },
      { name: 'Fichiers échoués', value: failedFiles, color: '#ef4444' },
      { name: 'En traitement', value: runningFiles, color: '#f59e0b' },
    ].filter(d => d.value > 0);
  }, [filteredRuns]);

  const upcomingJobs = React.useMemo(() => {
    const now = new Date();

    return allJobs
      .filter((j) => j.scheduleEnabled)
      .map((job) => {
        // 🆕 Utiliser nextRun du backend si disponible
        let nextExecution = job.nextRun ? new Date(job.nextRun) : null;
        let timeUntilMs = nextExecution ? nextExecution - now : null;
        
        // Si nextRun n'est pas disponible, fallback sur le calcul simple
        if (!nextExecution) {
          const cronParts = job.cronExpression?.split(' ') || [];
          const minute = cronParts[0] || '0';
          const hour = cronParts[1] || '2';

          const isSimpleCron =
            !minute.includes('*') &&
            !minute.includes('/') &&
            !hour.includes('*') &&
            !hour.includes('/');

          if (isSimpleCron) {
            const next = new Date();
            next.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
            if (next <= now) {
              next.setDate(next.getDate() + 1);
            }
            nextExecution = next;
            timeUntilMs = next - now;
          }
        }
        
        // 🆕 Calculer timeUntil en format lisible (minutes, heures, jours)
        let timeUntilFormatted = null;
        if (timeUntilMs !== null && timeUntilMs > 0) {
          const minutes = Math.floor(timeUntilMs / (1000 * 60));
          const hours = Math.floor(minutes / 60);
          const days = Math.floor(hours / 24);
          
          if (days > 0) {
            timeUntilFormatted = `${days}j ${hours % 24}h`;
          } else if (hours > 0) {
            timeUntilFormatted = `${hours}h ${minutes % 60}min`;
          } else {
            timeUntilFormatted = `${minutes}min`;
          }
        }

        return {
          ...job,
          nextExecution,
          timeUntilMs,
          timeUntilFormatted,
          isComplexCron: !nextExecution,
        };
      })
      .sort((a, b) => {
        if (a.isComplexCron && !b.isComplexCron) return 1;
        if (!a.isComplexCron && b.isComplexCron) return -1;
        if (a.isComplexCron && b.isComplexCron) return 0;
        return (a.nextExecution || 0) - (b.nextExecution || 0);
      });
      // 🆕 Ne plus limiter à 5, afficher toutes les tâches avec scroll
  }, [allJobs]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 18
      }}>
        ⏳ Chargement des données...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      padding: '40px 20px'
    }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24
        }}>
          <div>
            <h1 style={{
              fontSize: 32,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              margin: 0,
              marginBottom: 8
            }}>
              📊 Vue d'ensemble
            </h1>
            <p style={{ color: '#94a3b8', fontSize: 15, margin: 0 }}>
              Toutes les tâches planifiées (Publish & PDF Export)
            </p>
          </div>

          <button
            onClick={() => navigate('/planning')}
            style={{
              padding: '12px 24px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
              transition: 'transform 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}
          >
            ➕ Planifier une tâche
          </button>
        </div>

        {/* Filtre temporel */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(37, 99, 235, 0.03) 100%)',
          backdropFilter: 'blur(20px)',
          borderRadius: 16,
          border: '1px solid rgba(96, 165, 250, 0.2)',
          boxShadow: '0 4px 24px rgba(37, 99, 235, 0.15)',
          padding: 20,
          marginBottom: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#cbd5e1' }}>📅 Période:</span>
            {[
              { value: 'day', label: 'Aujourd\'hui' },
              { value: 'week', label: 'Cette semaine' },
              { value: 'month', label: 'Ce mois' },
              { value: 'year', label: 'Cette année' },
              { value: 'forever', label: 'Tout' }
            ].map(option => (
              <button
                key={option.value}
                onClick={() => setTimeFilter(option.value)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: timeFilter === option.value ? '2px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.3)',
                  background: timeFilter === option.value 
                    ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' 
                    : 'rgba(255, 255, 255, 0.05)',
                  color: timeFilter === option.value ? '#ffffff' : '#cbd5e1',
                  fontSize: 13,
                  fontWeight: timeFilter === option.value ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: timeFilter === option.value ? '0 4px 12px rgba(37, 99, 235, 0.4)' : 'none'
                }}
                onMouseEnter={(e) => {
                  if (timeFilter !== option.value) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.5)';
                    e.currentTarget.style.color = '#f1f5f9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (timeFilter !== option.value) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                    e.currentTarget.style.color = '#cbd5e1';
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: 12,
            marginBottom: 24
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* KPIs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20,
          marginBottom: 32
        }}>
          <KPICard icon="📅" label="Tâches planifiées" value={totalJobs} color="#2563eb" />
          <KPICard icon="✅" label="Tâches actives" value={activeJobs} color="#10b981" />
          <KPICard icon="📦" label="Maquettes (Publish)" value={totalModels} color="#8b5cf6" />
          <KPICard icon="📄" label="Sheets exportées (PDF)" value={totalSheetsExported} color="#10b981" />
          <KPICard icon="🚀" label={`Exécutions (${timeFilter === 'day' ? '24h' : timeFilter === 'week' ? '7j' : timeFilter === 'month' ? '30j' : timeFilter === 'year' ? '365j' : 'Total'})`} value={totalRunsInPeriod} color="#f59e0b" />
        </div>

        {/* 🆕 Métriques de Performance */}
        <Card title="⚡ Temps de traitement moyen" style={{ marginBottom: 24 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 20,
          }}>
            {/* Temps moyen Publish */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
              borderRadius: 12,
              padding: 20,
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>🚀 Publish (temps réel)</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#60a5fa', marginBottom: 4 }}>
                {performanceMetrics.avgPublishMs > 60000 
                  ? `${Math.round(performanceMetrics.avgPublishMs / 60000)}min ${Math.round((performanceMetrics.avgPublishMs % 60000) / 1000)}s` 
                  : performanceMetrics.avgPublishMs > 0
                  ? `${Math.round(performanceMetrics.avgPublishMs / 1000)}s`
                  : 'N/A'}
              </div>
              {performanceMetrics.publishRunsCount > 0 && (
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Basé sur {performanceMetrics.publishRunsCount} exécution{performanceMetrics.publishRunsCount > 1 ? 's' : ''}
                </div>
              )}
              {performanceMetrics.publishRunsCount === 0 && filteredRuns.length > 0 && (
                <div style={{ fontSize: 11, color: '#fbbf24', fontStyle: 'italic' }}>
                  ⏳ Données disponibles après prochaine exécution
                </div>
              )}
            </div>
            
            {/* Temps moyen PDF */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%)',
              borderRadius: 12,
              padding: 20,
              border: '1px solid rgba(16, 185, 129, 0.2)',
            }}>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>📄 PDF Export (temps réel)</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>
                {performanceMetrics.avgPdfMs > 60000 
                  ? `${Math.round(performanceMetrics.avgPdfMs / 60000)}min ${Math.round((performanceMetrics.avgPdfMs % 60000) / 1000)}s` 
                  : performanceMetrics.avgPdfMs > 0
                  ? `${Math.round(performanceMetrics.avgPdfMs / 1000)}s`
                  : 'N/A'}
              </div>
              {performanceMetrics.pdfRunsCount > 0 && (
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Basé sur {performanceMetrics.pdfRunsCount} exécution{performanceMetrics.pdfRunsCount > 1 ? 's' : ''}
                </div>
              )}
              {performanceMetrics.pdfRunsCount === 0 && filteredRuns.length > 0 && (
                <div style={{ fontSize: 11, color: '#fbbf24', fontStyle: 'italic' }}>
                  ⏳ Données disponibles après prochaine exécution
                </div>
              )}
            </div>
          </div>
          
          {performanceMetrics.publishRunsCount === 0 && performanceMetrics.pdfRunsCount === 0 && filteredRuns.length > 0 && (
            <div style={{ 
              marginTop: 16, 
              padding: '12px 16px', 
              background: 'rgba(251, 191, 36, 0.1)', 
              borderRadius: 8,
              fontSize: 12,
              color: '#fbbf24',
              textAlign: 'center'
            }}>
              ℹ️ Les temps réels (incluant webhooks) seront disponibles une fois sur Azure avec les webhooks activés
            </div>
          )}
        </Card>

        {/* 🆕 KPIs supplémentaires */}
        <Card title="📊 Métriques de productivité" style={{ marginBottom: 24 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
          }}>
            {/* Moyenne sheets par exécution PDF */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(16, 185, 129, 0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>📄 Sheets/exécution PDF</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#34d399' }}>
                {performanceMetrics.avgSheetsPerRun > 0 ? performanceMetrics.avgSheetsPerRun : 'N/A'}
              </div>
              {performanceMetrics.pdfRunsCount > 0 && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  {performanceMetrics.pdfRunsCount} exécution{performanceMetrics.pdfRunsCount > 1 ? 's' : ''}
                </div>
              )}
            </div>
            
            {/* Moyenne modèles par exécution Publish */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>🚀 Modèles/exécution Publish</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#60a5fa' }}>
                {performanceMetrics.avgModelsPerRun > 0 ? performanceMetrics.avgModelsPerRun : 'N/A'}
              </div>
              {performanceMetrics.publishRunsCount > 0 && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  {performanceMetrics.publishRunsCount} exécution{performanceMetrics.publishRunsCount > 1 ? 's' : ''}
                </div>
              )}
            </div>
            
            {/* Jobs en file d'attente */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(245, 158, 11, 0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>⏳ Jobs en file</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fbbf24' }}>
                {performanceMetrics.queuedJobs}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                {performanceMetrics.queuedJobs === 0 ? 'Aucune attente' : 'En attente'}
              </div>
            </div>
            
            {/* Fréquence d'exécution */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(139, 92, 246, 0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>📈 Fréquence (jobs/jour)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#a78bfa' }}>
                {performanceMetrics.executionFrequency !== null 
                  ? performanceMetrics.executionFrequency.toFixed(1)
                  : 'N/A'}
              </div>
              {performanceMetrics.executionFrequency !== null && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  {timeFilter === 'day' ? 'Aujourd\'hui' : timeFilter === 'week' ? 'Cette semaine' : timeFilter === 'month' ? 'Ce mois' : timeFilter === 'year' ? 'Cette année' : 'Total'}
                </div>
              )}
            </div>
            
            {/* Temps d'attente moyen dans la file */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15) 0%, rgba(236, 72, 153, 0.05) 100%)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(236, 72, 153, 0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>⏱️ Attente file (avg)</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#f472b6' }}>
                {performanceMetrics.avgQueueWaitMs > 0
                  ? performanceMetrics.avgQueueWaitMs > 60000
                    ? `${Math.round(performanceMetrics.avgQueueWaitMs / 60000)}min`
                    : `${Math.round(performanceMetrics.avgQueueWaitMs / 1000)}s`
                  : '0s'}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                {performanceMetrics.avgQueueWaitMs === 0 
                  ? 'Aucune attente mesurée' 
                  : 'Avec webhooks'}
              </div>
            </div>
          </div>
          
          {performanceMetrics.avgQueueWaitMs === 0 && (
            <div style={{ 
              marginTop: 12, 
              padding: '8px 12px', 
              background: 'rgba(59, 130, 246, 0.1)', 
              borderRadius: 8,
              fontSize: 11,
              color: '#60a5fa',
              textAlign: 'center'
            }}>
              ℹ️ Le temps d'attente dans la file sera mesuré automatiquement avec les webhooks
            </div>
          )}
        </Card>

        {/* Graphiques */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }}>
          <Card title="📊 Répartition des tâches par heure">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                <XAxis dataKey="heure" stroke="#94a3b8" style={{ fontSize: 12, fill: '#cbd5e1' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: 12, fill: '#cbd5e1' }} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    borderRadius: 8,
                    color: '#fff'
                  }}
                />
                <Bar dataKey="jobs" fill="url(#colorGradient)" radius={[8, 8, 0, 0]} />
                <defs>
                  <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="📈 Taux de succès des fichiers">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={fileStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {fileStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 8,
                    color: '#fff'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 20, fontSize: 12, color: '#cbd5e1' }}>
              {fileStatusData.map((entry) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: entry.color, boxShadow: `0 0 8px ${entry.color}60` }} />
                  <span>{entry.name}: <strong style={{ color: '#f1f5f9' }}>{entry.value}</strong></span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Prochaines exécutions */}
        <Card title={`⏰ Prochaines exécutions planifiées (${upcomingJobs.length})`} style={{ marginBottom: 24 }}>
          {upcomingJobs.length === 0 ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>
              Aucune exécution planifiée
            </p>
          ) : (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 12,
              maxHeight: '400px',  // 🆕 Hauteur max avec scroll
              overflowY: 'auto',
              paddingRight: upcomingJobs.length > 5 ? 8 : 0,  // Espace pour scrollbar
            }}>
              {upcomingJobs.map(job => {
                const cronParts = job.cronExpression?.split(' ') || [];
                const hour = cronParts[1]?.padStart(2, '0') || '02';
                const minute = cronParts[0]?.padStart(2, '0') || '00';
                const isPublish = publishJobs.some(j => j.id === job.id);
                const jobType = isPublish ? 'publish' : 'pdf-export';

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleJobClick(job, jobType)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 150px 100px 80px',
                      alignItems: 'center',
                      padding: '14px 16px',
                      background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(37, 99, 235, 0.06) 100%)',
                      borderRadius: 10,
                      border: '1px solid rgba(96, 165, 250, 0.3)',
                      gap: 16,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.15)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(37, 99, 235, 0.2) 0%, rgba(37, 99, 235, 0.1) 100%)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                      e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.5)';
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(37, 99, 235, 0.06) 100%)';
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.3)';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.15)';
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#60a5fa', fontFamily: 'monospace' }}>
                      🕐 {hour}:{minute}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginBottom: 2 }}>
                        {job.name || job.projectName || `Projet ${job.projectId?.slice(0, 8) || '?'}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        {job.projectName || `Projet ${job.projectId?.slice(0, 8)}`} • {job.timezone}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#cbd5e1', textAlign: 'right' }}>
                      {job.isComplexCron ? (
                        <span style={{ fontStyle: 'italic' }}>Variable</span>
                      ) : (
                        `Dans ${job.timeUntilFormatted || '?'}`
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: 'rgba(34, 197, 94, 0.25)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.3)'
                      }}>
                        {job.status || 'idle'}
                      </span>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: isPublish ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)',
                        color: isPublish ? '#60a5fa' : '#34d399',
                        border: `1px solid ${isPublish ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                      }}>
                        {isPublish ? '🚀' : '📄'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Tableau récapitulatif */}
        <Card title="📋 Toutes les tâches planifiées">
          {allJobs.length === 0 ? (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>
              Aucune tâche planifiée. Cliquez sur "Planifier une tâche" pour commencer!
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid rgba(96, 165, 250, 0.3)', background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(37, 99, 235, 0.08) 100%)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Nom</th>
                    <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Projet</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Utilisateur</th>
                    <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Heure</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.2)' }}>Timezone</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allJobs.map((job, index) => {
                    const cronParts = job.cronExpression?.split(' ') || [];
                    const hour = cronParts[1]?.padStart(2, '0') || '02';
                    const minute = cronParts[0]?.padStart(2, '0') || '00';
                    const isPublish = publishJobs.some(j => j.id === job.id);
                    
                    // Trouver le dernier run pour ce job
                    const jobRuns = allRuns.filter(r => r.jobId === job.id);
                    const lastRun = jobRuns.length > 0 
                      ? jobRuns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
                      : null;
                    
                    // Déterminer si le status est en erreur
                    const isError = lastRun && ['failed', 'error', 'timeout'].includes(lastRun.status);
                    const isPartial = lastRun && lastRun.status === 'partial';
                    const isRunning = job.status === 'running';
                    const isSuccess = lastRun && ['success', 'completed'].includes(lastRun.status);

                    // Couleurs du status basées sur le dernier run
                    const getStatusStyle = () => {
                      if (!job.scheduleEnabled) {
                        return {
                          background: 'rgba(156, 163, 175, 0.25)',
                          color: '#94a3b8',
                          border: '1px solid rgba(156, 163, 175, 0.3)'
                        };
                      }
                      if (isRunning) {
                        return {
                          background: 'rgba(251, 146, 60, 0.25)',
                          color: '#fb923c',
                          border: '1px solid rgba(251, 146, 60, 0.4)'
                        };
                      }
                      if (isError) {
                        return {
                          background: 'rgba(239, 68, 68, 0.25)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.4)'
                        };
                      }
                      if (isPartial) {
                        return {
                          background: 'rgba(245, 158, 11, 0.25)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.4)'
                        };
                      }
                      // Par défaut (idle ou success)
                      return {
                        background: 'rgba(34, 197, 94, 0.25)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.4)'
                      };
                    };

                    // Texte du status
                    const getStatusText = () => {
                      if (!job.scheduleEnabled) return 'Pausé';
                      if (isRunning) return 'running';
                      if (isError) return `❌ ${lastRun.status}`;
                      if (isPartial) return '⚠️ partial';
                      if (isSuccess) return '✅ success';
                      return job.status || 'idle';
                    };

                    const statusStyle = getStatusStyle();

                    return (
                      <tr
                        key={job.id}
                        style={{
                          background: index % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                          borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(37, 99, 235, 0.08) 100%)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'transparent';
                        }}
                        onClick={() => handleJobClick(job, isPublish ? 'publish' : 'pdf-export')}
                      >
                        <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#e2e8f0', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          {job.name || 'Sans nom'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: isPublish ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)',
                            color: isPublish ? '#60a5fa' : '#34d399',
                            border: `1px solid ${isPublish ? 'rgba(59, 130, 246, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                          }}>
                            {isPublish ? '🚀 Publish' : '📄 PDF'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#cbd5e1', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          {job.projectName || `Projet ${job.projectId?.slice(0, 8) || '?'}`}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14 }}>👤</span>
                            {job.userName || 'Inconnu'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14, fontWeight: 500, fontFamily: 'monospace', color: '#60a5fa', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          🕐 {hour}:{minute}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          {job.timezone || 'UTC'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            ...statusStyle
                          }}>
                            {getStatusText()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
