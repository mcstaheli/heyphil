import React, { useState, useEffect, useRef, useCallback } from 'react';
import './HotelVisual.css';

const TICK_MS = 100;
const SERVICE_TYPES = {
  housekeeping: { name: 'Housekeeping', emoji: '🧹', baseTip: 5, duration: 20, unlockAt: 0 },
  amenities: { name: 'Amenities', emoji: '🧴', baseTip: 8, duration: 30, unlockAt: 0 },
  roomService: { name: 'Room Service', emoji: '🍔', baseTip: 15, duration: 50, unlockAt: 100 },
  entertainment: { name: 'Entertainment', emoji: '📺', baseTip: 12, duration: 40, unlockAt: 100 },
  spa: { name: 'Spa Services', emoji: '💆', baseTip: 50, duration: 100, unlockAt: 500 },
  concierge: { name: 'Concierge', emoji: '🎩', baseTip: 40, duration: 80, unlockAt: 500 },
  vip: { name: 'VIP Treatment', emoji: '🍾', baseTip: 200, duration: 200, unlockAt: 2000 },
  luxury: { name: 'Luxury Services', emoji: '✨', baseTip: 500, duration: 300, unlockAt: 2000 }
};

const GUEST_TYPES = {
  business: { name: 'Business', emoji: '💼', adrMult: 1.2, serviceDemand: 0.3, color: '#3b82f6' },
  family: { name: 'Family', emoji: '👨‍👩‍👧', adrMult: 0.9, serviceDemand: 0.5, color: '#22c55e' },
  tourist: { name: 'Tourist', emoji: '🎒', adrMult: 1.0, serviceDemand: 0.4, color: '#f59e0b' },
  vip: { name: 'VIP', emoji: '⭐', adrMult: 3.0, serviceDemand: 0.8, color: '#fbbf24' }
};

const WEATHER_TYPES = [
  { name: 'Sunny', emoji: '☀️', guestMult: 1.2, color: '#fbbf24' },
  { name: 'Rainy', emoji: '🌧️', guestMult: 0.8, color: '#3b82f6' },
  { name: 'Snowy', emoji: '❄️', guestMult: 0.6, color: '#60a5fa' },
  { name: 'Cloudy', emoji: '☁️', guestMult: 1.0, color: '#6b7280' }
];

const EVENTS = [
  { id: 'convention', name: 'Tech Convention', emoji: '🎪', guestMult: 2.5, duration: 200, chance: 0.005 },
  { id: 'holiday', name: 'Holiday Season', emoji: '🎄', adrMult: 1.5, duration: 300, chance: 0.003 },
  { id: 'festival', name: 'Music Festival', emoji: '🎵', guestMult: 2.0, duration: 150, chance: 0.008 },
  { id: 'sports', name: 'Sports Tournament', emoji: '🏆', guestMult: 1.8, duration: 100, chance: 0.006 }
];

const ACHIEVEMENTS = [
  { id: 'first_service', name: 'First Service', desc: 'Complete your first service', reward: { tips: 100 }, check: s => s.stats.servicesCompleted >= 1 },
  { id: 'happy_guests', name: 'Guest Satisfaction', desc: 'Maintain 90% happiness', reward: { reputation: 50 }, check: s => s.stats.happiness >= 90 },
  { id: 'service_master', name: 'Service Master', desc: 'Complete 100 services', reward: { tips: 1000 }, check: s => s.stats.servicesCompleted >= 100 },
  { id: 'money_maker', name: 'Money Maker', desc: 'Earn $50,000 total', reward: { cash: 5000 }, check: s => s.stats.totalRevenue >= 50000 },
  { id: 'full_house', name: 'Full House', desc: 'Fill all rooms', reward: { reputation: 100 }, check: s => s.hotels[0].rooms.every(r => r.guest) }
];

const INITIAL_STATE = {
  cash: 20000,
  tips: 0,
  reputation: 100,
  operations: 100,
  
  hotels: [{
    id: 1,
    name: 'Grand Hotel',
    floors: 3,
    roomsPerFloor: 5,
    rooms: [] // {id, floor, position, guest: {type, nights, happiness, service}}
  }],
  
  staff: 3,
  serviceStaff: 2,
  
  guestQueue: 5,
  guestArrivalRate: 3,
  
  activeServices: [], // {roomId, type, progress, staffId}
  
  upgrades: {
    autoCheckin: 0,
    marketing: 0,
    serviceSpeed: 0,
    autoService: 0,
    operations: 0,
    staffTraining: 0
  },
  
  stats: {
    totalRevenue: 0,
    servicesCompleted: 0,
    totalTips: 0,
    guestsServed: 0,
    happiness: 100
  },
  
  tick: 0,
  phase: 1,
  weather: 0, // index into WEATHER_TYPES
  weatherTimer: 0,
  
  activeEvent: null,
  eventTimer: 0,
  
  achievements: [],
  notifications: [],
  particles: [] // {id, x, y, text, color, life}
};

