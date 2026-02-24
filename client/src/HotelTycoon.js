import React, { useState, useEffect, useCallback } from 'react';
import './HotelTycoon.css';

const GAME_DAY_MS = 5000; // 5 seconds = 1 game day

const HOTELS = [
  { id: 'motel', name: 'Roadside Motel', rooms: 15, baseADR: 60, cost: 0 },
  { id: 'budget', name: 'Budget Inn', rooms: 40, baseADR: 85, cost: 50000 },
  { id: 'midscale', name: 'Mid-Scale Hotel', rooms: 100, baseADR: 120, cost: 200000 },
  { id: 'boutique', name: 'Boutique Property', rooms: 25, baseADR: 250, cost: 500000 },
  { id: 'resort', name: 'Full-Service Resort', rooms: 200, baseADR: 180, cost: 1500000 },
  { id: 'luxury', name: 'Luxury Brand', rooms: 300, baseADR: 350, cost: 5000000 }
];

const UPGRADES = {
  revenueManagement: [
    { id: 'dynamic', name: 'Dynamic Pricing', cost: 500, effect: 'ADR +5%', multiplier: 1.05 },
    { id: 'yield', name: 'Yield Management', cost: 5000, effect: 'ADR +15%', multiplier: 1.15 },
    { id: 'ai', name: 'AI Revenue System', cost: 50000, effect: 'ADR +50%', multiplier: 1.5 }
  ],
  marketing: [
    { id: 'google', name: 'Google Ads', cost: 1000, effect: 'Occupancy +5%', occupancyBoost: 5 },
    { id: 'ota', name: 'OTA Listings', cost: 3000, effect: 'Occupancy +10%', occupancyBoost: 10 },
    { id: 'brand', name: 'Brand Partnership', cost: 25000, effect: 'ADR +50%', multiplier: 1.5 }
  ],
  amenities: [
    { id: 'breakfast', name: 'Breakfast Buffet', cost: 2000, effect: '+$10 ADR', adrBonus: 10 },
    { id: 'fitness', name: 'Fitness Center', cost: 5000, effect: '+$15 ADR', adrBonus: 15 },
    { id: 'pool', name: 'Pool & Spa', cost: 15000, effect: '+$30 ADR', adrBonus: 30 },
    { id: 'restaurant', name: 'Restaurant & Bar', cost: 30000, effect: '+$50 ADR', adrBonus: 50 }
  ],
  automation: [
    { id: 'pms', name: 'PMS System', cost: 2000, effect: '5 auto/sec', autoClicks: 5 },
    { id: 'channel', name: 'Channel Manager', cost: 8000, effect: '20 auto/sec', autoClicks: 20 },
    { id: 'checkin', name: 'Automated Check-in', cost: 12000, effect: '50 auto/sec', autoClicks: 50 }
  ]
};

