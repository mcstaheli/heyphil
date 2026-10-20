import React from 'react';

// The editor's right-hand panel as an ordered set of steps. Each step is
// one line - its number (or ✓ / ⚠), title and a summary of where it
// stands - until it's opened; one is open at a time, and Next moves on.

const STATUS_MARK = { done: '✓', warn: '⚠', bad: '⚠' };

export function Step({ index, id, title, summary, status, open, onToggle, onNext, nextLabel, children }) {
  return (
    <section className={`siteplan-step ${open ? 'open' : ''} siteplan-step-${status || 'todo'}`}>
      <button type="button" className="siteplan-step-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <span className="siteplan-step-mark">{STATUS_MARK[status] || index}</span>
        <span className="siteplan-step-text">
          <span className="siteplan-step-title">{title}</span>
          {!open && summary && <span className="siteplan-step-summary">{summary}</span>}
        </span>
        <span className="siteplan-step-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="siteplan-step-body">
          {children}
          {onNext && (
            <div className="siteplan-step-next">
              <button type="button" className="btn-primary siteplan-next-btn" onClick={onNext}>{nextLabel || 'Next'} →</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
