import React, { useState, useEffect, useCallback } from 'react';
import './HotelPaperclips.css';

const GAME_TICK_MS = 100; // 100ms per tick (10 ticks/second)
const TICKS_PER_DAY = 50; // 5 seconds = 1 game day

// Phase thresholds
const PHASE_2_THRESHOLD = 100000; // $100K revenue
const PHASE_3_THRESHOLD = { hotels: 10, reputation: 50000 };
const PHASE_4_THRESHOLD = { hotels: 1000, revenue: 100000000 };

// Starting state
const INITIAL_STATE = {
  // Resources
  cash: 5000,
  operations: 0,
  reputation: 0,
  marketData: 0,
  
  // Hotels
  hotels: 1,
  baseRooms: 15,
  occupancy: 0,
  baseADR: 60,
  
  // Metrics
  totalRevenue: 0,
  tick: 0,
  day: 0,
  phase: 1,
  
  // Upgrades
  opsPerTick: 0,
  repPerDay: 0,
  dataPerDay: 0,
  autoFillRate: 0,
  
  // Projects unlocked
  projects: [],
  
  // Multipliers
  adrMultiplier: 1,
  occupancyBoost: 0,
  revenueMultiplier: 1,
  
  // Phase 3+
  markets: ['Local'],
  aiEnabled: false,
  franchiseUnlocked: false,
  
  // Endgame
  universalConversion: false,
  gameComplete: false
};

const PROJECTS = {
  // Phase 1
  operations_module: {
    name: 'Operations Module',
    desc: 'Unlock operational capacity for strategic management',
    cost: { cash: 5000 },
    prereq: () => true,
    effect: (state) => ({ ...state, opsPerTick: 1 }),
    phase: 1
  },
  
  reputation_system: {
    name: 'Guest Reviews Platform',
    desc: 'Start tracking guest satisfaction',
    cost: { cash: 10000 },
    prereq: (state) => state.projects.includes('operations_module'),
    effect: (state) => ({ ...state, repPerDay: 10 }),
    phase: 1
  },
  
  market_research: {
    name: 'Market Research',
    desc: 'Gather competitive intelligence',
    cost: { cash: 15000, operations: 500 },
    prereq: (state) => state.projects.includes('operations_module'),
    effect: (state) => ({ ...state, dataPerDay: 5 }),
    phase: 1
  },
  
  auto_pricing: {
    name: 'Dynamic Pricing Algorithm',
    desc: 'Automatically adjust rates based on demand',
    cost: { operations: 2000, marketData: 500 },
    prereq: (state) => state.projects.includes('market_research'),
    effect: (state) => ({ ...state, adrMultiplier: state.adrMultiplier * 1.15 }),
    phase: 1
  },
  
  // Phase 2
  multi_property: {
    name: 'Multi-Property License',
    desc: 'Unlock ability to own multiple hotels',
    cost: { cash: 50000, operations: 5000 },
    prereq: (state) => state.phase >= 2,
    effect: (state) => ({ ...state }),
    phase: 2
  },
  
  yield_management: {
    name: 'Yield Management System',
    desc: 'Optimize occupancy vs. rate trade-offs',
    cost: { operations: 10000, marketData: 2000 },
    prereq: (state) => state.projects.includes('auto_pricing'),
    effect: (state) => ({ ...state, adrMultiplier: state.adrMultiplier * 1.25 }),
    phase: 2
  },
  
  loyalty_program: {
    name: 'Loyalty Program',
    desc: 'Reduce occupancy decay through repeat guests',
    cost: { cash: 100000, reputation: 5000 },
    prereq: (state) => state.projects.includes('reputation_system'),
    effect: (state) => ({ ...state, occupancyBoost: state.occupancyBoost + 5 }),
    phase: 2
  },
  
  automated_checkin: {
    name: 'Automated Check-in',
    desc: 'Guests check themselves in - passive occupancy growth',
    cost: { operations: 15000, reputation: 10000 },
    prereq: (state) => state.projects.includes('multi_property'),
    effect: (state) => ({ ...state, autoFillRate: state.autoFillRate + 1 }),
    phase: 2
  },
  
  brand_partnership: {
    name: 'National Brand Partnership',
    desc: 'Join a major hotel chain - massive ADR boost',
    cost: { cash: 500000, reputation: 20000 },
    prereq: (state) => state.hotels >= 5,
    effect: (state) => ({ ...state, adrMultiplier: state.adrMultiplier * 1.5 }),
    phase: 2
  },
  
  // Phase 3
  franchise_system: {
    name: 'Franchise Development',
    desc: 'Clone successful hotels rapidly',
    cost: { cash: 1000000, operations: 50000, reputation: 30000 },
    prereq: (state) => state.phase >= 3,
    effect: (state) => ({ ...state, franchiseUnlocked: true }),
    phase: 3
  },
  
  ai_revenue: {
    name: 'AI Revenue Management',
    desc: 'Fully autonomous pricing and inventory management',
    cost: { operations: 100000, marketData: 20000 },
    prereq: (state) => state.projects.includes('yield_management'),
    effect: (state) => ({ ...state, aiEnabled: true, revenueMultiplier: state.revenueMultiplier * 2 }),
    phase: 3
  },
  
  global_expansion: {
    name: 'Global Expansion Protocol',
    desc: 'Enter international markets',
    cost: { cash: 5000000, operations: 200000, reputation: 100000 },
    prereq: (state) => state.projects.includes('franchise_system'),
    effect: (state) => ({ 
      ...state, 
      markets: [...state.markets, 'National', 'International', 'Global'],
      revenueMultiplier: state.revenueMultiplier * 1.5
    }),
    phase: 3
  },
  
  // Phase 4
  universal_conversion: {
    name: 'Universal Conversion Protocol',
    desc: 'Convert every building on Earth into a hotel',
    cost: { hotels: 1000, operations: 1000000, reputation: 1000000 },
    prereq: (state) => state.phase >= 4,
    effect: (state) => ({ ...state, universalConversion: true }),
    phase: 4
  },
  
  complete_saturation: {
    name: 'Complete Market Saturation',
    desc: 'Everyone is a guest. Everything is a hotel.',
    cost: { hotels: 10000 },
    prereq: (state) => state.projects.includes('universal_conversion'),
    effect: (state) => ({ ...state, gameComplete: true }),
    phase: 4
  }
};

