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
      {/* Background diagonal wipe */}
      <div className="batman-wipe"></div>

      {/* Star bursts */}
      <div className="batman-starburst star1">★</div>
      <div className="batman-starburst star2">★</div>
      <div className="batman-starburst star3">★</div>
      <div className="batman-starburst star4">★</div>

      {/* Action words */}
      <div className="batman-word word1">STUDIO!</div>
      <div className="batman-word word2">ACTION!</div>

      {/* Main title */}
      <div className="batman-transition-content">
        <h1 className="batman-title">To The Studio...</h1>
      </div>

      {/* Audio element - Batman transition sound */}
      <audio ref={audioRef} preload="auto">
        {/* Using a creative commons retro transition sound */}
        <source 
          src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" 
          type="audio/mpeg" 
        />
      </audio>
    </div>
  );
}

export default BatmanTransition;
