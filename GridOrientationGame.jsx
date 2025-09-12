// src/components/GridOrientationGame.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

export default function GridOrientationGame({ sessionId, taskId, emitEvent, emitScore }) {
  const [running, setRunning] = useState(false);
  const [grid, setGrid] = useState([]); // stav čtverců (rozsvíceno/není)
  const [errors, setErrors] = useState(0);
  const [outsideTouches, setOutsideTouches] = useState(0);

  const startTs = useRef(null);
  const lastClickTs = useRef(null);
  const reactionList = useRef([]);
  const sequenceLog = useRef([]);

  // inicializace mřížky 10x10
  const initGrid = useCallback(() => {
    const cells = Array.from({ length: 100 }, () => false); // false = zhasnutý
    setGrid(cells);
  }, []);

  // reset hry
  const reset = useCallback(() => {
    initGrid();
    setErrors(0);
    setOutsideTouches(0);
    reactionList.current = [];
    sequenceLog.current = [];
    startTs.current = null;
    lastClickTs.current = null;
  }, [initGrid]);

  // spuštění hry
  const start = useCallback(() => {
    reset();
    setRunning(true);
    const now = Date.now();
    startTs.current = now;
    lastClickTs.current = now;

    emitEvent({
      type: "START",
      ts: now,
      data: { sessionId, taskId },
    });

    // automatické zastavení po 60s
    setTimeout(() => {
      stop();
    }, 60000);
  }, [reset, emitEvent, sessionId, taskId]);

  // ukončení hry
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
        touched: grid.filter((g) => g).length,
        errors,
        outsideTouches,
        avgReactionMs: avg,
        bestReactionMs: best,
      },
    });

    emitScore({
      taskId,
      durationMs,
      metrics: {
        completionTimeSec: Math.round((durationMs / 1000) * 100) / 100,
        reactionTimeAvgMs: avg,
        reactionTimeBestMs: best,
        touches: grid.filter((g) => g).length,
        errors,
        outsideTouches,
        accuracyPct:
          grid.filter((g) => g).length + errors > 0
            ? Math.round(
                (grid.filter((g) => g).length /
                  (grid.filter((g) => g).length + errors)) *
                  100
              )
            : 100,
      },
      details: {
        reactionTimeListMs: reactionList.current,
        sequenceLog: sequenceLog.current,
      },
    });
  }, [errors, outsideTouches, grid, emitEvent, emitScore, taskId]);

  // klik na čtverec
  const handleClick = useCallback(
    (idx, ev) => {
      if (!running) return;

      const now = performance.now();
      const rt = lastClickTs.current ? Math.round(now - lastClickTs.current) : 0;
      lastClickTs.current = now;

      if (grid[idx]) {
        // už byl rozsvícený
        setErrors((e) => e + 1);
        emitEvent({
          type: "ERROR_REPEAT",
          ts: Date.now(),
          data: { idx },
        });
        return;
      }

      const newGrid = [...grid];
      newGrid[idx] = true;
      setGrid(newGrid);

      // logování pořadí
      sequenceLog.current.push({
        idx,
        row: Math.floor(idx / 10),
        col: idx % 10,
        ts: Date.now(),
        reactionMs: rt,
      });

      if (rt > 0) reactionList.current.push(rt);

      emitEvent({
        type: "HIT",
        ts: Date.now(),
        data: { idx, row: Math.floor(idx / 10), col: idx % 10, reactionMs: rt },
      });
    },
    [running, grid, emitEvent]
  );

  // klik mimo mřížku
  const handleOutsideClick = useCallback(
    (e) => {
      if (!running) return;
      if (!e.target.closest(".grid-cell")) {
        setOutsideTouches((o) => o + 1);
        emitEvent({
          type: "MISS_OUTSIDE",
          ts: Date.now(),
        });
      }
    },
    [running, emitEvent]
  );

  useEffect(() => {
    initGrid();
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [initGrid, handleOutsideClick]);

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
        <div style={{ fontSize: 20, fontWeight: 600 }}>
          Task 3 – Vizuo-motorická orientace
        </div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          session: {sessionId || "–"} · task: {taskId}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        {!running ? (
          <button onClick={start} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Start (1 min)
          </button>
        ) : (
          <button onClick={stop} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Stop
          </button>
        )}
        <div>Rozsvíceno: {grid.filter((g) => g).length}</div>
        <div>Chyby: {errors}</div>
        <div>Mimo: {outsideTouches}</div>
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
        {grid.map((isOn, idx) => (
          <button
            key={idx}
            className="grid-cell"
            onClick={(ev) => handleClick(idx, ev)}
            style={{
              background: isOn ? "#4ADE80" : "#fff",
              border: "2px solid #D50032",
              borderRadius: 8,
              cursor: running ? "pointer" : "default",
            }}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Dotkněte se co nejvíce čtverců během 1 minuty. Vyhýbejte se opakovaným a mimo mřížku.
      </div>
    </div>
  );
}
