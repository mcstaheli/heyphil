import React, { useState, useEffect, useRef } from 'react';
import './HotelEmpireV2.css';

const TICK_MS = 100; // 10 ticks/sec
const TICKS_PER_DAY = 100; // 10 sec = 1 day

// Hotel templates
const HOTEL_TYPES = {
  motel: { name: 'Roadside Motel', rooms: 15, baseADR: 60, baseCost: 25000, opsRequired: 5 },
  budget: { name: 'Budget Inn', rooms: 40, baseADR: 85, baseCost: 150000, opsRequired: 15 },
  midscale: { name: 'Mid-Scale Hotel', rooms: 100, baseADR: 120, baseCost: 500000, opsRequired: 30 },
  boutique: { name: 'Boutique Hotel', rooms: 25, baseADR: 250, baseCost: 800000, opsRequired: 20 },
  resort: { name: 'Resort & Spa', rooms: 200, baseADR: 180, baseCost: 2000000, opsRequired: 50 },
  luxury: { name: 'Luxury Brand', rooms: 300, baseADR: 350, baseCost: 5000000, opsRequired: 80 }
};

// Special guests (rare, high value)
const SPECIAL_GUEST_TYPES = [
  { type: 'VIP', multiplier: 5, chance: 0.05, emoji: '⭐', color: '#fbbf24' },
  { type: 'Celebrity', multiplier: 15, chance: 0.01, emoji: '🌟', color: '#f59e0b' },
  { type: 'Royalty', multiplier: 50, chance: 0.002, emoji: '👑', color: '#8b5cf6' }
];

// Upgrades
const UPGRADES = {
  // Marketing
  google_ads: { name: 'Google Ads', cost: { cash: 5000 }, effect: '+10 guests/sec', guestRate: 10, category: 'marketing' },
  social_media: { name: 'Social Media', cost: { cash: 15000 }, effect: '+30 guests/sec', guestRate: 30, category: 'marketing' },
  billboard: { name: 'Billboard Campaign', cost: { cash: 50000 }, effect: '+100 guests/sec', guestRate: 100, category: 'marketing' },
  
  // Staff
  training: { name: 'Staff Training', cost: { cash: 10000 }, effect: 'Staff 2x faster', staffSpeedMult: 2, category: 'staff' },
  auto_hire: { name: 'Auto Hiring', cost: { cash: 25000, ops: 100 }, effect: 'Auto-balance staff', autoHire: true, category: 'staff' },
  
  // Operations
  ops_module: { name: 'Operations Center', cost: { cash: 20000 }, effect: '+50 ops', opsBonus: 50, category: 'ops' },
  ai_manager: { name: 'AI Manager', cost: { cash: 100000 }, effect: '+200 ops', opsBonus: 200, category: 'ops' },
  
  // Revenue
  dynamic_pricing: { name: 'Dynamic Pricing', cost: { cash: 30000 }, effect: '+25% ADR', adrMult: 1.25, category: 'revenue' },
  loyalty: { name: 'Loyalty Program', cost: { cash: 75000, reputation: 1000 }, effect: '+1 night avg stay', nightsBonus: 1, category: 'revenue' },
  premium_service: { name: 'Premium Service', cost: { cash: 150000 }, effect: '+50% ADR', adrMult: 1.5, category: 'revenue' },
  
  // Automation
  auto_checkin: { name: 'Automated Check-in', cost: { cash: 50000, ops: 200 }, effect: 'Auto-process queue', autoCheckin: true, category: 'automation' },
  ai_revenue: { name: 'AI Revenue Engine', cost: { cash: 500000, ops: 500 }, effect: 'Auto-optimize all', aiRevenue: true, category: 'automation' }
};

