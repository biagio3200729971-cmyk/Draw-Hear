# Input-to-Sound Latency Diagnosis Report

## Diagnostic Approach

Comprehensive timestamp logging has been added at critical points in the input-to-audio signal chain:

### 1. Input Event Layer
- **onTouchStart / handlePointerDown**: Logs exact time of browser touch/pointer event dispatch
- Tracks coordinate conversion time via `getBoundingClientRect()`

### 2. Audio Context Initialization
- **ensureContext()**: Logs AudioContext creation time and state transitions
- **ctx.resume()**: Logs time to resume from 'suspended' state (critical on iOS/Android)

### 3. Drawing State Updates
- **setIsDrawing()**: Logs React state update timing
- **inputStartTimeRef**: Stores the initial input time for later comparison

### 4. Audio Trigger Pipeline
- **triggerAgent()**: Logs exact moment audio trigger is called
- Logs current audioContext.currentTime at trigger moment
- Tracks all role-based triggers (pulse, motif, drone, breath)

### 5. Audio Node Playback
- **playRitualPercussion()**: Logs oscillator creation, connection, and `start()` call
- **playZenMotif()**: Similar logging for tone generation
- **playUnifiedNature()**: Logs buffer source scheduling
- **playEtherealBreath()**: Logs frequency setup and playback

## Key Measurement Points

### Critical Latency Sources to Monitor

```
INPUT EVENT (Touch/Pointer)
    ↓
[LATENCY 1] Event dispatch to handler execution: ~0-5ms
    ↓
Audio Context Resume (if suspended)
    ↓
[LATENCY 2] ensureContext() execution: ~5-50ms (iOS can be higher)
    ↓
React setIsDrawing() call
    ↓
[LATENCY 3] React state update scheduling: ~0-16ms
    ↓
Next RAF tick / Audio Sync Loop
    ↓
[LATENCY 4] Time waiting for next audioEngine tick: ~0-16.67ms
    ↓
triggerAgent() called from useEffect loop
    ↓
[LATENCY 5] triggerAgent() execution: ~1-3ms
    ↓
Oscillator/BufferSource creation and scheduling
    ↓
[LATENCY 6] osc.start(t) / bufferSource.start(t): ~0-1ms
    ↓
ACTUAL SOUND PLAYBACK
```

## Expected Findings

Based on code analysis, the probable latency distribution is:

1. **AudioContext Resume (MAJOR)** - iOS/Android: 20-50ms
2. **React state batching (MODERATE)** - 0-16ms (waits for RAF)
3. **RAF sync loop (MODERATE)** - 0-16.67ms (depends on when input occurs in frame)
4. **Audio scheduling jitter (MINOR)** - 1-3ms

## How to Interpret Logs

When you see console output like:
```
[LATENCY] TouchStart event at 1234567890.123
[LATENCY] audioEngine.ensureContext() completed in 35ms
[LATENCY] About to trigger PULSE at 1234567925.456
[LATENCY] triggerAgent called for role: pulse
[LATENCY] playRitualPercussion setup: 0.5ms, oscillator.start scheduling at 45.123
```

### Calculate Total Latency:
1. Find the initial touch/pointer event timestamp
2. Find the `playRitualPercussion after start()` log
3. Subtract: `(pulse start time) - (touch timestamp) = total latency`

## Desktop vs Mobile Expectations

### Desktop (Chrome/Firefox)
- AudioContext typically already running (state: 'running')
- ensureContext() = 1-5ms
- Total expected latency: 10-25ms

### Mobile iOS Safari
- AudioContext starts in 'suspended' state
- ensureContext() + resume() = 30-80ms (can spike higher)
- Total expected latency: 40-100ms+ (especially first touch)

### Mobile Android Chrome
- AudioContext typically running
- ensureContext() = 5-15ms
- Total expected latency: 15-40ms

## Diagnostic Checklist

After opening browser DevTools console:

1. ✅ **First touch/pointer on canvas** → Look for `[LATENCY] Input START event`
2. ✅ **Check AudioContext resume time** → Look for `[LATENCY] audioEngine.ensureContext() took Xms`
3. ✅ **Verify audio trigger delay** → Time from `Input START` to `About to trigger PULSE/MOTIF/DRONE/BREATH`
4. ✅ **Check oscillator start timing** → Look for `[LATENCY] playRitualPercussion setup`
5. ✅ **Identify bottleneck** → Largest single time gap indicates primary latency source

## What to Change After Diagnosis

Depending on findings:

### If AudioContext.resume() is the culprit (>30ms):
- **Solution**: Pre-initialize AudioContext on page load with a silent gesture
- Or use `audioContext.state` caching to avoid re-checking

### If React state updates cause delay:
- **Solution**: Bypass React for immediate audio trigger (use refs only, direct audio calls)
- Use `audioEngine.triggerAgent()` directly in touch handler without waiting for state update

### If RAF sync loop causes jitter:
- **Solution**: Schedule audio playback imperatively from input handlers
- Don't wait for the next tick loop to trigger sound

### If oscillator scheduling is slow:
- **Solution**: Create oscillator pool ahead of time (object pooling)
- Reuse allocated oscillators instead of creating new ones per trigger

## Notes for Developer

- Logs prefixed with `[LATENCY]` are for diagnostic purposes only
- These logs will impact performance slightly (5-10% overhead for logging)
- **IMPORTANT**: Remove all `[LATENCY]` logs before production deployment
- Consider using a logging library that can be compiled out in production builds

## Testing Methodology

1. Open DevTools (F12) → Console tab
2. Filter to show only `[LATENCY]` logs
3. Perform these test actions:
   - Single finger tap (should trigger pulse quickly)
   - Slow draw across canvas (should be immediate)
   - Quick swipe (should register as motion)
4. Note the exact timing sequences
5. Repeat on different devices (if possible)
6. Compare desktop vs mobile latencies

---

**Generated**: December 29, 2025
**Purpose**: Diagnose input-to-sound latency for optimization
**Status**: Diagnostic only - no behavior changes made yet
