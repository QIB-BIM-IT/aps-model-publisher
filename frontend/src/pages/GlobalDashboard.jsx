import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublishJobs, getPDFExportJobs, getRuns, getPDFExportRuns } from '../services/api';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Composant Card
function Card({ children, title, style = {} }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(20px)',
      borderRadius: 16,
      border: '1px solid rgba(148, 163, 184, 0.2)',
      boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
      padding: 24,
      ...style
    }}>
      {title && (
        <h3 style={{
          margin: '0 0 20px 0',
          fontSize: 18,
          fontWeight: 600,
          color: '#0f172a',
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
      background: `linear-gradient(135deg, ${color}15 0%, ${color}08 100%)`,
      borderRadius: 12,
      padding: '20px 24px',
      border: `1px solid ${color}30`,
      display: 'flex',
      alignItems: 'center',
      gap: 16
    }}>
      <div style={{
        fontSize: 36,
        width: 60,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `${color}20`,
        borderRadius: 12
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{value}</div>
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

  function handleJobClick(job, jobType) {
    if (!job) return;
    navigate('/planning', {
      state: {
        preSelectHub: jobType === 'publish' ? job.hubId : null,
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
  
  const totalJobs = allJobs.length;
  const activeJobs = allJobs.filter(j => j.scheduleEnabled).length;
  const totalModels = publishJobs.reduce((sum, j) => sum + (Array.isArray(j.models) ? j.models.length : 0), 0);
  const recentRuns = allRuns.filter(r => {
    const createdAt = new Date(r.createdAt);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return createdAt > last24h;
  }).length;

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

  const statusData = React.useMemo(() => {
    const recent = allRuns.slice(0, 50);
    const statuses = {
      success: 0,
      failed: 0,
      running: 0,
    };
    
    recent.forEach(run => {
      if (statuses[run.status] !== undefined) {
        statuses[run.status]++;
      }
    });
    
    return [
      { name: 'Succès', value: statuses.success, color: '#10b981' },
      { name: 'Échecs', value: statuses.failed, color: '#ef4444' },
      { name: 'En cours', value: statuses.running, color: '#f59e0b' },
    ].filter(d => d.value > 0);
  }, [allRuns]);

  const upcomingJobs = React.useMemo(() => {
    const now = new Date();

    return allJobs
      .filter((j) => j.scheduleEnabled)
      .map((job) => {
        const cronParts = job.cronExpression?.split(' ') || [];
        const minute = cronParts[0] || '0';
        const hour = cronParts[1] || '2';

        const isDaily =
          !minute.includes('*') &&
          !minute.includes('/') &&
          !hour.includes('*') &&
          !hour.includes('/');

        let nextExecution;
        let timeUntil;

        if (isDaily) {
          const next = new Date();
          next.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);

          if (next <= now) {
            next.setDate(next.getDate() + 1);
          }

          nextExecution = next;
          timeUntil = Math.round((next - now) / (1000 * 60 * 60));
        } else {
          nextExecution = null;
          timeUntil = null;
        }

        return {
          ...job,
          nextExecution,
          timeUntil,
          isComplexCron: !isDaily,
        };
      })
      .sort((a, b) => {
        if (a.isComplexCron && !b.isComplexCron) return 1;
        if (!a.isComplexCron && b.isComplexCron) return -1;
        if (a.isComplexCron && b.isComplexCron) return 0;
        return a.nextExecution - b.nextExecution;
      })
      .slice(0, 5);
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
          marginBottom: 32
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
          <KPICard icon="🚀" label="Exécutions (24h)" value={recentRuns} color="#f59e0b" />
        </div>

        {/* Graphiques */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }}>
          <Card title="📊 Répartition des tâches par heure">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="heure" stroke="#64748b" style={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" style={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 8,
                    color: '#fff'
                  }}
                />
                <Bar dataKey="jobs" fill="#2563eb" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="📈 Status des exécutions">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
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
          </Card>
        </div>

        {/* Prochaines exécutions */}
        <Card title="⏰ Prochaines exécutions planifiées" style={{ marginBottom: 24 }}>
          {upcomingJobs.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
              Aucune exécution planifiée
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                      background: 'rgba(239, 246, 255, 0.5)',
                      borderRadius: 10,
                      border: '1px solid rgba(37, 99, 235, 0.15)',
                      gap: 16,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 246, 255, 0.8)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                      e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 246, 255, 0.5)';
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.15)';
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#2563eb', fontFamily: 'monospace' }}>
                      🕐 {hour}:{minute}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1f2937', marginBottom: 2 }}>
                        {job.name || job.projectName || `Projet ${job.projectId?.slice(0, 8) || '?'}`}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {job.projectName || `Projet ${job.projectId?.slice(0, 8)}`} • {job.timezone}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right' }}>
                      {job.isComplexCron ? (
                        <span style={{ fontStyle: 'italic' }}>Variable</span>
                      ) : (
                        `Dans ${job.timeUntil}h`
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#16a34a'
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
                        background: isPublish ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        color: isPublish ? '#1d4ed8' : '#059669'
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
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              Aucune tâche planifiée. Cliquez sur "Planifier une tâche" pour commencer!
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid rgba(148, 163, 184, 0.2)', background: 'rgba(248, 250, 252, 0.5)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>Nom</th>
                    <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>Projet</th>
                    <th style={{ textAlign: 'center', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>Heure</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569', borderRight: '1px solid rgba(148, 163, 184, 0.15)' }}>Timezone</th>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allJobs.map((job, index) => {
                    const cronParts = job.cronExpression?.split(' ') || [];
                    const hour = cronParts[1]?.padStart(2, '0') || '02';
                    const minute = cronParts[0]?.padStart(2, '0') || '00';
                    const isPublish = publishJobs.some(j => j.id === job.id);

                    return (
                      <tr
                        key={job.id}
                        style={{
                          background: index % 2 === 0 ? 'rgba(248, 250, 252, 0.3)' : 'transparent',
                          borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 246, 255, 0.6)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'rgba(248, 250, 252, 0.3)' : 'transparent';
                        }}
                        onClick={() => handleJobClick(job, isPublish ? 'publish' : 'pdf-export')}
                      >
                        <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          {job.name || 'Sans nom'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: isPublish ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            color: isPublish ? '#1d4ed8' : '#059669'
                          }}>
                            {isPublish ? '🚀 Publish' : '📄 PDF'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          {job.projectName || `Projet ${job.projectId?.slice(0, 8) || '?'}`}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 14, fontWeight: 500, fontFamily: 'monospace', borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          🕐 {hour}:{minute}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748b', borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
                          {job.timezone || 'UTC'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            background: job.scheduleEnabled
                              ? (job.status === 'running' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(34, 197, 94, 0.15)')
                              : 'rgba(156, 163, 175, 0.15)',
                            color: job.scheduleEnabled
                              ? (job.status === 'running' ? '#ea580c' : '#16a34a')
                              : '#6b7280'
                          }}>
                            {!job.scheduleEnabled ? 'Pausé' : (job.status || 'idle')}
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