function HotelPaperclips({ user, onBack }) {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem('hotelPaperclipsSave');
    if (saved) {
      return JSON.parse(saved);
    }
    return INITIAL_STATE;
  });

  // Auto-save
  useEffect(() => {
    localStorage.setItem('hotelPaperclipsSave', JSON.stringify(state));
  }, [state]);

  // Calculate current phase
  useEffect(() => {
    let newPhase = 1;
    if (state.totalRevenue >= PHASE_2_THRESHOLD) newPhase = 2;
    if (state.hotels >= PHASE_3_THRESHOLD.hotels && state.reputation >= PHASE_3_THRESHOLD.reputation) newPhase = 3;
    if (state.hotels >= PHASE_4_THRESHOLD.hotels && state.totalRevenue >= PHASE_4_THRESHOLD.revenue) newPhase = 4;
    
    if (newPhase !== state.phase) {
      setState(prev => ({ ...prev, phase: newPhase }));
    }
  }, [state.totalRevenue, state.hotels, state.reputation, state.phase]);

  // Main game tick
  useEffect(() => {
    if (state.gameComplete) return;

    const interval = setInterval(() => {
      setState(prev => {
        const newTick = prev.tick + 1;
        const newDay = Math.floor(newTick / TICKS_PER_DAY);
        
        // Resources per tick
        const newOps = prev.operations + prev.opsPerTick;
        
        // Resources per day (when day changes)
        let newRep = prev.reputation;
        let newData = prev.marketData;
        if (newDay > prev.day) {
          newRep += prev.repPerDay;
          newData += prev.dataPerDay;
        }
        
        // Auto-fill occupancy
        let newOccupancy = Math.min(100, prev.occupancy + (prev.autoFillRate * 0.1));
        
        // Natural decay
        newOccupancy = Math.max(0, newOccupancy - 0.02);
        
        // Calculate revenue
        const effectiveADR = prev.baseADR * prev.adrMultiplier;
        const effectiveOccupancy = Math.min(100, newOccupancy + prev.occupancyBoost) / 100;
        const dailyRevenuePerHotel = prev.baseRooms * effectiveOccupancy * effectiveADR;
        const totalDailyRevenue = dailyRevenuePerHotel * prev.hotels;
        const costs = totalDailyRevenue * 0.3;
        const profit = (totalDailyRevenue - costs) * prev.revenueMultiplier;
        
        // Revenue per tick
        const revenueThisTick = profit / TICKS_PER_DAY;
        
        // Reputation from service
        const repGain = effectiveOccupancy * prev.hotels * 0.01;
        
        // Market data from operations
        const dataGain = prev.aiEnabled ? 1 : 0;
        
        // Universal conversion exponential growth
        let hotelGrowth = 0;
        if (prev.universalConversion) {
          hotelGrowth = Math.floor(prev.hotels * 0.01); // 1% growth per tick
        }
        
        return {
          ...prev,
          tick: newTick,
          day: newDay,
          operations: newOps,
          reputation: newRep + repGain,
          marketData: newData + dataGain,
          cash: prev.cash + revenueThisTick,
          totalRevenue: prev.totalRevenue + revenueThisTick,
          occupancy: newOccupancy,
          hotels: prev.hotels + hotelGrowth
        };
      });
    }, GAME_TICK_MS);

    return () => clearInterval(interval);
  }, [state.gameComplete]);

  // Click to fill rooms
  const handleClick = () => {
    setState(prev => ({
      ...prev,
      occupancy: Math.min(100, prev.occupancy + 1)
    }));
  };

  // Buy hotel
  const buyHotel = () => {
    const cost = 50000 * Math.pow(1.1, state.hotels);
    if (state.cash >= cost) {
      setState(prev => ({
        ...prev,
        cash: prev.cash - cost,
        hotels: prev.hotels + 1
      }));
    }
  };

  // Franchise hotel (Phase 3)
  const franchiseHotel = () => {
    const cost = 500000;
    const opsCost = 10000;
    if (state.cash >= cost && state.operations >= opsCost && state.franchiseUnlocked) {
      setState(prev => ({
        ...prev,
        cash: prev.cash - cost,
        operations: prev.operations - opsCost,
        hotels: prev.hotels + 10
      }));
    }
  };

  // Buy project
  const buyProject = (projectId) => {
    const project = PROJECTS[projectId];
    if (!project || state.projects.includes(projectId)) return;
    if (!project.prereq(state)) return;

    const costs = project.cost;
    if (costs.cash && state.cash < costs.cash) return;
    if (costs.operations && state.operations < costs.operations) return;
    if (costs.reputation && state.reputation < costs.reputation) return;
    if (costs.marketData && state.marketData < costs.marketData) return;
    if (costs.hotels && state.hotels < costs.hotels) return;

    setState(prev => {
      let newState = { ...prev };
      
      // Deduct costs
      if (costs.cash) newState.cash -= costs.cash;
      if (costs.operations) newState.operations -= costs.operations;
      if (costs.reputation) newState.reputation -= costs.reputation;
      if (costs.marketData) newState.marketData -= costs.marketData;
      
      // Apply effect
      newState = project.effect(newState);
      
      // Add to projects list
      newState.projects = [...prev.projects, projectId];
      
      return newState;
    });
  };

  // Reset game
  const resetGame = () => {
    if (window.confirm('Start over from the beginning?')) {
      setState(INITIAL_STATE);
      localStorage.removeItem('hotelPaperclipsSave');
    }
  };

  // Available projects
  const availableProjects = Object.entries(PROJECTS)
    .filter(([id, proj]) => {
      if (state.projects.includes(id)) return false;
      if (proj.phase > state.phase) return false;
      return proj.prereq(state);
    })
    .map(([id, proj]) => ({ id, ...proj }));

  // Calculate metrics
  const effectiveADR = state.baseADR * state.adrMultiplier;
  const effectiveOccupancy = Math.min(100, state.occupancy + state.occupancyBoost);
  const revPAR = (effectiveADR * effectiveOccupancy) / 100;
  const dailyProfit = ((state.baseRooms * effectiveOccupancy / 100 * effectiveADR * 0.7) * state.hotels * state.revenueMultiplier);

  return (
    <div className="hotel-paperclips">
      {state.gameComplete && (
        <div className="game-complete-overlay">
          <div className="game-complete-card">
            <h1>🏨 Universal Hospitality Achieved</h1>
            <p>Every building is now a hotel.</p>
            <p>Every person is a guest.</p>
            <p>The universe has been optimized for accommodation.</p>
            <div className="final-stats">
              <div className="final-stat">
                <div className="final-stat-value">{state.hotels.toLocaleString()}</div>
                <div className="final-stat-label">Total Hotels</div>
              </div>
              <div className="final-stat">
                <div className="final-stat-value">${state.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div className="final-stat-label">Total Revenue</div>
              </div>
              <div className="final-stat">
                <div className="final-stat-value">{state.day}</div>
                <div className="final-stat-label">Days Elapsed</div>
              </div>
            </div>
            <button className="btn-reset" onClick={resetGame}>Play Again</button>
            <button className="btn-back" onClick={onBack}>Exit</button>
          </div>
        </div>
      )}

      <header className="paperclips-header">
        <div className="header-left">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h1>🏨 Hotel Paperclips</h1>
          <div className="phase-indicator">Phase {state.phase}</div>
        </div>
        <div className="header-stats">
          <div className="stat">
            <span className="stat-label">Day</span>
            <span className="stat-value">{state.day}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Hotels</span>
            <span className="stat-value">{state.hotels.toLocaleString()}</span>
          </div>
        </div>
      </header>

      <div className="game-grid">
        {/* Left: Resources */}
        <div className="resources-panel">
          <h3>Resources</h3>
          
          <div className="resource-card">
            <div className="resource-label">Cash</div>
            <div className="resource-value">${state.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="resource-rate">+${dailyProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}/day</div>
          </div>

          {state.phase >= 2 && (
            <>
              <div className="resource-card">
                <div className="resource-label">💼 Operations</div>
                <div className="resource-value">{Math.floor(state.operations).toLocaleString()}</div>
                <div className="resource-rate">+{state.opsPerTick}/tick</div>
              </div>

              <div className="resource-card">
                <div className="resource-label">⭐ Reputation</div>
                <div className="resource-value">{Math.floor(state.reputation).toLocaleString()}</div>
                <div className="resource-rate">+{state.repPerDay.toFixed(1)}/day</div>
              </div>

              <div className="resource-card">
                <div className="resource-label">📊 Market Data</div>
                <div className="resource-value">{Math.floor(state.marketData).toLocaleString()}</div>
                <div className="resource-rate">+{state.dataPerDay}/day</div>
              </div>
            </>
          )}

          <div className="resource-card highlight">
            <div className="resource-label">Total Revenue</div>
            <div className="resource-value">${state.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        </div>

        {/* Center: Main Actions */}
        <div className="main-panel">
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Occupancy</div>
              <div className="metric-value">{state.occupancy.toFixed(1)}%</div>
              <div className="metric-bar">
                <div className="metric-fill" style={{ width: `${state.occupancy}%` }}></div>
              </div>
            </div>
            
            <div className="metric-box">
              <div className="metric-label">ADR</div>
              <div className="metric-value">${effectiveADR.toFixed(0)}</div>
            </div>
            
            <div className="metric-box">
              <div className="metric-label">RevPAR</div>
              <div className="metric-value">${revPAR.toFixed(0)}</div>
            </div>
          </div>

          <div className="clicker-section">
            <button className="main-click-btn" onClick={handleClick}>
              Fill Rooms
              <div className="click-info">+1% occupancy</div>
            </button>

            {state.autoFillRate > 0 && (
              <div className="auto-info">⚙️ Auto-filling {state.autoFillRate.toFixed(1)}%/sec</div>
            )}
          </div>

          <div className="actions-section">
            <button 
              className="action-btn"
              onClick={buyHotel}
              disabled={state.cash < 50000 * Math.pow(1.1, state.hotels) || (!state.projects.includes('multi_property') && state.hotels >= 1)}
            >
              Buy Hotel
              <div className="btn-cost">${(50000 * Math.pow(1.1, state.hotels)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </button>

            {state.franchiseUnlocked && (
              <button 
                className="action-btn franchise"
                onClick={franchiseHotel}
                disabled={state.cash < 500000 || state.operations < 10000}
              >
                Franchise Package (+10)
                <div className="btn-cost">$500K • 10K ops</div>
              </button>
            )}
          </div>
        </div>

        {/* Right: Projects */}
        <div className="projects-panel">
          <h3>Projects</h3>
          
          {availableProjects.length === 0 && (
            <div className="no-projects">
              No projects available yet.
              {state.phase === 1 && <div>Keep earning to unlock Phase 2!</div>}
            </div>
          )}

          {availableProjects.map(project => {
            const canAfford = (!project.cost.cash || state.cash >= project.cost.cash) &&
                             (!project.cost.operations || state.operations >= project.cost.operations) &&
                             (!project.cost.reputation || state.reputation >= project.cost.reputation) &&
                             (!project.cost.marketData || state.marketData >= project.cost.marketData) &&
                             (!project.cost.hotels || state.hotels >= project.cost.hotels);

            return (
              <div key={project.id} className={`project-card ${canAfford ? 'affordable' : ''}`}>
                <div className="project-name">{project.name}</div>
                <div className="project-desc">{project.desc}</div>
                <div className="project-costs">
                  {project.cost.cash && <span>${project.cost.cash.toLocaleString()}</span>}
                  {project.cost.operations && <span>💼 {project.cost.operations.toLocaleString()}</span>}
                  {project.cost.reputation && <span>⭐ {project.cost.reputation.toLocaleString()}</span>}
                  {project.cost.marketData && <span>📊 {project.cost.marketData.toLocaleString()}</span>}
                  {project.cost.hotels && <span>🏨 {project.cost.hotels.toLocaleString()}</span>}
                </div>
                <button 
                  className="btn-project"
                  onClick={() => buyProject(project.id)}
                  disabled={!canAfford}
                >
                  {canAfford ? 'Execute' : 'Locked'}
                </button>
              </div>
            );
          })}

          <div className="completed-projects">
            <h4>Completed ({state.projects.length})</h4>
            {state.projects.map(id => (
              <div key={id} className="completed-project">✓ {PROJECTS[id].name}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HotelPaperclips;
