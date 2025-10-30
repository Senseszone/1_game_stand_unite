// src/components/CentralPeripheralWaitGame.jsx
import React, { useState, useRef, useCallback, useEffect } from "react";

/**
 * CentralPeripheralWaitGame – WAIT verze
 * - Centrální čtverec + 4 periferní 5×5 gridy
 * - Ve středu se objeví podnět, po prodlevě se objeví stejný v jednom z periferních gridů
 * - Hráč klikne na periferní podnět (WAIT – zůstává do zásahu)
 * - Loguje reakční čas, směr (A–D), přesnost kliknutí
 */

export default function CentralPeripheralWaitGame({ sessionId, taskId, emitEvent, emitScore }) {
  const GRID_SIZE = 5;
  const TOTAL_TRIALS = 50;
  const DELAY_BETWEEN = 800;

  const [running, setRunning] = useState(false);
  const [centralStim, setCentralStim] = useState(null);
  const [peripheralStim, setPeripheralStim] = useState(null);
  const [trialCount, setTrialCount] = useState(0);
  const stageRef = useRef(null);
  const startTsRef = useRef(null);
  const reactionStartRef = useRef(null);

  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  const reactionListRef = useRef([]);

  const nowMs = () => Date.now();
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  const quadrants = ["A", "B", "C", "D"]; // vlevo nahoře, vpravo nahoře, vlevo dole, vpravo dole

  const reset = useCallback(() => {
    setCentralStim(null);
    setPeripheralStim(null);
    setTrialCount(0);
    hitsRef.current = 0;
    errorsRef.current = 0;
    reactionListRef.current = [];
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    const end = nowMs();
    const durationMs = startTsRef.current ? end - startTsRef.current : 0;
    const avgRT =
      reactionListRef.current.length > 0
        ? Math.round(
            reactionListRef.current.reduce((a, b) => a + b, 0) / reactionListRef.current.length
          )
        : 0;

    emitScore?.({
      taskId,
      durationMs,
      metrics: {
        hits: hitsRef.current,
        errors: errorsRef.current,
        avgReactionMs: avgRT,
        completionTimeSec: Math.round(durationMs / 1000),
      },
      details: {
        trials: TOTAL_TRIALS,
        reactionList: reactionListRef.current,
      },
    });

    emitEvent?.({
      type: "END",
      ts: end,
      data: { hits: hitsRef.current, errors: errorsRef.current, avgReactionMs: avgRT },
    });
  }, [emitScore, emitEvent, taskId]);

  const start = useCallback(() => {
    reset();
    setRunning(true);
    const ts = nowMs();
    startTsRef.current = ts;
    emitEvent?.({ type: "START", ts, data: { sessionId, taskId } });
    nextTrial();
  }, [reset, emitEvent, sessionId, taskId]);

  const nextTrial = useCallback(() => {
    if (trialCount >= TOTAL_TRIALS) return stop();

    const stimColor = Math.random() < 0.5 ? "#4ADE80" : "#60A5FA"; // zelená nebo modrá
    setCentralStim({ color: stimColor, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });

    emitEvent?.({ type: "CENTRAL_STIM", ts: nowMs(), data: { color: stimColor } });

    setTimeout(() => {
      const quadrant = quadrants[randInt(0, 3)];
      const targetIdx = randInt(0, GRID_SIZE * GRID_SIZE - 1);
      setPeripheralStim({ color: stimColor, quadrant, idx: targetIdx });
      reactionStartRef.current = performance.now();

      emitEvent?.({
        type: "PERIPH_STIM",
        ts: nowMs(),
        data: { quadrant, idx: targetIdx, color: stimColor },
      });
    }, DELAY_BETWEEN);
  }, [trialCount, stop, emitEvent]);

  const handleClick = useCallback(
    (quad, idx, ev) => {
      if (!running || !peripheralStim) return;

      const rt = Math.round(performance.now() - reactionStartRef.current);
      const correct = quad === peripheralStim.quadrant && idx === peripheralStim.idx;

      if (correct) {
        hitsRef.current += 1;
        reactionListRef.current.push(rt);
        emitEvent?.({
          type: "HIT",
          ts: nowMs(),
          data: { quadrant: quad, idx, reactionMs: rt },
        });
      } else {
        errorsRef.current += 1;
        emitEvent?.({
          type: "ERROR",
          ts: nowMs(),
          data: { quadrant: quad, idx, reactionMs: rt },
        });
      }

      setCentralStim(null);
      setPeripheralStim(null);
      setTrialCount((t) => t + 1);

      if (trialCount + 1 >= TOTAL_TRIALS) stop();
      else setTimeout(nextTrial, 600);
    },
    [running, peripheralStim, nextTrial, stop, emitEvent, trialCount]
  );

  // Layout rendering for 4 grids
  const renderGrid = (quad) => {
    const active =
      peripheralStim && peripheralStim.quadrant === quad ? peripheralStim : null;

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          gap: 4,
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#0D2B55",
          borderRadius: 10,
          padding: 4,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => (
          <button
            key={idx}
            onClick={(ev) => handleClick(quad, idx, ev)}
            style={{
              border: "1px solid #1E3A8A",
              background: active && active.idx === idx ? active.color : "#fff",
              borderRadius: 6,
              cursor: running ? "pointer" : "default",
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      ref={stageRef}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#1A4E8A",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 20,
        padding: 40,
        position: "relative",
      }}
    >
      {/* 4 Peripheral grids */}
      {["A", "B", "C", "D"].map((q) => (
        <div key={q}>{renderGrid(q)}</div>
      ))}

      {/* Central stimulus */}
      {centralStim && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "25vmin",
            height: "25vmin",
            background: centralStim.color,
            border: "4px solid #fff",
            borderRadius: 16,
            transform: "translate(-50%, -50%)",
            zIndex: 5,
          }}
        />
      )}

      {/* Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 16,
          color: "#fff",
        }}
      >
        {!running ? (
          <button
            onClick={start}
            style={{
              background: "#fff",
              color: "#000",
              borderRadius: 8,
              padding: "8px 16px",
              border: "none",
            }}
          >
            Start
          </button>
        ) : (
          <button
            onClick={stop}
            style={{
              background: "#fff",
              color: "#000",
              borderRadius: 8,
              padding: "8px 16px",
              border: "none",
            }}
          >
            Stop
          </button>
        )}
        <div>Hits: {hitsRef.current}</div>
        <div>Errors: {errorsRef.current}</div>
        <div>
          Trial: {trialCount}/{TOTAL_TRIALS}
        </div>
      </div>
    </div>
  );
}
