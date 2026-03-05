import React, { useEffect, useRef } from 'react';
import './BatmanTransition.css';

function BatmanTransition({ onComplete }) {
  const audioRef = useRef(null);

  useEffect(() => {
    // Play the transition sound
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.log('Audio play failed:', err));
    }

    // Complete after 1.5 seconds (matches animation)
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="batman-transition">
      {/* Spinning and zooming Philo logo */}
      <div className="batman-logo">
        <div className="batman-logo-inner">
          <img src="/philo-logo.jpg" alt="Philo Ventures" />
        </div>
      </div>

      {/* Transition audio */}
      <audio ref={audioRef} preload="auto">
        <source 
          src="/batman-transition.mp3" 
          type="audio/mpeg" 
        />
      </audio>
    </div>
  );
}

export default BatmanTransition;
