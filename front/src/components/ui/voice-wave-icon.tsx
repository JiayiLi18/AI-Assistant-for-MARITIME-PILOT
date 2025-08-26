"use client"

import { useState, useEffect } from "react"

interface VoiceWaveIconProps {
  className?: string
  isAnimating?: boolean
}

export default function VoiceWaveIcon({ className = "w-4 h-4", isAnimating = false }: VoiceWaveIconProps) {
  return (
    <div className={`${className} flex items-center justify-center space-x-0.5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <SoundBar key={i} delay={i * 0.1} isAnimating={isAnimating} />
      ))}
    </div>
  )
}

function SoundBar({ delay, isAnimating }: { delay: number; isAnimating: boolean }) {
  const [height, setHeight] = useState(2) // Start with minimum height (0.5rem = 8px, so 2 = 4px equivalent)

  useEffect(() => {
    if (!isAnimating) {
      // When not recording, set to static heights for a nice visual pattern
      const staticHeights = [2, 4, 6, 4, 3] // Different heights for each bar
      const index = Math.round(delay * 10) % staticHeights.length
      setHeight(staticHeights[index])
      return
    }

    // When recording, create dynamic animation
    const interval = setInterval(
      () => {
        // Generate random height between 2 and 8 (equivalent to 4px to 16px)
        const newHeight = Math.random() * 6 + 2
        setHeight(newHeight)
      },
      120 + delay * 40, // Stagger the animation timing, faster than the original
    )

    return () => clearInterval(interval)
  }, [delay, isAnimating])

  return (
    <div
      className="w-0.5 bg-current rounded-full transition-all duration-150 ease-out"
      style={{
        height: `${height * 2}px`, // Convert to actual pixels
        animationDelay: `${delay}s`,
      }}
    />
  )
}
