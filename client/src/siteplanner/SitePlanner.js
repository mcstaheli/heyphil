import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadProjects, sitePlansApi } from './api';
import { getAssetType } from './assetTypes';
import './SitePlanner.css';

// Dev Tools -> Site Planner: the list of sites. Each opens in the editor
// (SitePlanEditor) at /dev/site-planner/:id.

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function NewSiteModal({ projects, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the site a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { plan } = await sitePlansApi('POST', '', { name, projectId });
      onCreated(plan);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content siteplan-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header"><h2>New site</h2></div>
        <div className="modal-body siteplan-form">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 4th South parcel" maxLength={200} autoFocus />
          </label>
          <label>
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {error && <p className="siteplan-error">{error}</p>}
        </div>
        <div className="modal-footer siteplan-modal-footer">
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create site'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SitePlanner() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    sitePlansApi('GET', '')
      .then((data) => setPlans(data.plans || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    loadProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <div className="siteplan-page">
      <div className="siteplan-header">
        <div>
          <h2>Site Planner</h2>
          <p className="siteplan-subtitle">Draw a site, pick an asset type, and test how much fits. Change any default to see the yield move.</p>
        </div>
        <button className="siteplan-primary-btn" onClick={() => setCreating(true)}>+ New site</button>
      </div>

      <div className="siteplan-list">
        {loading && <p className="siteplan-muted">Loading...</p>}
        {error && <p className="siteplan-error">Failed to load: {error}</p>}
        {!loading && !error && plans.length === 0 && (
          <div className="siteplan-empty">
            <p>No sites yet.</p>
            <button className="btn-primary" onClick={() => setCreating(true)}>Start your first site</button>
          </div>
        )}
        {plans.map((p) => (
          <button key={p.id} className="siteplan-card" onClick={() => navigate(`/dev/site-planner/${p.id}`)}>
            <div className="siteplan-card-name">{p.name}</div>
            <div className="siteplan-card-project">{p.projectTitle || 'No project'}</div>
            <div className="siteplan-card-schemes">
              {(p.schemes || []).map((s) => (
                <span key={s.id} className="siteplan-chip">{s.name}: {getAssetType(s.assetType).label}</span>
              ))}
            </div>
            <div className="siteplan-card-foot">
              {p.boundary ? 'Site drawn' : 'No boundary yet'} · updated {formatDate(p.updatedAt)}
              {p.createdByName ? ` · ${p.createdByName}` : ''}
            </div>
          </button>
        ))}
      </div>

      {creating && (
        <NewSiteModal
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={(plan) => navigate(`/dev/site-planner/${plan.id}`)}
        />
      )}
    </div>
  );
}

export default SitePlanner;
