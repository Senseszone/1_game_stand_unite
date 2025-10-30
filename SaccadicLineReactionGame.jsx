// src/components/SaccadicLineReactionGame.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * SaccadicLineReactionGame
 * - Bod se pohybuje po řádku (zleva doprava, pak zprava doleva)
 * - Na každém řádku 3× krátce rozsvítí zeleně (1/3, 2/3, konec)
 * - Hráč klikne při rozsvícení
 * - Po kliknutí skočí na další řádek a rychlost se adaptuje podle výkonu
 */

export default function SaccadicLineReactionGame({ sessionId, taskId, emitEvent, emitScore }) {
  const [running, setRunning] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState("white");
  const [line, setLine] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = doprava, -1 = doleva
  const [highlightIndex, setHighlightIndex] = useState(0);

  const animationRef = useRef(null);
  const lastFrameRef = useRef(performance.now());
  const startTsRef = useRef(null);
  const colorOnRef = useRef(false);
  const colorChangeTsRef = useRef(0);
  const reactionTimesRef = useRef([]);

  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  const speedRef = useRef(400); // px/s
  const SPEED_MIN = 250;
  const SPEED_MAX = 900;
  const GRID_GAP = 100;
  const TOTAL_LINES = 6;
  const HIGHLIGHT_COUNT = 3;

  const screenW = typeof window !== "undefined" ? window.innerWidth : 1200;

  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const nowMs = () => Date.now();

  // určuje polohu bodu (pohyb)
  const animate = useCallback(
    (ts) => {
      if (!running) return;
      const delta = (ts - lastFrameRef.current) / 1000;
      lastFrameRef.current = ts;

      setPos((prev) => {
        let newX = prev.x + direction * speedRef.current * delta;
        let newY = line * GRID_GAP;

        // změna směru na konci
        if (direction === 1 && newX >= screenW - 40) {
          newX = screenW - 40;
          triggerNextLine();
        } else if (direction === -1 && newX <= 0) {
          newX = 0;
          triggerNextLine();
        }

        // aktivuj zelené momenty v přesných 3 pozicích
        const thresholds = [0.33, 0.66, 0.95].map((f) => f * (screenW - 40));
        const idx = thresholds.findIndex((t, i) => {
          const prevT = i === 0 ? 0 : thresholds[i - 1];
          return direction === 1
            ? prev.x < t && newX >= t
            : prev.x > screenW - t && newX <= screenW - t;
        });
        if (idx !== -1 && !colorOnRef.current) triggerHighlight();

        return { x: newX, y: newY };
      });

      animationRef.current = requestAnimationFrame(animate);
    },
    [running, direction, line]
  );

  // vyvolá zelený flash
  const triggerHighlight = () => {
    colorOnRef.current = true;
    setColor("lime");
    colorChangeTsRef.current = performance.now();
    setTimeout(() => {
      colorOnRef.current = false;
      setColor("white");
    }, 400);
  };

  // přeskočí na další řádek
  const triggerNextLine = () => {
    cancelAnimationFrame(animationRef.current);
    setHighlightIndex(0);
    setLine((l) => l + 1);
    setDirection((d) => -d);

    if (line + 1 >= TOTAL_LINES) {
      stop();
      return;
    }

    setTimeout(() => {
      lastFrameRef.current = performance.now();
      animationRef.current = requestAnimationFrame(animate);
    }, 400);
  };

  // klik hráče
  const onClick = () => {
    if (!running) return;
    if (colorOnRef.current) {
      const rt = Math.round(performance.now() - colorChangeTsRef.current);
      reactionTimesRef.current.push(rt);
      hitsRef.current += 1;
      emitEvent?.({ type: "HIT", ts: nowMs(), data: { reactionMs: rt, line } });
      adaptSpeed(rt);
      setColor("green");
      setTimeout(() => setColor("white"), 150);
    } else {
      errorsRef.current += 1;
      emitEvent?.({ type: "ERROR", ts: nowMs(), data: { line } });
      adaptSpeed(999);
    }
  };

  // adaptivní změna rychlosti podle reakce
  const adaptSpeed = (rt) => {
    if (rt < 300) speedRef.current = Math.min(SPEED_MAX, speedRef.current + 40);
    else if (rt > 600) speedRef.current = Math.max(SPEED_MIN, speedRef.current - 40);
  };

  const start = () => {
    hitsRef.current = 0;
    errorsRef.current = 0;
    reactionTimesRef.current = [];
    setRunning(true);
    setLine(0);
    setDirection(1);
    setPos({ x: 0, y: 0 });
    setColor("white");
    lastFrameRef.current = performance.now();
    startTsRef.current = nowMs();
    emitEvent?.({ type: "START", ts: nowMs(), data: { sessionId, taskId } });
    animationRef.current = requestAnimationFrame(animate);
  };

  const stop = () => {
    cancelAnimationFrame(animationRef.current);
    setRunning(false);
    const avg =
      reactionTimesRef.current.length > 0
        ? Math.round(
            reactionTimesRef.current.reduce((a, b) => a + b, 0) / reactionTimesRef.current.length
          )
        : 0;

    emitScore?.({
      taskId,
      metrics: {
        hits: hitsRef.current,
        errors: errorsRef.current,
        avgReactionMs: avg,
        totalLines: line,
        finalSpeed: speedRef.current,
      },
    });

    emitEvent?.({
      type: "END",
      ts: nowMs(),
      data: { hits: hitsRef.current, errors: errorsRef.current, avgReactionMs: avg },
    });
  };

  useEffect(() => () => cancelAnimationFrame(animationRef.current), []);

  return (
    <div
      onClick={onClick}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0D2B55",
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {/* pohybující se bod */}
      <div
        style={{
          position: "absolute",
          top: `${pos.y}px`,
          left: `${pos.x}px`,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: color,
          border: "3px solid #fff",
          transform: "translateY(-50%)",
          transition: "background 0.2s",
        }}
      />

      {/* ovládací panel */}
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
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#fff",
            }}
          >
            Start
          </button>
        ) : (
          <button
            onClick={stop}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#fff",
            }}
          >
            Stop
          </button>
        )}
        <div>Line: {line + 1}</div>
        <div>Hits: {hitsRef.current}</div>
        <div>Errors: {errorsRef.current}</div>
        <div>Speed: {Math.round(speedRef.current)} px/s</div>
      </div>
    </div>
  );
}