const INITIAL_STATE = {
  // Core resources
  cash: 15000,
  guestQueue: 0,
  staff: 2,
  reputation: 100,
  operations: 50,
  
  // Hotels
  hotels: [{
    id: 1,
    type: 'motel',
    name: 'Roadside Motel #1',
    rooms: 15,
    baseADR: 60,
    guests: [] // { id, nightsRemaining, revenue, special }
  }],
  nextHotelId: 2,
  hotelCounts: { motel: 1 },
  
  // Upgrades
  upgrades: [],
  
  // Combo system
  combo: 0,
  comboTimer: 0,
  maxCombo: 0,
  lastClickTick: 0,
  
  // Game state
  tick: 0,
  day: 0,
  phase: 1,
  totalRevenue: 0,
  
  // Derived (calculated each tick)
  totalRooms: 15,
  occupiedRooms: 0,
  availableRooms: 15,
  guestArrivalRate: 5, // base guests per second
  staffCostPerSec: 2, // $2/sec per staff
  effectiveADR: 60,
  opsRequired: 5,
  opsAvailable: 45,
  
  // Stats
  stats: {
    totalGuestsBooked: 0,
    totalNightsBooked: 0,
    vipCount: 0,
    celebrityCount: 0,
    royaltyCount: 0,
    totalStaffHired: 2,
    peakQueue: 0
  }
};

