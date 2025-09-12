// src/components/SaccadicGame.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

export default function SaccadicGame({ sessionId, taskId, emitEvent, emitScore }) {
  const [running, setRunning] = useState(false);
  const [stimulus, setStimulus] = useState(null); // číslo 0–9
  const [grid, setGrid] = useState([]); // 10x10
  const [errors, setErrors] = useState(0);
  const [hits, setHits] = useState(0);

  const startTs = useRef(null);
  const lastStimulusTime = useRef(null);
  const reactionList = useRef([]);

  // vytvoření prázdné mřížky 10x10
  const initGrid = useCallback(() => {
    const cells = Array.from({ length: 100 }, () => null);
    setGrid(cells);
  }, []);

  // nový podnět
  const spawnStimulus = useCallback(() => {
    const cells = Array.from({ length: 100 }, () => null);
    const idx = Math.floor(Math.random() * 100);
    const num = Math.floor(Math.random() * 10);
    cells[idx] = num;
    setGrid(cells);
    setStimulus(num);
    lastStimulusTime.current = performance.now();
  }, []);

  const reset = useCallback(() => {
    initGrid();
    setStimulus(null);
    setErrors(0);
    setHits(0);
    reactionList.current = [];
  }, [initGrid]);

  const start = useCallback(() => {
    reset();
    setRunning(true);
    const now = Date.now();
    startTs.current = now;
    emitEvent({
      type: "START",
      ts: now,
      data: { sessionId, taskId },
    });
    spawnStimulus();
  }, [reset, spawnStimulus, emitEvent, sessionId, taskId]);

  const stop = useCallback(() => {
    setRunning(false);
    const end = Date.now();
    const durationMs = startTs.current ? end - startTs.current : 0;

    const avg = reactionList.current.length
      ? Math.round(reactionList.current.reduce((a, b) => a + b, 0) / reactionList.current.length)
      : 0;
    const best = reactionList.current.length ? Math.min(...reactionList.current) : 0;

    emitEvent({
      type: "END",
      ts: end,
      data: {
        errors,
        hits,
        avgReactionMs: avg,
        bestReactionMs: best,
        accuracyPct: hits + errors > 0 ? Math.round((hits / (hits + errors)) * 100) : 100,
      },
    });

    emitScore({
      taskId,
      durationMs,
      metrics: {
        completionTimeSec: Math.round((durationMs / 1000) * 100) / 100,
        reactionTimeAvgMs: avg,
        reactionTimeBestMs: best,
        decisionErrors: errors,
        hits,
        accuracyPct: hits + errors > 0 ? Math.round((hits / (hits + errors)) * 100) : 100,
      },
      details: {
        reactionTimeListMs: reactionList.current,
      },
    });
  }, [errors, hits, emitEvent, emitScore, taskId]);

  const handleClick = useCallback(
    (num, idx) => {
      if (!running) return;

      const now = performance.now();
      const rt = lastStimulusTime.current ? Math.round(now - lastStimulusTime.current) : 0;

      if (num === stimulus) {
        reactionList.current.push(rt);
        setHits((h) => h + 1);
        emitEvent({
          type: "HIT",
          ts: Date.now(),
          data: { num, idx, reactionMs: rt },
        });
      } else {
        setErrors((e) => e + 1);
        emitEvent({
          type: "MISS",
          ts: Date.now(),
          data: { expected: stimulus, clicked: num, idx },
        });
      }

      spawnStimulus();
    },
    [running, stimulus, spawnStimulus, emitEvent]
  );

  useEffect(() => {
    initGrid();
  }, [initGrid]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#1A4E8A",
        color: "#fff",
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Task 2 – Sakadické pohyby</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>session: {sessionId || "–"} · task: {taskId}</div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        {!running ? (
          <button onClick={start} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Start
          </button>
        ) : (
          <button onClick={stop} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Stop
          </button>
        )}
        <div>Hits: {hits}</div>
        <div>Errors: {errors}</div>
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(10, 1fr)",
          gridTemplateRows: "repeat(10, 1fr)",
          gap: 4,
          background: "#0D2B55",
          borderRadius: 12,
          padding: 8,
        }}
      >
        {grid.map((num, idx) => (
          <button
            key={idx}
            disabled={num === null || !running}
            onClick={() => handleClick(num, idx)}
            style={{
              background: num !== null ? "#fff" : "transparent",
              border: num !== null ? "2px solid #D50032" : "none",
              borderRadius: 6,
              fontSize: 20,
              fontWeight: 700,
              cursor: num !== null && running ? "pointer" : "default",
            }}
          >
            {num !== null ? num : ""}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Klikněte na číslo na obrazovce, pokud se shoduje s číslem, které právě čtete na SensesBoardu.
      </div>
    </div>
  );
}
