import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Agent, Point, AgentRole, AIAnalysis } from './types';
import { audioEngine } from './services/audioEngine';
import { analyzeDrawing } from './services/geminiService';
import { TICK_RATE } from './constants';

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Intent-First Input Refs
  const activeStrokeRef = useRef<Point[]>([]);
  const pointerRef = useRef({ x: 0, y: 0 });
  const startPointRef = useRef<{ x: number, y: number } | null>(null);
  const lastCapturedPointRef = useRef<{ x: number, y: number } | null>(null);
  const inputStartTimeRef = useRef<number>(0);
  const hasExceededThresholdRef = useRef<boolean>(false);
  
  // Audio Sync Refs
  const tickRef = useRef<number>(0);
  const nextTickTimeRef = useRef<number>(0);

  // iOS/Android WebAudio unlock flag: Ensures resume() only called once
  const audioUnlockedRef = useRef<boolean>(false);
  
  // SINGLE SOURCE OF TRUTH for drawing state - used for audio logic (NOT React state)
  const isDrawingRef = useRef<boolean>(false);

  // Constants for Intent & Sanitization
  const DOT_DURATION_LIMIT = 180; 
  const DOT_DISTANCE_LIMIT = 8;   
  const INTENT_BUFFER_TIME = 100; 
  const MIN_SAMPLE_DIST = 4;      
  const SMOOTHING_FACTOR = 0.35;   

  // Store DPR for coordinate conversion
  const dprRef = useRef<number>(1);

  // Initialize Canvas with proper DPR scaling
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Get CSS dimensions from bounding rect (most accurate)
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || window.innerWidth;
    const cssHeight = rect.height || window.innerHeight;
    
    // Get device pixel ratio, capped at 2 for mobile performance
    const dpr = Math.min(window.devicePixelRatio, 2);
    dprRef.current = dpr;
    
    // Set canvas internal resolution: CSS size * DPR
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    
    // Scale context immediately after setting dimensions
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, []);

  useEffect(() => {
    initCanvas();
    window.addEventListener('resize', initCanvas);
    window.addEventListener('orientationchange', initCanvas);
    return () => {
      window.removeEventListener('resize', initCanvas);
      window.removeEventListener('orientationchange', initCanvas);
    };
  }, [initCanvas]);

  // Global Sync Engine: The system is the composer
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const now = audioEngine.currentTime;
      if (now >= nextTickTimeRef.current) {
        tickRef.current = (tickRef.current + 1) % 16;
        nextTickTimeRef.current = now + TICK_RATE;

        // Beautification: Thinning and Selection
        // Sort agents by "significance" (recency + intensity)
        setAgents(prev => {
          const sorted = [...prev].sort((a, b) => b.createdAt - a.createdAt);
          let triggerCount = 0;
          
          const result = prev.map(agent => {
            let triggered = false;
            const pan = (agent.center.x / window.innerWidth) * 2 - 1;
            const y = agent.center.y / window.innerHeight;

            // Only allow the top few most significant agents of each role to trigger
            const roleRank = sorted.filter(a => a.role === agent.role).indexOf(agent);
            const isSignificant = roleRank < 3; // Keep only top 3 of each type musically active

            if (isSignificant) {
              // PULSE (Dots): Ceremonial punctuation
              if (agent.role === 'pulse' && tickRef.current === 0) {
                if (Math.random() > 0.8) {
                  audioEngine.triggerAgent('pulse', y, agent.intensity, { pan, agentId: agent.id });
                  triggerCount++;
                  triggered = true;
                }
              }

              // MOTIF (Circles): Tonal beds
              if (agent.role === 'motif' && tickRef.current % 8 === 0) {
                if (Math.random() > 0.6) {
                  const noteIdx = agent.motifNotes[Math.floor(Math.random() * agent.motifNotes.length)];
                  audioEngine.triggerAgent('motif', y, agent.intensity, { noteIndex: noteIdx, pan, agentId: agent.id });
                  triggerCount++;
                  triggered = true;
                }
              }

              // DRONE (Nature): Constant background
              if (agent.role === 'drone' && tickRef.current === 0) {
                audioEngine.triggerAgent('drone', y, agent.intensity, { pan, agentId: agent.id });
                triggerCount++;
                triggered = true;
              }

              // BREATH (Human): Occasional presence
              if (agent.role === 'breath' && tickRef.current === 0) {
                if (Math.random() > 0.7) {
                  audioEngine.triggerAgent('breath', y, agent.intensity, { pan, agentId: agent.id });
                  triggerCount++;
                  triggered = true;
                }
              }
            }

            return { ...agent, playPulse: triggered ? 1.0 : agent.playPulse * 0.94 };
          });
          return result;
        });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Gesture Recognition with tolerance
  const recognizeGesture = (pts: Point[], bounds: { minX: number, maxX: number, minY: number, maxY: number }): AgentRole => {
    if (pts.length < 5) return 'drone';

    const diagonal = Math.sqrt(Math.pow(bounds.maxX - bounds.minX, 2) + Math.pow(bounds.maxY - bounds.minY, 2));
    let corners = 0;
    let curvatureSignChanges = 0;
    let prevAngle = null;
    let prevDeltaAngle = 0;

    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      if (i > 1) {
        const angle = Math.atan2(dy, dx);
        if (prevAngle !== null) {
          let deltaAngle = angle - prevAngle;
          while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
          while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

          if (Math.abs(deltaAngle) > Math.PI / 2.8) corners++;
          if (prevDeltaAngle !== 0 && Math.sign(deltaAngle) !== Math.sign(prevDeltaAngle) && Math.abs(deltaAngle) > 0.1) curvatureSignChanges++;
          if (Math.abs(deltaAngle) > 0.05) prevDeltaAngle = deltaAngle;
        }
        prevAngle = angle;
      }
    }

    const startEndDist = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    const isClosed = startEndDist < (0.2 * diagonal);

    if (isClosed && curvatureSignChanges < 4 && corners < 3) return 'motif';
    if (corners >= 2 && curvatureSignChanges < corners + 1) return 'breath';
    return 'drone';
  };

  // Visual-only logic (NOT audio-related)
  const handleInputStart = (x: number, y: number) => {
    setIsDrawing(true);
    inputStartTimeRef.current = performance.now();
    startPointRef.current = { x, y };
    lastCapturedPointRef.current = { x, y };
    pointerRef.current = { x, y };
    activeStrokeRef.current = [];
    hasExceededThresholdRef.current = false;
  };

  const handleInputMove = (x: number, y: number) => {
    pointerRef.current = { x, y };
    if (!isDrawing || !startPointRef.current || !lastCapturedPointRef.current) return;

    const distFromStart = Math.sqrt(Math.pow(x - startPointRef.current.x, 2) + Math.pow(y - startPointRef.current.y, 2));
    const elapsed = performance.now() - inputStartTimeRef.current;

    if (!hasExceededThresholdRef.current) {
      if (distFromStart > DOT_DISTANCE_LIMIT || elapsed > INTENT_BUFFER_TIME) {
        hasExceededThresholdRef.current = true;
        activeStrokeRef.current = [{ ...startPointRef.current, t: inputStartTimeRef.current, w: 4 }];
      }
      return;
    }

    const distFromLast = Math.sqrt(Math.pow(x - lastCapturedPointRef.current.x, 2) + Math.pow(y - lastCapturedPointRef.current.y, 2));
    if (distFromLast < MIN_SAMPLE_DIST) return;

    const smoothedX = SMOOTHING_FACTOR * x + (1 - SMOOTHING_FACTOR) * lastCapturedPointRef.current.x;
    const smoothedY = SMOOTHING_FACTOR * y + (1 - SMOOTHING_FACTOR) * lastCapturedPointRef.current.y;

    activeStrokeRef.current.push({ x: smoothedX, y: smoothedY, t: performance.now(), w: 4 });
    lastCapturedPointRef.current = { x: smoothedX, y: smoothedY };
  };

  const handleInputEnd = (x: number, y: number) => {
    if (!isDrawing || !startPointRef.current) {
      setIsDrawing(false);
      return;
    }
    
    const now = performance.now();
    const elapsed = now - inputStartTimeRef.current;
    const dist = Math.sqrt(Math.pow(x - startPointRef.current.x, 2) + Math.pow(y - startPointRef.current.y, 2));

    let finalRole: AgentRole | null = null;
    let finalPoints: Point[] = [];

    if (elapsed < DOT_DURATION_LIMIT && dist < DOT_DISTANCE_LIMIT) {
      finalRole = 'pulse';
      finalPoints = [{ x: startPointRef.current.x, y: startPointRef.current.y, t: now, w: 4 }];
    } else if (hasExceededThresholdRef.current && activeStrokeRef.current.length >= 2) {
      finalPoints = [...activeStrokeRef.current];
      const bounds = finalPoints.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x), minY: Math.min(acc.minY, p.y),
        maxX: Math.max(acc.maxX, p.x), maxY: Math.max(acc.maxY, p.y)
      }), { minX: finalPoints[0].x, minY: finalPoints[0].y, maxX: finalPoints[0].x, maxY: finalPoints[0].y });
      finalRole = recognizeGesture(finalPoints, bounds);
    }

    if (finalRole) {
      const bounds = finalPoints.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x), minY: Math.min(acc.minY, p.y),
        maxX: Math.max(acc.maxX, p.x), maxY: Math.max(acc.maxY, p.y)
      }), { minX: finalPoints[0]?.x || 0, minY: finalPoints[0]?.y || 0, maxX: finalPoints[0]?.x || 0, maxY: finalPoints[0]?.y || 0 });

      const newAgent: Agent = {
        id: Math.random().toString(36).substr(2, 9),
        role: finalRole,
        points: finalPoints,
        bounds,
        center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        intensity: 0.2 + Math.random() * 0.4,
        sequence: Array(16).fill(false),
        motifNotes: [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 3),
        droneFreq: 0,
        angle: finalPoints.length > 1 ? Math.atan2(finalPoints[finalPoints.length-1].y - finalPoints[0].y, finalPoints[finalPoints.length-1].x - finalPoints[0].x) : 0,
        playPulse: 0,
        breathOffset: Math.random() * Math.PI * 2,
        createdAt: Date.now()
      };
      setAgents(prev => [...prev, newAgent].slice(-30));
    }

    setIsDrawing(false);
    activeStrokeRef.current = [];
    startPointRef.current = null;
    lastCapturedPointRef.current = null;
    hasExceededThresholdRef.current = false;
  };

  // Pointer Events (mouse + pointer) - convert to canvas coordinates
  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Set pointer capture to prevent event loss
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if not supported
    }

    // SINGLE SOURCE OF TRUTH: Set drawing ref
    isDrawingRef.current = true;

    // IMMEDIATE AUDIO - synchronous in event call stack (BEFORE React state update)
    audioEngine.unlockIfNeeded();
    if (!audioUnlockedRef.current) {
      audioUnlockedRef.current = true;
    }
    audioEngine.immediateAttack(x, y);

    // THEN update visual state
    handleInputStart(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // Exit if not drawing
    if (!isDrawingRef.current) return;

    // Unconditional preventDefault for consistency
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // IMMEDIATE AUDIO modulation - synchronous in event call stack
    audioEngine.immediateModulation(x, y);

    // Then update drawing state
    handleInputMove(x, y);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Release pointer capture
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if not supported
    }

    // SINGLE SOURCE OF TRUTH: Set drawing ref to false
    isDrawingRef.current = false;

    // IMMEDIATE AUDIO release - synchronous in event call stack
    audioEngine.immediateRelease();

    // Then update drawing state
    handleInputEnd(x, y);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Release pointer capture
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if not supported
    }

    // SINGLE SOURCE OF TRUTH: Set drawing ref to false
    isDrawingRef.current = false;

    // IMMEDIATE AUDIO release - synchronous in event call stack
    audioEngine.immediateRelease();

    // Reset state
    setIsDrawing(false);
    activeStrokeRef.current = [];
    startPointRef.current = null;
    lastCapturedPointRef.current = null;
    hasExceededThresholdRef.current = false;
  };

  useEffect(() => {
    let rafId: number;
    const renderLoop = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx || !canvas) return;

      // Clear using CSS pixel dimensions (not scaled pixel dimensions)
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      const now = performance.now() / 1000;

      // Render Agents with persistent Zen styling
      agents.forEach(agent => {
        ctx.save();
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const breath = (Math.sin(now * 0.6 + agent.breathOffset) * 0.5 + 0.5);
        const tempoPulse = agent.playPulse;
        
        ctx.lineWidth = 1.8 * (1 + tempoPulse * 0.1);
        
        if (agent.role === 'pulse') {
          ctx.strokeStyle = `rgba(255, 230, 150, ${0.05 + tempoPulse * 0.3})`;
          ctx.shadowBlur = 3 + tempoPulse * 10;
          ctx.shadowColor = 'rgba(255, 230, 150, 0.2)';
        } else if (agent.role === 'motif') {
          ctx.strokeStyle = `rgba(180, 210, 255, ${0.05 + tempoPulse * 0.4})`;
          ctx.shadowBlur = 5 + tempoPulse * 15;
          ctx.shadowColor = 'rgba(180, 210, 255, 0.3)';
        } else if (agent.role === 'breath') {
          ctx.strokeStyle = `rgba(160, 255, 200, ${0.04 + tempoPulse * 0.2 + breath * 0.05})`;
          ctx.shadowBlur = 4 + tempoPulse * 12;
          ctx.shadowColor = 'rgba(160, 255, 200, 0.1)';
        } else {
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + tempoPulse * 0.15 + breath * 0.04})`;
          ctx.shadowBlur = 6 + tempoPulse * 20;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.08)';
        }

        if (agent.role === 'pulse') {
          ctx.arc(agent.center.x, agent.center.y, 2 + tempoPulse * 4, 0, Math.PI * 2);
        } else {
          agent.points.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
        }
        ctx.stroke();
        ctx.restore();
      });

      // Active Drawing
      if (isDrawing && hasExceededThresholdRef.current) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5;
        activeStrokeRef.current.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      }

      // Zen Cursor
      const cursorBreath = (Math.sin(now * 1.0) * 0.5 + 0.5);
      const cursorRadius = 3 + cursorBreath * 4;
      ctx.beginPath();
      const grad = ctx.createRadialGradient(pointerRef.current.x, pointerRef.current.y, 0, pointerRef.current.x, pointerRef.current.y, cursorRadius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.05 + cursorBreath * 0.1})`);
      grad.addColorStop(1, `rgba(255, 255, 255, 0)`);
      ctx.fillStyle = grad;
      ctx.arc(pointerRef.current.x, pointerRef.current.y, cursorRadius, 0, Math.PI * 2);
      ctx.fill();

      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [agents, isDrawing]);

  // Attach direct touch listeners to canvas (bypasses React event system)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const coords = getCanvasCoords(touch.clientX, touch.clientY);
      
      // SINGLE SOURCE OF TRUTH: Set drawing ref
      isDrawingRef.current = true;

      // IMMEDIATE AUDIO - synchronous in event call stack
      audioEngine.unlockIfNeeded();
      if (!audioUnlockedRef.current) {
        audioUnlockedRef.current = true;
      }
      audioEngine.immediateAttack(coords.x, coords.y);

      // Then update drawing state
      setIsDrawing(true);
      inputStartTimeRef.current = performance.now();
      startPointRef.current = { x: coords.x, y: coords.y };
      lastCapturedPointRef.current = { x: coords.x, y: coords.y };
      pointerRef.current = { x: coords.x, y: coords.y };
      activeStrokeRef.current = [];
      hasExceededThresholdRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      // Exit if not drawing
      if (!isDrawingRef.current) return;

      // Unconditional preventDefault
      e.preventDefault();
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const coords = getCanvasCoords(touch.clientX, touch.clientY);
      
      // IMMEDIATE AUDIO modulation - synchronous in event call stack
      audioEngine.immediateModulation(coords.x, coords.y);
      
      pointerRef.current = { x: coords.x, y: coords.y };
      if (!startPointRef.current || !lastCapturedPointRef.current) return;

      const distFromStart = Math.sqrt(Math.pow(coords.x - startPointRef.current.x, 2) + Math.pow(coords.y - startPointRef.current.y, 2));
      const elapsed = performance.now() - inputStartTimeRef.current;

      if (!hasExceededThresholdRef.current) {
        if (distFromStart > DOT_DISTANCE_LIMIT || elapsed > INTENT_BUFFER_TIME) {
          hasExceededThresholdRef.current = true;
          activeStrokeRef.current = [{ ...startPointRef.current, t: inputStartTimeRef.current, w: 4 }];
        }
        return;
      }

      const distFromLast = Math.sqrt(Math.pow(coords.x - lastCapturedPointRef.current.x, 2) + Math.pow(coords.y - lastCapturedPointRef.current.y, 2));
      if (distFromLast < MIN_SAMPLE_DIST) return;

      const smoothedX = SMOOTHING_FACTOR * coords.x + (1 - SMOOTHING_FACTOR) * lastCapturedPointRef.current.x;
      const smoothedY = SMOOTHING_FACTOR * coords.y + (1 - SMOOTHING_FACTOR) * lastCapturedPointRef.current.y;

      activeStrokeRef.current.push({ x: smoothedX, y: smoothedY, t: performance.now(), w: 4 });
      lastCapturedPointRef.current = { x: smoothedX, y: smoothedY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      // SINGLE SOURCE OF TRUTH: Set drawing ref to false
      isDrawingRef.current = false;

      // IMMEDIATE AUDIO release - synchronous in event call stack
      audioEngine.immediateRelease();

      if (!isDrawing || !startPointRef.current) {
        setIsDrawing(false);
        return;
      }

      if (e.changedTouches.length === 0) {
        setIsDrawing(false);
        return;
      }

      const touch = e.changedTouches[0];
      const coords = getCanvasCoords(touch.clientX, touch.clientY);

      const now = performance.now();
      const elapsed = now - inputStartTimeRef.current;
      const dist = Math.sqrt(Math.pow(coords.x - startPointRef.current.x, 2) + Math.pow(coords.y - startPointRef.current.y, 2));

      let finalRole: AgentRole | null = null;
      let finalPoints: Point[] = [];

      if (elapsed < DOT_DURATION_LIMIT && dist < DOT_DISTANCE_LIMIT) {
        finalRole = 'pulse';
        finalPoints = [{ x: startPointRef.current.x, y: startPointRef.current.y, t: now, w: 4 }];
      } else if (hasExceededThresholdRef.current && activeStrokeRef.current.length >= 2) {
        finalPoints = [...activeStrokeRef.current];
        const bounds = finalPoints.reduce((acc, p) => ({
          minX: Math.min(acc.minX, p.x), minY: Math.min(acc.minY, p.y),
          maxX: Math.max(acc.maxX, p.x), maxY: Math.max(acc.maxY, p.y)
        }), { minX: finalPoints[0].x, minY: finalPoints[0].y, maxX: finalPoints[0].x, maxY: finalPoints[0].y });
        finalRole = recognizeGesture(finalPoints, bounds);
      }

      if (finalRole) {
        const bounds = finalPoints.reduce((acc, p) => ({
          minX: Math.min(acc.minX, p.x), minY: Math.min(acc.minY, p.y),
          maxX: Math.max(acc.maxX, p.x), maxY: Math.max(acc.maxY, p.y)
        }), { minX: finalPoints[0]?.x || 0, minY: finalPoints[0]?.y || 0, maxX: finalPoints[0]?.x || 0, maxY: finalPoints[0]?.y || 0 });

        const newAgent: Agent = {
          id: Math.random().toString(36).substr(2, 9),
          role: finalRole,
          points: finalPoints,
          bounds,
          center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
          intensity: 0.2 + Math.random() * 0.4,
          sequence: Array(16).fill(false),
          motifNotes: [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 3),
          droneFreq: 0,
          angle: finalPoints.length > 1 ? Math.atan2(finalPoints[finalPoints.length-1].y - finalPoints[0].y, finalPoints[finalPoints.length-1].x - finalPoints[0].x) : 0,
          playPulse: 0,
          breathOffset: Math.random() * Math.PI * 2,
          createdAt: Date.now()
        };
        setAgents(prev => [...prev, newAgent].slice(-30));
      }

      setIsDrawing(false);
      activeStrokeRef.current = [];
      startPointRef.current = null;
      lastCapturedPointRef.current = null;
      hasExceededThresholdRef.current = false;
    };

    // Register touch listeners with { passive: false } to allow preventDefault()
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDrawing]);

  return (
    <div 
      className="relative w-full h-screen bg-[#020202] overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0"
        style={{ 
          touchAction: 'none',
          overscrollBehavior: 'none',
          pointerEvents: 'auto',
          WebkitUserSelect: 'none', 
          userSelect: 'none' 
        }}
      />


      {/* Bottom UI: Reset, Listen, Support */}
      <div className="fixed bottom-6 left-6 flex flex-col gap-3 z-30">
        <button
          onClick={() => setAgents([])}
          className="pointer-events-auto font-bold support-font text-[8px] md:text-[7px] tracking-[0.12em] text-white/75 bg-transparent border-none outline-none cursor-pointer select-none"
          style={{fontFamily: 'STZhongsong, Songti SC, SimSun, Noto Serif SC, serif'}}
        >
          Reset
        </button>
      </div>
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 items-end z-30">
        <button
          onClick={async () => {
            if (isAnalyzing || agents.length === 0) return;
            setIsAnalyzing(true);
            const dataUrl = canvasRef.current?.toDataURL();
            if (dataUrl) {
              const result = await analyzeDrawing(dataUrl);
              setAiAnalysis(result);
            }
            setIsAnalyzing(false);
          }}
          disabled={isAnalyzing}
          className="pointer-events-auto font-bold support-font text-[8px] md:text-[7px] tracking-[0.12em] text-white/75 bg-transparent border-none outline-none cursor-pointer select-none disabled:opacity-50"
          style={{fontFamily: 'STZhongsong, Songti SC, SimSun, Noto Serif SC, serif'}}
        >
          {isAnalyzing ? "..." : "Listen"}
        </button>
        <a
          href="https://buy.stripe.com/7sY9ASdn89fH8m67Xr2Fa00"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto font-bold support-font text-[8px] md:text-[7px] tracking-[0.12em] text-white/75 bg-transparent border-none outline-none cursor-pointer select-none"
          style={{fontFamily: 'STZhongsong, Songti SC, SimSun, Noto Serif SC, serif'}}
        >
          Support this experience →
        </a>
      </div>

      {/* Analysis Overlay */}
      {aiAnalysis && (
        <div className="absolute inset-0 bg-black/99 backdrop-blur-3xl z-50 flex items-center justify-center p-16 text-center animate-in fade-in duration-3000">
          <div className="max-w-md space-y-16">
            <div className="space-y-6">
              <div className="text-white/5 text-[7px] tracking-[2em] uppercase font-light">{aiAnalysis.mood}</div>
              <h2 className="text-4xl font-serif italic text-white/50 leading-tight">{aiAnalysis.title}</h2>
            </div>
            <p className="text-white/10 font-serif text-lg leading-relaxed italic font-light">"{aiAnalysis.description}"</p>
            <button 
              onClick={() => setAiAnalysis(null)}
              className="px-8 py-3 border border-white/5 rounded-full text-[7px] tracking-[1em] text-white/10 hover:text-white hover:border-white/10 transition-all uppercase font-bold"
            >
              Return
            </button>
          </div>
        </div>
      )}

      <style>{`
        .support-font {
          font-family: "STZhongsong", "Songti SC", "SimSun", "Noto Serif SC", serif;
          letter-spacing: 0.12em;
        }
        .font-serif { font-family: 'Playfair Display', serif; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-in { animation: fadeIn 5s cubic-bezier(0.4, 0, 0.2, 1); }
      `}</style>
    </div>
  );
};

export default App;