// Initialize rooms
INITIAL_STATE.hotels[0].rooms = [];
for (let floor = 0; floor < 3; floor++) {
  for (let pos = 0; pos < 5; pos++) {
    INITIAL_STATE.hotels[0].rooms.push({
      id: `r${floor}-${pos}`,
      floor,
      position: pos,
      guest: null
    });
  }
}

function HotelVisual({ user, onBack }) {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem('hotelVisualSave');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_STATE;
      }
    }
    return INITIAL_STATE;
  });
  
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showServiceMenu, setShowServiceMenu] = useState(null);
  const nextGuestId = useRef(1);
  
  useEffect(() => {
    localStorage.setItem('hotelVisualSave', JSON.stringify(state));
  }, [state]);
  
  // Main game loop
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => {
        const newTick = prev.tick + 1;
        let newCash = prev.cash;
        let newTips = prev.tips;
        let newStats = { ...prev.stats };
        
        // Update hotels
        const newHotels = prev.hotels.map(hotel => {
          const newRooms = hotel.rooms.map(room => {
            if (!room.guest) return room;
            
            // Guest checkout
            const newNights = room.guest.nights - 0.01;
            if (newNights <= 0) {
              const revenue = 60 * room.guest.type.adrMult;
              newCash += revenue;
              newStats.totalRevenue += revenue;
              newStats.guestsServed += 1;
              return { ...room, guest: null };
            }
            
            // Happiness decay
            let newHappiness = room.guest.happiness - 0.05;
            
            // Service need
            let needsService = room.guest.needsService;
            if (!needsService && Math.random() < room.guest.type.serviceDemand * 0.01) {
              needsService = true;
              newHappiness -= 5;
            }
            
            if (needsService && newHappiness < 50) {
              newHappiness -= 0.1; // Faster decay when service needed
            }
            
            return {
              ...room,
              guest: {
                ...room.guest,
                nights: newNights,
                happiness: Math.max(0, newHappiness),
                needsService
              }
            };
          });
          
          return { ...hotel, rooms: newRooms };
        });
        
        // Process active services
        const newActiveServices = prev.activeServices.map(service => {
          const newProgress = service.progress + (1 + prev.upgrades.serviceSpeed * 0.2);
          if (newProgress >= service.duration) {
            // Service complete!
            const serviceType = SERVICE_TYPES[service.type];
            const tip = serviceType.baseTip * (1 + prev.upgrades.staffTraining * 0.1);
            newTips += tip;
            newStats.totalTips += tip;
            newStats.servicesCompleted += 1;
            
            // Update room
            const hotel = newHotels[0];
            const room = hotel.rooms.find(r => r.id === service.roomId);
            if (room && room.guest) {
              room.guest.happiness = Math.min(100, room.guest.happiness + 20);
              room.guest.needsService = false;
            }
            
            return null; // Remove completed service
          }
          return { ...service, progress: newProgress };
        }).filter(s => s !== null);
        
        // Auto check-in
        let newQueue = prev.guestQueue;
        const arrivalRate = prev.guestArrivalRate * (prev.reputation / 100) * 0.1;
        newQueue = Math.min(newQueue + arrivalRate, 50);
        
        if (prev.upgrades.autoCheckin > 0) {
          const autoCheckIns = prev.upgrades.autoCheckin * 0.1;
          const hotel = newHotels[0];
          const emptyRooms = hotel.rooms.filter(r => !r.guest);
          
          for (let i = 0; i < Math.min(autoCheckIns, newQueue, emptyRooms.length); i++) {
            const room = emptyRooms[i];
            const guestType = Math.random() < 0.1 ? GUEST_TYPES.vip : 
                             Math.random() < 0.3 ? GUEST_TYPES.business :
                             Math.random() < 0.6 ? GUEST_TYPES.family :
                             GUEST_TYPES.tourist;
            
            room.guest = {
              id: nextGuestId.current++,
              type: guestType,
              nights: Math.floor(Math.random() * 3) + 1,
              happiness: 100,
              needsService: false
            };
            newQueue -= 1;
          }
        }
        
        // Auto service
        if (prev.upgrades.autoService > 0 && newActiveServices.length < prev.serviceStaff) {
          const hotel = newHotels[0];
          const roomsNeedingService = hotel.rooms.filter(r => r.guest?.needsService);
          
          for (const room of roomsNeedingService.slice(0, prev.serviceStaff - newActiveServices.length)) {
            const availableServices = Object.keys(SERVICE_TYPES).filter(
              key => SERVICE_TYPES[key].unlockAt <= newStats.servicesCompleted
            );
            if (availableServices.length > 0) {
              const randomService = availableServices[Math.floor(Math.random() * availableServices.length)];
              const serviceType = SERVICE_TYPES[randomService];
              
              newActiveServices.push({
                roomId: room.id,
                type: randomService,
                progress: 0,
                duration: serviceType.duration,
                staffId: newActiveServices.length
              });
            }
          }
        }
        
        // Staff costs
        const staffCost = (prev.staff + prev.serviceStaff) * 0.2;
        newCash -= staffCost;
        
        // Calculate average happiness
        const occupiedRooms = newHotels[0].rooms.filter(r => r.guest);
        const avgHappiness = occupiedRooms.length > 0 
          ? occupiedRooms.reduce((sum, r) => sum + r.guest.happiness, 0) / occupiedRooms.length
          : 100;
        
        newStats.happiness = avgHappiness;
        
        // Reputation based on happiness
        let newReputation = prev.reputation;
        if (avgHappiness > 80) {
          newReputation = Math.min(200, newReputation + 0.1);
        } else if (avgHappiness < 50) {
          newReputation = Math.max(0, newReputation - 0.2);
        }
        
        // Weather changes
        let newWeather = prev.weather;
        let newWeatherTimer = prev.weatherTimer + 1;
        if (newWeatherTimer >= 500) { // Change weather every 50 seconds
          newWeather = Math.floor(Math.random() * WEATHER_TYPES.length);
          newWeatherTimer = 0;
        }
        
        // Events
        let newActiveEvent = prev.activeEvent;
        let newEventTimer = prev.eventTimer;
        let newNotifications = [...prev.notifications];
        
        if (newActiveEvent) {
          newEventTimer += 1;
          if (newEventTimer >= newActiveEvent.duration) {
            newActiveEvent = null;
            newEventTimer = 0;
            newNotifications.push({ id: Date.now(), text: `${newActiveEvent.name} ended!`, color: '#6b7280', life: 50 });
          }
        } else if (Math.random() < 0.001) { // Small chance each tick
          const possibleEvents = EVENTS.filter(e => Math.random() < e.chance);
          if (possibleEvents.length > 0) {
            newActiveEvent = possibleEvents[0];
            newEventTimer = 0;
            newNotifications.push({ id: Date.now(), text: `${newActiveEvent.emoji} ${newActiveEvent.name} started!`, color: '#fbbf24', life: 100 });
          }
        }
        
        // Check achievements
        let newAchievements = [...prev.achievements];
        ACHIEVEMENTS.forEach(achievement => {
          if (!prev.achievements.includes(achievement.id) && achievement.check(prev)) {
            newAchievements.push(achievement.id);
            newNotifications.push({ id: Date.now(), text: `🏆 ${achievement.name} unlocked!`, color: '#fbbf24', life: 150 });
            // Apply rewards
            if (achievement.reward.cash) newCash += achievement.reward.cash;
            if (achievement.reward.tips) newTips += achievement.reward.tips;
            if (achievement.reward.reputation) newReputation += achievement.reward.reputation;
          }
        });
        
        // Update notifications (decay life)
        newNotifications = newNotifications.map(n => ({ ...n, life: n.life - 1 })).filter(n => n.life > 0);
        
        // Phase
        let newPhase = 1;
        if (newStats.totalRevenue >= 50000) newPhase = 2;
        if (newStats.servicesCompleted >= 500) newPhase = 3;
        if (prev.hotels.length >= 5) newPhase = 4;
        
        return {
          ...prev,
          tick: newTick,
          hotels: newHotels,
          cash: newCash,
          tips: newTips,
          stats: newStats,
          guestQueue: newQueue,
          activeServices: newActiveServices,
          reputation: newReputation,
          phase: newPhase,
          weather: newWeather,
          weatherTimer: newWeatherTimer,
          activeEvent: newActiveEvent,
          eventTimer: newEventTimer,
          achievements: newAchievements,
          notifications: newNotifications
        };
      });
    }, TICK_MS);
    
    return () => clearInterval(interval);
  }, []);
  
  // Manual check-in
  const checkInGuest = useCallback(() => {
    if (state.guestQueue < 1) return;
    
    setState(prev => {
      const hotel = prev.hotels[0];
      const emptyRoom = hotel.rooms.find(r => !r.guest);
      if (!emptyRoom) return prev;
      
      const guestType = Math.random() < 0.1 ? GUEST_TYPES.vip : 
                       Math.random() < 0.3 ? GUEST_TYPES.business :
                       Math.random() < 0.6 ? GUEST_TYPES.family :
                       GUEST_TYPES.tourist;
      
      const newHotels = [...prev.hotels];
      const room = newHotels[0].rooms.find(r => r.id === emptyRoom.id);
      room.guest = {
        id: nextGuestId.current++,
        type: guestType,
        nights: Math.floor(Math.random() * 3) + 1,
        happiness: 100,
        needsService: false
      };
      
      return {
        ...prev,
        hotels: newHotels,
        guestQueue: prev.guestQueue - 1
      };
    });
  }, [state.guestQueue]);
  
  // Start service
  const startService = useCallback((roomId, serviceType) => {
    setState(prev => {
      if (prev.activeServices.length >= prev.serviceStaff) return prev;
      
      const service = SERVICE_TYPES[serviceType];
      if (service.unlockAt > prev.stats.servicesCompleted) return prev;
      
      return {
        ...prev,
        activeServices: [...prev.activeServices, {
          roomId,
          type: serviceType,
          progress: 0,
          duration: service.duration,
          staffId: prev.activeServices.length
        }]
      };
    });
    setShowServiceMenu(null);
  }, []);
  
  // Buy upgrade
  const buyUpgrade = useCallback((upgradeType) => {
    const costs = {
      autoCheckin: { cash: 5000 * Math.pow(1.5, state.upgrades.autoCheckin), label: 'Auto Check-in' },
      marketing: { cash: 3000 * Math.pow(1.5, state.upgrades.marketing), label: 'Marketing' },
      serviceSpeed: { tips: 1000 * Math.pow(2, state.upgrades.serviceSpeed), label: 'Service Speed' },
      autoService: { tips: 5000 * Math.pow(2, state.upgrades.autoService), cash: 10000, label: 'Auto Service' },
      operations: { cash: 20000 * Math.pow(1.5, state.upgrades.operations), label: 'Operations' },
      staffTraining: { tips: 2000 * Math.pow(1.8, state.upgrades.staffTraining), label: 'Staff Training' }
    };
    
    const cost = costs[upgradeType];
    if (!cost) return;
    
    if (cost.cash && state.cash < cost.cash) return;
    if (cost.tips && state.tips < cost.tips) return;
    
    setState(prev => ({
      ...prev,
      cash: prev.cash - (cost.cash || 0),
      tips: prev.tips - (cost.tips || 0),
      upgrades: {
        ...prev.upgrades,
        [upgradeType]: prev.upgrades[upgradeType] + 1
      }
    }));
  }, [state.cash, state.tips, state.upgrades]);
  
  const hotel = state.hotels[0];
  const occupiedRooms = hotel.rooms.filter(r => r.guest).length;
  const totalRooms = hotel.rooms.length;
  
  return (
    <div className="hotel-visual">
      <header className="visual-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h1>🏨 {hotel.name}</h1>
        <div className="phase-indicator">Phase {state.phase}</div>
      </header>
      
      <div className="resources-bar">
        <div className="resource">
          <span className="resource-label">Cash</span>
          <span className="resource-value">${Math.floor(state.cash).toLocaleString()}</span>
        </div>
        <div className="resource">
          <span className="resource-label">Tips</span>
          <span className="resource-value tip-color">${Math.floor(state.tips).toLocaleString()}</span>
        </div>
        <div className="resource">
          <span className="resource-label">Queue</span>
          <span className="resource-value">{Math.floor(state.guestQueue)}</span>
        </div>
        <div className="resource">
          <span className="resource-label">Reputation</span>
          <span className="resource-value">{Math.floor(state.reputation)}</span>
        </div>
        <div className="resource">
          <span className="resource-label">Happiness</span>
          <span className="resource-value">{Math.floor(state.stats.happiness)}%</span>
        </div>
        <div className="resource">
          <span className="resource-label">Weather</span>
          <span className="resource-value">{WEATHER_TYPES[state.weather].emoji} {WEATHER_TYPES[state.weather].name}</span>
        </div>
        {state.activeEvent && (
          <div className="resource event-active">
            <span className="resource-label">Event</span>
            <span className="resource-value">{state.activeEvent.emoji} {state.activeEvent.name}</span>
          </div>
        )}
      </div>
      
      {state.notifications.length > 0 && (
        <div className="notifications-container">
          {state.notifications.map(notif => (
            <div key={notif.id} className="notification" style={{ color: notif.color, opacity: notif.life / 100 }}>
              {notif.text}
            </div>
          ))}
        </div>
      )}
      
      <div className="game-container-visual">
        <div className="left-controls">
          <button className="big-btn" onClick={checkInGuest} disabled={state.guestQueue < 1 || occupiedRooms >= totalRooms}>
            Check In Guest
            <small>{Math.floor(state.guestQueue)} in queue</small>
          </button>
          
          <div className="stats-box">
            <h3>Stats</h3>
            <div className="stat-line">Revenue: ${Math.floor(state.stats.totalRevenue).toLocaleString()}</div>
            <div className="stat-line">Services: {state.stats.servicesCompleted}</div>
            <div className="stat-line">Total Tips: ${Math.floor(state.stats.totalTips).toLocaleString()}</div>
            <div className="stat-line">Rooms: {occupiedRooms}/{totalRooms}</div>
          </div>
          
          <div className="upgrades-box">
            <h3>Upgrades</h3>
            <button onClick={() => buyUpgrade('autoCheckin')} className="upgrade-btn">
              Auto Check-in Lv.{state.upgrades.autoCheckin}
              <small>${(5000 * Math.pow(1.5, state.upgrades.autoCheckin)).toFixed(0)}</small>
            </button>
            <button onClick={() => buyUpgrade('marketing')} className="upgrade-btn">
              Marketing Lv.{state.upgrades.marketing}
              <small>${(3000 * Math.pow(1.5, state.upgrades.marketing)).toFixed(0)}</small>
            </button>
            <button onClick={() => buyUpgrade('serviceSpeed')} className="upgrade-btn">
              Service Speed Lv.{state.upgrades.serviceSpeed}
              <small className="tip-color">${(1000 * Math.pow(2, state.upgrades.serviceSpeed)).toFixed(0)} tips</small>
            </button>
            <button onClick={() => buyUpgrade('autoService')} className="upgrade-btn">
              Auto Service Lv.{state.upgrades.autoService}
              <small className="tip-color">${(5000 * Math.pow(2, state.upgrades.autoService)).toFixed(0)} tips</small>
            </button>
            <button onClick={() => buyUpgrade('staffTraining')} className="upgrade-btn">
              Staff Training Lv.{state.upgrades.staffTraining}
              <small className="tip-color">${(2000 * Math.pow(1.8, state.upgrades.staffTraining)).toFixed(0)} tips</small>
            </button>
          </div>
        </div>
        
        <div className="hotel-building">
          {[...Array(hotel.floors)].map((_, floorIdx) => {
            const floor = hotel.floors - 1 - floorIdx;
            return (
              <div key={floor} className="floor">
                <div className="floor-label">Floor {floor + 1}</div>
                <div className="rooms-row">
                  {hotel.rooms
                    .filter(r => r.floor === floor)
                    .sort((a, b) => a.position - b.position)
                    .map(room => {
                      const hasService = state.activeServices.find(s => s.roomId === room.id);
                      const needsService = room.guest?.needsService && !hasService;
                      
                      return (
                        <div
                          key={room.id}
                          className={`room ${room.guest ? 'occupied' : 'empty'} ${needsService ? 'needs-service' : ''}`}
                          onClick={() => {
                            if (room.guest && needsService) {
                              setShowServiceMenu(room.id);
                            }
                          }}
                        >
                          <div className="room-number">{floor}{room.position}</div>
                          {room.guest && (
                            <>
                              <div className="guest-icon" style={{ color: room.guest.type.color }}>
                                {room.guest.type.emoji}
                              </div>
                              <div className="happiness-bar">
                                <div 
                                  className="happiness-fill"
                                  style={{ width: `${room.guest.happiness}%` }}
                                />
                              </div>
                              {needsService && <div className="service-bell">🛎️</div>}
                              {hasService && (
                                <div className="service-progress">
                                  <div 
                                    className="service-fill"
                                    style={{ width: `${(hasService.progress / hasService.duration) * 100}%` }}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
        
        {showServiceMenu && (
          <div className="service-menu-overlay" onClick={() => setShowServiceMenu(null)}>
            <div className="service-menu" onClick={e => e.stopPropagation()}>
              <h3>Select Service</h3>
              {Object.entries(SERVICE_TYPES)
                .filter(([key, service]) => service.unlockAt <= state.stats.servicesCompleted)
                .map(([key, service]) => (
                  <button
                    key={key}
                    className="service-option"
                    onClick={() => startService(showServiceMenu, key)}
                  >
                    <span className="service-emoji">{service.emoji}</span>
                    <span className="service-name">{service.name}</span>
                    <span className="service-tip">${service.baseTip} tip</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HotelVisual;
