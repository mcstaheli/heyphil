import React, { useEffect, useRef } from 'react';
import './BatmanTransition.css';

function BatmanTransition({ onComplete }) {
  const audioRef = useRef(null);

  useEffect(() => {
    // Play the transition sound
    if (audioRef.current) {
      audioRef.current.play().catch(err => console.log('Audio play failed:', err));
    }

    // Complete after 3 seconds
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 3000);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="batman-transition">
      {/* Background diagonal wipe bars */}
      <div className="batman-wipe"></div>

      {/* Rotating Philo logo in center */}
      <div className="batman-logo">
        <div className="batman-logo-inner">
          <img src="/philo-logo.jpg" alt="Philo Ventures" />
        </div>
      </div>

      {/* Corner Batman emblems */}
      <div className="batman-emblem top-left">🦇</div>
      <div className="batman-emblem top-right">🦇</div>
      <div className="batman-emblem bottom-left">🦇</div>
      <div className="batman-emblem bottom-right">🦇</div>

      {/* Main title overlaying center */}
      <div className="batman-transition-content">
        <h1 className="batman-title">To The Studio...</h1>
      </div>

      {/* Audio element - Batman transition sound */}
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