function HotelTycoon({ user, onBack }) {
  const [gameState, setGameState] = useState(() => {
    const saved = localStorage.getItem('hotelTycoonSave');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      cash: 10000,
      hotels: [{ ...HOTELS[0], occupancy: 0, currentADR: HOTELS[0].baseADR }],
      upgrades: {},
      totalRevenue: 0,
      daysElapsed: 0,
      prestigeLevel: 0
    };
  });

  const [clickPower, setClickPower] = useState(1);
  const [selectedHotel, setSelectedHotel] = useState(0);

  // Calculate derived stats
  const calculateStats = useCallback(() => {
    let totalAutoClicks = 0;
    let adrMultiplier = 1;
    let adrBonus = 0;
    let occupancyBoost = 0;

    Object.entries(gameState.upgrades).forEach(([category, items]) => {
      items.forEach(upgradeId => {
        const upgrade = UPGRADES[category]?.find(u => u.id === upgradeId);
        if (upgrade) {
          if (upgrade.autoClicks) totalAutoClicks += upgrade.autoClicks;
          if (upgrade.multiplier) adrMultiplier *= upgrade.multiplier;
          if (upgrade.adrBonus) adrBonus += upgrade.adrBonus;
          if (upgrade.occupancyBoost) occupancyBoost += upgrade.occupancyBoost;
        }
      });
    });

    return { totalAutoClicks, adrMultiplier, adrBonus, occupancyBoost };
  }, [gameState.upgrades]);

  // Save game state
  useEffect(() => {
    localStorage.setItem('hotelTycoonSave', JSON.stringify(gameState));
  }, [gameState]);

  // Game tick (revenue generation)
  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        const { adrMultiplier, adrBonus, occupancyBoost } = calculateStats();
        
        const newHotels = prev.hotels.map(hotel => {
          // Calculate effective ADR
          const effectiveADR = (hotel.baseADR + adrBonus) * adrMultiplier;
          
          // Calculate revenue: Rooms × Occupancy% × ADR
          const occupancyRate = Math.min(100, hotel.occupancy + occupancyBoost) / 100;
          const dailyRevenue = hotel.rooms * occupancyRate * effectiveADR;
          
          // Operating costs (30% of revenue)
          const costs = dailyRevenue * 0.3;
          const profit = dailyRevenue - costs;
          
          // Decay occupancy slightly each day (need to keep clicking or have automation)
          const newOccupancy = Math.max(0, hotel.occupancy - 2);
          
          return {
            ...hotel,
            occupancy: newOccupancy,
            currentADR: effectiveADR,
            dailyRevenue: profit
          };
        });

        const totalDailyProfit = newHotels.reduce((sum, h) => sum + (h.dailyRevenue || 0), 0);

        return {
          ...prev,
          hotels: newHotels,
          cash: prev.cash + totalDailyProfit,
          totalRevenue: prev.totalRevenue + totalDailyProfit,
          daysElapsed: prev.daysElapsed + 1
        };
      });
    }, GAME_DAY_MS);

    return () => clearInterval(interval);
  }, [calculateStats]);

  // Auto-clicker
  useEffect(() => {
    const { totalAutoClicks } = calculateStats();
    if (totalAutoClicks > 0) {
      const interval = setInterval(() => {
        handleClick(totalAutoClicks);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [calculateStats, selectedHotel]);

  const handleClick = (power = clickPower) => {
    setGameState(prev => {
      const newHotels = [...prev.hotels];
      const hotel = newHotels[selectedHotel];
      if (hotel) {
        hotel.occupancy = Math.min(100, hotel.occupancy + power);
      }
      return { ...prev, hotels: newHotels };
    });
  };

  const buyHotel = (hotel) => {
    if (gameState.cash >= hotel.cost) {
      setGameState(prev => ({
        ...prev,
        cash: prev.cash - hotel.cost,
        hotels: [...prev.hotels, { ...hotel, occupancy: 0, currentADR: hotel.baseADR }]
      }));
    }
  };

  const buyUpgrade = (category, upgrade) => {
    if (gameState.cash >= upgrade.cost) {
      setGameState(prev => ({
        ...prev,
        cash: prev.cash - upgrade.cost,
        upgrades: {
          ...prev.upgrades,
          [category]: [...(prev.upgrades[category] || []), upgrade.id]
        }
      }));
    }
  };

  const hasUpgrade = (category, upgradeId) => {
    return gameState.upgrades[category]?.includes(upgradeId);
  };

  const prestige = () => {
    if (window.confirm('Sell your entire portfolio and start over with a 2x cash multiplier?')) {
      setGameState({
        cash: 10000 * Math.pow(2, gameState.prestigeLevel + 1),
        hotels: [{ ...HOTELS[0], occupancy: 0, currentADR: HOTELS[0].baseADR }],
        upgrades: {},
        totalRevenue: gameState.totalRevenue,
        daysElapsed: 0,
        prestigeLevel: gameState.prestigeLevel + 1
      });
      setSelectedHotel(0);
    }
  };

  const stats = calculateStats();
  const currentHotel = gameState.hotels[selectedHotel];

  return (
    <div className="hotel-tycoon">
      <header className="hotel-header">
        <div className="header-left">
          <button className="btn-back" onClick={onBack}>← Back</button>
          <h1>🏨 Hotel Tycoon</h1>
        </div>
        <div className="header-stats">
          <div className="stat">
            <span className="stat-label">Cash</span>
            <span className="stat-value">${gameState.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Revenue</span>
            <span className="stat-value">${gameState.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Day</span>
            <span className="stat-value">{gameState.daysElapsed}</span>
          </div>
          {gameState.prestigeLevel > 0 && (
            <div className="stat prestige">
              <span className="stat-label">⭐ Prestige</span>
              <span className="stat-value">{gameState.prestigeLevel}</span>
            </div>
          )}
        </div>
      </header>

      <div className="game-container">
        <div className="left-panel">
          <div className="hotel-selector">
            <h3>Your Hotels ({gameState.hotels.length})</h3>
            {gameState.hotels.map((hotel, idx) => (
              <div
                key={idx}
                className={`hotel-card ${selectedHotel === idx ? 'selected' : ''}`}
                onClick={() => setSelectedHotel(idx)}
              >
                <div className="hotel-name">{hotel.name}</div>
                <div className="hotel-stats">
                  <div>{hotel.rooms} rooms</div>
                  <div>{hotel.occupancy.toFixed(0)}% occupied</div>
                  <div>${hotel.currentADR.toFixed(0)} ADR</div>
                  <div className="revenue">+${(hotel.dailyRevenue || 0).toFixed(0)}/day</div>
                </div>
              </div>
            ))}
          </div>

          <div className="available-hotels">
            <h3>Buy Hotels</h3>
            {HOTELS.filter(h => !gameState.hotels.find(owned => owned.id === h.id)).map(hotel => (
              <div key={hotel.id} className="buy-hotel-card">
                <div className="hotel-info">
                  <div className="hotel-name">{hotel.name}</div>
                  <div className="hotel-details">
                    {hotel.rooms} rooms • ${hotel.baseADR} base ADR
                  </div>
                </div>
                <button
                  className="btn-buy"
                  disabled={gameState.cash < hotel.cost}
                  onClick={() => buyHotel(hotel)}
                >
                  ${hotel.cost.toLocaleString()}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="center-panel">
          {currentHotel && (
            <div className="hotel-management">
              <h2>{currentHotel.name}</h2>
              
              <div className="metrics">
                <div className="metric-card">
                  <div className="metric-label">Occupancy</div>
                  <div className="metric-value">{currentHotel.occupancy.toFixed(1)}%</div>
                  <div className="metric-bar">
                    <div className="metric-fill" style={{ width: `${currentHotel.occupancy}%` }}></div>
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-label">ADR (Avg Daily Rate)</div>
                  <div className="metric-value">${currentHotel.currentADR.toFixed(0)}</div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-label">RevPAR</div>
                  <div className="metric-value">
                    ${((currentHotel.currentADR * currentHotel.occupancy) / 100).toFixed(0)}
                  </div>
                </div>
                
                <div className="metric-card highlight">
                  <div className="metric-label">Daily Profit</div>
                  <div className="metric-value">
                    ${(currentHotel.dailyRevenue || 0).toFixed(0)}
                  </div>
                </div>
              </div>

              <div className="clicker-area">
                <button className="click-button" onClick={() => handleClick()}>
                  Fill Rooms
                  <div className="click-power">+{clickPower}% occupancy</div>
                </button>
                {stats.totalAutoClicks > 0 && (
                  <div className="auto-stats">
                    ⚙️ {stats.totalAutoClicks} auto-clicks per second
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="right-panel">
          <div className="upgrades">
            <h3>Upgrades</h3>
            
            <div className="upgrade-category">
              <h4>💰 Revenue Management</h4>
              {UPGRADES.revenueManagement.map(upgrade => (
                <div key={upgrade.id} className="upgrade-item">
                  <div className="upgrade-info">
                    <div className="upgrade-name">{upgrade.name}</div>
                    <div className="upgrade-effect">{upgrade.effect}</div>
                  </div>
                  <button
                    className="btn-upgrade"
                    disabled={hasUpgrade('revenueManagement', upgrade.id) || gameState.cash < upgrade.cost}
                    onClick={() => buyUpgrade('revenueManagement', upgrade)}
                  >
                    {hasUpgrade('revenueManagement', upgrade.id) ? '✓' : `$${upgrade.cost.toLocaleString()}`}
                  </button>
                </div>
              ))}
            </div>

            <div className="upgrade-category">
              <h4>📢 Marketing</h4>
              {UPGRADES.marketing.map(upgrade => (
                <div key={upgrade.id} className="upgrade-item">
                  <div className="upgrade-info">
                    <div className="upgrade-name">{upgrade.name}</div>
                    <div className="upgrade-effect">{upgrade.effect}</div>
                  </div>
                  <button
                    className="btn-upgrade"
                    disabled={hasUpgrade('marketing', upgrade.id) || gameState.cash < upgrade.cost}
                    onClick={() => buyUpgrade('marketing', upgrade)}
                  >
                    {hasUpgrade('marketing', upgrade.id) ? '✓' : `$${upgrade.cost.toLocaleString()}`}
                  </button>
                </div>
              ))}
            </div>

            <div className="upgrade-category">
              <h4>🏊 Amenities</h4>
              {UPGRADES.amenities.map(upgrade => (
                <div key={upgrade.id} className="upgrade-item">
                  <div className="upgrade-info">
                    <div className="upgrade-name">{upgrade.name}</div>
                    <div className="upgrade-effect">{upgrade.effect}</div>
                  </div>
                  <button
                    className="btn-upgrade"
                    disabled={hasUpgrade('amenities', upgrade.id) || gameState.cash < upgrade.cost}
                    onClick={() => buyUpgrade('amenities', upgrade)}
                  >
                    {hasUpgrade('amenities', upgrade.id) ? '✓' : `$${upgrade.cost.toLocaleString()}`}
                  </button>
                </div>
              ))}
            </div>

            <div className="upgrade-category">
              <h4>⚙️ Automation</h4>
              {UPGRADES.automation.map(upgrade => (
                <div key={upgrade.id} className="upgrade-item">
                  <div className="upgrade-info">
                    <div className="upgrade-name">{upgrade.name}</div>
                    <div className="upgrade-effect">{upgrade.effect}</div>
                  </div>
                  <button
                    className="btn-upgrade"
                    disabled={hasUpgrade('automation', upgrade.id) || gameState.cash < upgrade.cost}
                    onClick={() => buyUpgrade('automation', upgrade)}
                  >
                    {hasUpgrade('automation', upgrade.id) ? '✓' : `$${upgrade.cost.toLocaleString()}`}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {gameState.totalRevenue > 1000000 && (
            <div className="prestige-section">
              <button className="btn-prestige" onClick={prestige}>
                ⭐ Prestige (Sell Portfolio)
              </button>
              <div className="prestige-info">
                Start over with {Math.pow(2, gameState.prestigeLevel + 1)}x starting cash
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HotelTycoon;
