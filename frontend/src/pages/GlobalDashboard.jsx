import React from 'react';
import { Link } from 'react-router-dom';

export default function GlobalDashboard() {
  return (
    <div
      style={{
        padding: '48px 64px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.85) 100%)',
        minHeight: 'calc(100vh - 80px)',
        color: '#e2e8f0'
      }}
    >
      <section
        style={{
          maxWidth: 960,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 24
        }}
      >
        <article
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            borderRadius: 20,
            padding: 24,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 20px 45px -20px rgba(15, 23, 42, 0.8)'
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 20, fontWeight: 600 }}>Bienvenue 👋</h2>
          <p style={{ lineHeight: 1.6, fontSize: 14, color: '#cbd5f5' }}>
            Retrouvez ici un aperçu rapide de votre portail APS Publisher. Accédez à vos
            planifications, surveillez les exécutions et explorez vos projets Autodesk en un clin d'œil.
          </p>
          <Link
            to="/planning"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              borderRadius: 12,
              color: '#f8fafc',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 12px 30px -12px rgba(37, 99, 235, 0.6)'
            }}
          >
            🚀 Démarrer une planification
          </Link>
        </article>

        <article
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            borderRadius: 20,
            padding: 24,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 20px 45px -20px rgba(15, 23, 42, 0.8)'
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>Statut rapide</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📂</span>
              <div>
                <strong style={{ display: 'block', fontSize: 14 }}>Projets connectés</strong>
                <span style={{ fontSize: 12, color: '#cbd5f5' }}>
                  Connectez-vous et sélectionnez un hub pour synchroniser vos projets.
                </span>
              </div>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>⏱️</span>
              <div>
                <strong style={{ display: 'block', fontSize: 14 }}>Planifications</strong>
                <span style={{ fontSize: 12, color: '#cbd5f5' }}>
                  Suivez vos jobs planifiés et configurez des exécutions automatiques.
                </span>
              </div>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📈</span>
              <div>
                <strong style={{ display: 'block', fontSize: 14 }}>Dernières exécutions</strong>
                <span style={{ fontSize: 12, color: '#cbd5f5' }}>
                  Consultez les résultats et relancez les jobs si nécessaire.
                </span>
              </div>
            </li>
          </ul>
        </article>

        <article
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            borderRadius: 20,
            padding: 24,
            border: '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 20px 45px -20px rgba(15, 23, 42, 0.8)'
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>Besoin d'aide ?</h3>
          <p style={{ lineHeight: 1.6, fontSize: 13, color: '#cbd5f5' }}>
            Consultez la documentation interne ou contactez votre équipe technique pour toute question
            liée aux autorisations Autodesk et à la planification des publications.
          </p>
        </article>
      </section>
    </div>
  );
}
