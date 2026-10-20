import React from 'react';

// The Site Planner's guide: how to go from an address to a compared,
// checked set of schemes, plus what the checks and numbers mean.

const STEPS = [
  ['Find the site', 'Search an address, or turn on Parcels in the layer menu (top right) and use ▦ Pick a parcel to grab a parcel as the site. You can also trace the site with the polygon or rectangle tool on the left.'],
  ['Pick an asset type', 'Each type starts from standard defaults - multifamily, townhomes, single-family, hotel, industrial, retail, data center, surface parking or a parking garage. Change any number in Settings; changed fields turn amber and ↺ puts one back.'],
  ['Shape the layout', 'Leave it automatic, or use ✋ Edit by hand to drag, stretch and rotate buildings. Draw spaces (no-build areas, or areas with their own use), parking areas, and drive aisles. Buildings re-plan around whatever you draw.'],
  ['Check it', 'The zoning check covers height, FAR, coverage, parking, setback, circulation, accessible stalls, one-way flow, truck access and garage ramps. ⛰ Check terrain samples the ground for slope and earthwork.'],
  ['Compare and explore', '+ Scheme copies the scheme so you can try a variation; Compare schemes puts them side by side. ✨ Generate options sweeps up to three settings and keeps the ones that meet your goals.'],
  ['Share it', "◆ 3D shows the massing; ⬇ CSV exports every scheme; 🖨 Report prints the numbers, checks and a plan of each scheme. Save a scheme's settings as a preset to reuse on another site."],
];

const TERMS = [
  ['FAR', 'Floor area ratio - gross building area divided by site area.'],
  ['Lot coverage', 'Building footprint as a share of the site.'],
  ['Yield on cost', 'Annual net operating income divided by total development cost.'],
  ['Bay', 'A drive aisle with a row of stalls on each side (60 ft deep at 90° with standard stalls).'],
  ['Perimeter drive', 'A loop road just inside the setback that every bay can open onto.'],
  ['Shared parking', 'Mixed uses peak at different times, so they can share stalls; the plan uses typical time-of-day patterns.'],
  ['WB-67', 'A standard tractor-trailer (53 ft trailer) used to size truck courts and turns.'],
];

function HelpModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content siteplan-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>How the Site Planner works</h2></div>
        <div className="modal-body siteplan-help-body">
          <ol className="siteplan-help-steps">
            {STEPS.map(([title, text]) => (
              <li key={title}><b>{title}.</b> {text}</li>
            ))}
          </ol>
          <h3>Terms</h3>
          <dl className="siteplan-help-terms">
            {TERMS.map(([term, text]) => (
              <React.Fragment key={term}><dt>{term}</dt><dd>{text}</dd></React.Fragment>
            ))}
          </dl>
          <p className="siteplan-muted siteplan-small">
            The planner is a rules-based test fit to compare options quickly. Pro forma inputs are rough starting points, and parcel,
            flood, wetland, soil and elevation layers come from public sources - check them against the official record.
          </p>
        </div>
        <div className="modal-footer siteplan-modal-footer">
          <div className="modal-actions"><button type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>
  );
}

export default HelpModal;