function HotelEmpireV2({ user, onBack }) {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem('hotelEmpireV2Save');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_STATE;
      }
    }
    return INITIAL_STATE;
  });
  
  const [showSpecialGuest, setShowSpecialGuest] = useState(null);
  const nextGuestId = useRef(1);
  
  // Auto-save
  useEffect(() => {
    localStorage.setItem('hotelEmpireV2Save', JSON.stringify(state));
  }, [state]);
  
  // Main game tick
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => {
        const newTick = prev.tick + 1;
        const newDay = Math.floor(newTick / TICKS_PER_DAY);
        
        // Calculate derived stats
        let totalRooms = 0;
        let occupiedRooms = 0;
        let opsRequired = 0;
        let opsBonus = 0;
        let adrMult = 1;
        let nightsBonus = 0;
        let guestRateBonus = 0;
        let staffSpeedMult = 1;
        let autoCheckin = false;
        let autoHire = false;
        
        // Process upgrades
        prev.upgrades.forEach(upgradeId => {
          const upgrade = UPGRADES[upgradeId];
          if (upgrade) {
            if (upgrade.opsBonus) opsBonus += upgrade.opsBonus;
            if (upgrade.adrMult) adrMult *= upgrade.adrMult;
            if (upgrade.nightsBonus) nightsBonus += upgrade.nightsBonus;
            if (upgrade.guestRate) guestRateBonus += upgrade.guestRate;
            if (upgrade.staffSpeedMult) staffSpeedMult *= upgrade.staffSpeedMult;
            if (upgrade.autoCheckin) autoCheckin = true;
            if (upgrade.autoHire) autoHire = true;
          }
        });
        
        // Calculate hotel stats
        const newHotels = prev.hotels.map(hotel => {
          totalRooms += hotel.rooms;
          occupiedRooms += hotel.guests.length;
          opsRequired += HOTEL_TYPES[hotel.type].opsRequired;
          
          // Process guest checkouts
          const newGuests = hotel.guests.map(guest => {
            const newNights = guest.nightsRemaining - 0.1; // Check out over time
            return newNights > 0 ? { ...guest, nightsRemaining: newNights } : null;
          }).filter(g => g !== null);
          
          return { ...hotel, guests: newGuests };
        });
        
        occupiedRooms = newHotels.reduce((sum, h) => sum + h.guests.length, 0);
        
        const opsAvailable = prev.operations + opsBonus - opsRequired;
        const availableRooms = totalRooms - occupiedRooms;
        
        // Guest arrivals (per second, divide by 10 for per-tick)
        const guestArrivalRate = (5 + guestRateBonus) * (prev.reputation / 100);
        const newGuests = guestArrivalRate / 10;
        let newQueue = Math.min(prev.guestQueue + newGuests, totalRooms * 2); // Cap queue at 2x capacity
        
        // Auto check-in (if enabled)
        let newCash = prev.cash;
        let newRevenue = prev.totalRevenue;
        let newStats = { ...prev.stats };
        
        if (autoCheckin && newQueue > 0 && availableRooms > 0) {
          const staffCapacity = prev.staff * staffSpeedMult;
          const toCheckin = Math.min(newQueue, availableRooms, staffCapacity / 10);
          
          for (let i = 0; i < toCheckin; i++) {
            const result = checkinGuest(newHotels, prev, adrMult, nightsBonus);
            if (result) {
              newHotels[result.hotelIdx] = result.hotel;
              newCash += result.revenue;
              newRevenue += result.revenue;
              newQueue -= 1;
              newStats.totalGuestsBooked += 1;
              newStats.totalNightsBooked += result.nights;
              if (result.special) {
                if (result.special.type === 'VIP') newStats.vipCount += 1;
                if (result.special.type === 'Celebrity') newStats.celebrityCount += 1;
                if (result.special.type === 'Royalty') newStats.royaltyCount += 1;
              }
            }
          }
        }
        
        // Staff costs
        const staffCost = (prev.staff * prev.staffCostPerSec) / 10;
        newCash -= staffCost;
        
        // Reputation decay if queue too long
        let newReputation = prev.reputation;
        if (newQueue > totalRooms) {
          newReputation = Math.max(0, newReputation - 0.1);
        } else if (newQueue < totalRooms * 0.3) {
          newReputation = Math.min(200, newReputation + 0.05);
        }
        
        // Combo decay
        let newCombo = prev.combo;
        let newComboTimer = prev.comboTimer;
        if (newTick - prev.lastClickTick > 30) { // 3 second window
          newCombo = 0;
          newComboTimer = 0;
        } else if (newComboTimer > 0) {
          newComboTimer -= 1;
        }
        
        // Peak queue tracking
        if (newQueue > newStats.peakQueue) {
          newStats.peakQueue = Math.floor(newQueue);
        }
        
        // Phase calculation
        let newPhase = 1;
        if (prev.totalRevenue >= 100000) newPhase = 2;
        if (prev.hotels.length >= 10 && prev.totalRevenue >= 1000000) newPhase = 3;
        if (prev.hotels.length >= 50 && prev.totalRevenue >= 50000000) newPhase = 4;
        
        return {
          ...prev,
          tick: newTick,
          day: newDay,
          hotels: newHotels,
          cash: newCash,
          totalRevenue: newRevenue,
          guestQueue: newQueue,
          reputation: newReputation,
          combo: newCombo,
          comboTimer: newComboTimer,
          stats: newStats,
          phase: newPhase,
          
          // Derived
          totalRooms,
          occupiedRooms,
          availableRooms,
          opsRequired,
          opsAvailable,
          guestArrivalRate,
          effectiveADR: prev.hotels[0]?.baseADR * adrMult || 60
        };
      });
    }, TICK_MS);
    
    return () => clearInterval(interval);
  }, []);
  
  // Check in guest from queue
  const checkinGuest = (hotels, gameState, adrMult, nightsBonus) => {
    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      if (hotel.guests.length < hotel.rooms) {
        const nights = Math.floor(Math.random() * 3) + 1 + nightsBonus;
        const baseRevenue = hotel.baseADR * adrMult * nights;
        
        // Check for special guest
        let special = null;
        let revenue = baseRevenue;
        for (const guestType of SPECIAL_GUEST_TYPES) {
          if (Math.random() < guestType.chance) {
            special = guestType;
            revenue = baseRevenue * guestType.multiplier;
            break;
          }
        }
        
        const guest = {
          id: nextGuestId.current++,
          nightsRemaining: nights,
          revenue,
          special
        };
        
        const newGuests = [...hotel.guests, guest];
        
        return {
          hotelIdx: i,
          hotel: { ...hotel, guests: newGuests },
          revenue,
          nights,
          special
        };
      }
    }
    return null;
  };
  
  // Manual check-in (click)
  const handleCheckin = () => {
    if (state.guestQueue <= 0 || state.availableRooms <= 0) return;
    
    setState(prev => {
      // Calculate bonuses
      let adrMult = 1;
      let nightsBonus = 0;
      prev.upgrades.forEach(id => {
        const u = UPGRADES[id];
        if (u?.adrMult) adrMult *= u.adrMult;
        if (u?.nightsBonus) nightsBonus += u.nightsBonus;
      });
      
      const newHotels = [...prev.hotels];
      const result = checkinGuest(newHotels, prev, adrMult, nightsBonus);
      
      if (!result) return prev;
      
      newHotels[result.hotelIdx] = result.hotel;
      
      // Combo system
      const timeSinceLastClick = prev.tick - prev.lastClickTick;
      const newCombo = timeSinceLastClick <= 30 ? prev.combo + 1 : 1;
      const comboMult = Math.min(1 + (newCombo * 0.1), 5); // Up to 5x at 40 combo
      const finalRevenue = result.revenue * comboMult;
      
      // Show special guest notification
      if (result.special) {
        setShowSpecialGuest(result.special);
        setTimeout(() => setShowSpecialGuest(null), 2000);
      }
      
      return {
        ...prev,
        hotels: newHotels,
        cash: prev.cash + finalRevenue,
        totalRevenue: prev.totalRevenue + finalRevenue,
        guestQueue: prev.guestQueue - 1,
        combo: newCombo,
        maxCombo: Math.max(prev.maxCombo, newCombo),
        comboTimer: 30,
        lastClickTick: prev.tick,
        stats: {
          ...prev.stats,
          totalGuestsBooked: prev.stats.totalGuestsBooked + 1,
          totalNightsBooked: prev.stats.totalNightsBooked + result.nights,
          vipCount: prev.stats.vipCount + (result.special?.type === 'VIP' ? 1 : 0),
          celebrityCount: prev.stats.celebrityCount + (result.special?.type === 'Celebrity' ? 1 : 0),
          royaltyCount: prev.stats.royaltyCount + (result.special?.type === 'Royalty' ? 1 : 0)
        }
      };
    });
  };
  
  // Hire/fire staff
  const adjustStaff = (delta) => {
    setState(prev => ({
      ...prev,
      staff: Math.max(0, prev.staff + delta),
      stats: {
        ...prev.stats,
        totalStaffHired: delta > 0 ? prev.stats.totalStaffHired + delta : prev.stats.totalStaffHired
      }
    }));
  };
  
  // Buy hotel
  const buyHotel = (hotelType) => {
    const template = HOTEL_TYPES[hotelType];
    const count = state.hotelCounts[hotelType] || 0;
    const cost = template.baseCost * Math.pow(1.15, count); // 15% increase per hotel of this type
    
    if (state.cash < cost) return;
    if (state.opsAvailable < template.opsRequired) return;
    
    setState(prev => ({
      ...prev,
      cash: prev.cash - cost,
      hotels: [...prev.hotels, {
        id: prev.nextHotelId,
        type: hotelType,
        name: `${template.name} #${prev.nextHotelId}`,
        rooms: template.rooms,
        baseADR: template.baseADR,
        guests: []
      }],
      nextHotelId: prev.nextHotelId + 1,
      hotelCounts: {
        ...prev.hotelCounts,
        [hotelType]: count + 1
      }
    }));
  };
  
  // Buy upgrade
  const buyUpgrade = (upgradeId) => {
    const upgrade = UPGRADES[upgradeId];
    if (!upgrade || state.upgrades.includes(upgradeId)) return;
    
    const costs = upgrade.cost;
    if (costs.cash && state.cash < costs.cash) return;
    if (costs.ops && state.operations < costs.ops) return;
    if (costs.reputation && state.reputation < costs.reputation) return;
    
    setState(prev => ({
      ...prev,
      cash: prev.cash - (costs.cash || 0),
      operations: prev.operations - (costs.ops || 0),
      upgrades: [...prev.upgrades, upgradeId]
    }));
  };
  
  // Reset
  const resetGame = () => {
    if (window.confirm('Start over?')) {
      setState(INITIAL_STATE);
      localStorage.removeItem('hotelEmpireV2Save');
    }
  };
  
  // Calculate combo multiplier display
  const comboMultiplier = Math.min(1 + (state.combo * 0.1), 5);
  
  // Filter upgrades
  const availableUpgrades = Object.entries(UPGRADES)
    .filter(([id]) => !state.upgrades.includes(id))
    .map(([id, upgrade]) => ({ id, ...upgrade }));
  
  return (
    <div className="hotel-empire-v2">
      {showSpecialGuest && (
        <div className="special-guest-popup" style={{ color: showSpecialGuest.color }}>
          <div className="special-emoji">{showSpecialGuest.emoji}</div>
          <div className="special-text">{showSpecialGuest.type} GUEST!</div>
          <div className="special-mult">{showSpecialGuest.multiplier}x REVENUE</div>
        </div>
      )}
      
      <header className="empire-header-v2">
        <div className="header-left">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h1>🏨 Hotel Empire</h1>
          <div className="phase-badge">Phase {state.phase}</div>
        </div>
        <div className="header-resources">
          <div className="resource-box">
            <div className="resource-label">Cash</div>
            <div className="resource-value">${state.cash.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
          </div>
          <div className="resource-box">
            <div className="resource-label">Guest Queue</div>
            <div className={`resource-value ${state.guestQueue > state.totalRooms ? 'warning' : ''}`}>
              {Math.floor(state.guestQueue)}
            </div>
            <div className="resource-rate">+{state.guestArrivalRate.toFixed(1)}/sec</div>
          </div>
          <div className="resource-box">
            <div className="resource-label">Staff</div>
            <div className="resource-value">{state.staff}</div>
            <div className="resource-cost">-${(state.staff * state.staffCostPerSec).toFixed(0)}/sec</div>
          </div>
          <div className="resource-box">
            <div className="resource-label">Reputation</div>
            <div className="resource-value">{Math.floor(state.reputation)}</div>
          </div>
          <div className="resource-box">
            <div className="resource-label">Operations</div>
            <div className="resource-value">{state.opsAvailable}/{state.operations}</div>
          </div>
        </div>
      </header>
      
      <div className="game-grid-v2">
        {/* Left - Actions */}
        <div className="left-section">
          <div className="checkin-card">
            <h3>Check In Guest</h3>
            <div className="checkin-info">
              <div>Queue: {Math.floor(state.guestQueue)} waiting</div>
              <div>Rooms: {state.availableRooms} available</div>
              {state.combo > 0 && (
                <div className="combo-display">
                  COMBO: {state.combo} ({comboMultiplier.toFixed(1)}x)
                </div>
              )}
            </div>
            <button 
              className="checkin-btn"
              onClick={handleCheckin}
              disabled={state.guestQueue <= 0 || state.availableRooms <= 0}
            >
              CHECK IN
              <div className="btn-info">${state.effectiveADR.toFixed(0)} × 1-3 nights</div>
            </button>
          </div>
          
          <div className="staff-card">
            <h3>Manage Staff</h3>
            <div className="staff-info">
              <div>Current: {state.staff}</div>
              <div>Cost: ${(state.staff * state.staffCostPerSec).toFixed(0)}/sec</div>
            </div>
            <div className="staff-buttons">
              <button onClick={() => adjustStaff(-1)} disabled={state.staff <= 0}>-1</button>
              <button onClick={() => adjustStaff(-5)} disabled={state.staff < 5}>-5</button>
              <button onClick={() => adjustStaff(1)}>+1</button>
              <button onClick={() => adjustStaff(5)}>+5</button>
            </div>
          </div>
          
          <div className="stats-card-v2">
            <h3>Stats</h3>
            <div className="stat-line">
              <span>Total Revenue</span>
              <span>${state.totalRevenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
            </div>
            <div className="stat-line">
              <span>Hotels</span>
              <span>{state.hotels.length}</span>
            </div>
            <div className="stat-line">
              <span>Guests Booked</span>
              <span>{state.stats.totalGuestsBooked.toLocaleString()}</span>
            </div>
            <div className="stat-line">
              <span>Max Combo</span>
              <span>{state.maxCombo}</span>
            </div>
            {state.stats.vipCount > 0 && (
              <div className="stat-line special">
                <span>⭐ VIP Guests</span>
                <span>{state.stats.vipCount}</span>
              </div>
            )}
            {state.stats.celebrityCount > 0 && (
              <div className="stat-line special">
                <span>🌟 Celebrities</span>
                <span>{state.stats.celebrityCount}</span>
              </div>
            )}
            {state.stats.royaltyCount > 0 && (
              <div className="stat-line special">
                <span>👑 Royalty</span>
                <span>{state.stats.royaltyCount}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Center - Hotels */}
        <div className="center-section">
          <div className="hotels-display">
            <h3>Hotels ({state.hotels.length})</h3>
            <div className="hotels-scroll">
              {state.hotels.map(hotel => (
                <div key={hotel.id} className="hotel-mini-card">
                  <div className="hotel-mini-name">{hotel.name}</div>
                  <div className="hotel-mini-stats">
                    <span>{hotel.guests.length}/{hotel.rooms}</span>
                    <span>${hotel.baseADR}</span>
                  </div>
                  <div className="hotel-mini-bar">
                    <div 
                      className="hotel-mini-fill"
                      style={{ width: `${(hotel.guests.length / hotel.rooms) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="buy-hotels">
            <h3>Buy Hotels</h3>
            {Object.entries(HOTEL_TYPES).filter(([key]) => 
              key === 'motel' || state.phase >= 2
            ).map(([key, hotel]) => {
              const count = state.hotelCounts[key] || 0;
              const cost = hotel.baseCost * Math.pow(1.15, count);
              const canAfford = state.cash >= cost && state.opsAvailable >= hotel.opsRequired;
              
              return (
                <button
                  key={key}
                  className={`hotel-buy-btn ${canAfford ? 'affordable' : ''}`}
                  onClick={() => buyHotel(key)}
                  disabled={!canAfford}
                >
                  <div className="hotel-buy-name">{hotel.name}</div>
                  <div className="hotel-buy-info">
                    {hotel.rooms} rooms • ${hotel.baseADR} ADR • {hotel.opsRequired} ops
                  </div>
                  <div className="hotel-buy-cost">
                    ${cost.toLocaleString(undefined, {maximumFractionDigits: 0})}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Right - Upgrades */}
        <div className="right-section">
          <h3>Upgrades</h3>
          <div className="upgrades-scroll">
            {availableUpgrades.map(upgrade => {
              const canAfford = (!upgrade.cost.cash || state.cash >= upgrade.cost.cash) &&
                               (!upgrade.cost.ops || state.operations >= upgrade.cost.ops) &&
                               (!upgrade.cost.reputation || state.reputation >= upgrade.cost.reputation);
              
              return (
                <button
                  key={upgrade.id}
                  className={`upgrade-card ${canAfford ? 'affordable' : ''}`}
                  onClick={() => buyUpgrade(upgrade.id)}
                  disabled={!canAfford}
                >
                  <div className="upgrade-name">{upgrade.name}</div>
                  <div className="upgrade-effect">{upgrade.effect}</div>
                  <div className="upgrade-cost-display">
                    {upgrade.cost.cash && <span>${upgrade.cost.cash.toLocaleString()}</span>}
                    {upgrade.cost.ops && <span>💼 {upgrade.cost.ops}</span>}
                    {upgrade.cost.reputation && <span>⭐ {upgrade.cost.reputation}</span>}
                  </div>
                </button>
              );
            })}
          </div>
          
          {state.upgrades.length > 0 && (
            <div className="owned-section">
              <h4>Owned ({state.upgrades.length})</h4>
              {state.upgrades.map(id => (
                <div key={id} className="owned-item">✓ {UPGRADES[id].name}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HotelEmpireV2;
