// src/components/ColorReactionGame.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * ColorReactionGame – Go/No-Go
 * Zelený = klikni (GO), Červený = neklikej (NO-GO)
 * - 10×10 grid
 * - 50 stimulů (1 aktivní v čase)
 * - Náhodná doba zobrazení 500–1500 ms
 * - Adaptivní reakční limit (počáteční 800 ms)
 * - Loguje zásahy, chyby, missy, reakční časy a vzdálenosti
 */
export default function ColorReactionGame({ sessionId, taskId, emitEvent, emitScore }) {
  const GRID_SIZE = 10;
  const MAX_ACTIVE = 1;
  const TOTAL_STIMULI = 50;

  const [running, setRunning] = useState(false);
  const [stimuli, setStimuli] = useState([]);
  const [gridSizePx] = useState({ gap: 4 });

  // refs
  const totalShownRef = useRef(0);
  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  const missesRef = useRef(0);
  const reactionListRef = useRef([]);
  const distanceListRef = useRef([]);
  const adaptHistoryRef = useRef([800]);
  const reactionWindowMsRef = useRef(800);
  const displayMinMsRef = useRef(500);
  const displayMaxMsRef = useRef(1500);
  const startTsRef = useRef(null);
  const lastPlacedIdxRef = useRef(null);
  const stageRef = useRef(null);

  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const nowMs = () => Date.now();

  const idxToRowCol = (idx) => ({ row: Math.floor(idx / GRID_SIZE), col: idx % GRID_SIZE });
  const rowColToIdx = (r, c) => r * GRID_SIZE + c;

  const clearAllTimeouts = useCallback(() => {
    setStimuli((prev) => {
      prev.forEach((s) => s.timeoutId && clearTimeout(s.timeoutId));
      return [];
    });
  }, []);

  const pickIndex = useCallback(() => {
    const near = Math.random() < 0.5 && lastPlacedIdxRef.current !== null;
    if (!near || lastPlacedIdxRef.current === null) {
      return randInt(0, GRID_SIZE * GRID_SIZE - 1);
    }
    const { row, col } = idxToRowCol(lastPlacedIdxRef.current);
    const nr = Math.max(0, Math.min(GRID_SIZE - 1, row + randInt(-2, 2)));
    const nc = Math.max(0, Math.min(GRID_SIZE - 1, col + randInt(-2, 2)));
    return rowColToIdx(nr, nc);
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
    clearAllTimeouts();

    const end = nowMs();
    const durationMs = startTsRef.current ? end - startTsRef.current : 0;
    const rtList = reactionListRef.current;
    const avg = rtList.length ? Math.round(rtList.reduce((a, b) => a + b, 0) / rtList.length) : 0;
    const best = rtList.length ? Math.min(...rtList) : 0;

    const hits = hitsRef.current;
    const errors = errorsRef.current;
    const misses = missesRef.current;
    const attempts = hits + errors + misses;
    const accuracyPct = attempts ? Math.round((hits / attempts) * 100) : 100;

    emitEvent?.({
      type: "END",
      ts: end,
      data: { hits, errors, misses, avgReactionMs: avg, bestReactionMs: best, accuracyPct },
    });

    emitScore?.({
      taskId,
      durationMs,
      metrics: {
        completionTimeSec: Math.round((durationMs / 1000) * 100) / 100,
        reactionTimeAvgMs: avg,
        reactionTimeBestMs: best,
        reactionsCount: rtList.length,
        errors,
        misses,
        hits,
        accuracyPct,
      },
      details: {
        reactionTimeListMs: rtList,
        distanceErrorPxList: distanceListRef.current,
        reactionWindowHistoryMs: adaptHistoryRef.current,
        totalStimuli: totalShownRef.current,
      },
    });
  }, [emitEvent, emitScore, taskId, clearAllTimeouts]);

  const adaptDifficulty = useCallback(() => {
    const recentHits = reactionListRef.current.slice(-10);
    const avgRecent = recentHits.length
      ? recentHits.reduce((a, b) => a + b, 0) / recentHits.length
      : reactionWindowMsRef.current;

    const missRate = missesRef.current / Math.max(1, totalShownRef.current);
    const errorRate = errorsRef.current / Math.max(1, totalShownRef.current);
    const targetWindow = Math.max(400, Math.round(avgRecent * 0.9));

    if (missRate < 0.05 && errorRate < 0.05 && avgRecent < reactionWindowMsRef.current) {
      reactionWindowMsRef.current = Math.max(400, targetWindow);
    } else if (missRate > 0.15 || errorRate > 0.15) {
      reactionWindowMsRef.current = Math.min(1200, Math.round(reactionWindowMsRef.current * 1.1));
    }

    adaptHistoryRef.current.push(reactionWindowMsRef.current);
    emitEvent?.({
      type: "ADAPT",
      ts: nowMs(),
      data: { reactionWindowMs: reactionWindowMsRef.current },
    });
  }, [emitEvent]);

  const spawnStimulus = useCallback(() => {
    if (totalShownRef.current >= TOTAL_STIMULI) return;
    const color = Math.random() < 0.6 ? "green" : "red";
    const idx = pickIndex();
    lastPlacedIdxRef.current = idx;

    const shownAt = nowMs();
    const displayDur = randInt(displayMinMsRef.current, displayMaxMsRef.current);
    const expiresAt = shownAt + displayDur;
    const id = `${shownAt}-${Math.random().toString(36).slice(2, 8)}`;

    const timeoutId = setTimeout(() => {
      setStimuli((prev) => {
        const stim = prev.find((s) => s.id === id);
        if (!stim) return prev;
        if (stim.color === "green") {
          missesRef.current += 1;
          emitEvent?.({ type: "MISS", ts: nowMs(), data: { idx: stim.idx, color: "green" } });
        }
        const next = prev.filter((s) => s.id !== id);
        if (running && totalShownRef.current < TOTAL_STIMULI) queueSpawn();
        if (totalShownRef.current >= TOTAL_STIMULI && next.length === 0) stop();
        return next;
      });
    }, displayDur);

    const newStim = { id, idx, color, shownAt, expiresAt, timeoutId };
    setStimuli((prev) => [...prev, newStim]);
    totalShownRef.current += 1;

    emitEvent?.({ type: "STIMULUS", ts: shownAt, data: { id, idx, color, displayMs: displayDur } });
  }, [pickIndex, emitEvent, stop]);

  const queueSpawn = useCallback(() => {
    const jitter = randInt(30, 120);
    setTimeout(() => {
      setStimuli((prev) => {
        if (!running) return prev;
        if (prev.length >= MAX_ACTIVE) return prev;
        if (totalShownRef.current >= TOTAL_STIMULI) return prev;
        spawnStimulus();
        return prev;
      });
    }, jitter);
  }, [spawnStimulus, running]);

  const reset = useCallback(() => {
    clearAllTimeouts();
    setStimuli([]);
    totalShownRef.current = 0;
    hitsRef.current = 0;
    errorsRef.current = 0;
    missesRef.current = 0;
    reactionListRef.current = [];
    distanceListRef.current = [];
    reactionWindowMsRef.current = 800;
    adaptHistoryRef.current = [800];
    startTsRef.current = null;
    lastPlacedIdxRef.current = null;
  }, [clearAllTimeouts]);

  const start = useCallback(() => {
    reset();
    setRunning(true);
    const ts = nowMs();
    startTsRef.current = ts;
    emitEvent?.({ type: "START", ts, data: { sessionId, taskId } });
    for (let i = 0; i < MAX_ACTIVE; i++) queueSpawn();
  }, [queueSpawn, reset, sessionId, taskId, emitEvent]);

  const onCellClick = useCallback(
    (cellIdx, ev) => {
      if (!running) return;
      const activeHere = stimuli.filter((s) => s.idx === cellIdx);
      if (activeHere.length === 0) {
        errorsRef.current += 1;
        emitEvent?.({ type: "ERROR_EMPTY", ts: nowMs(), data: { idx: cellIdx } });
        return;
      }
      const stim = activeHere.find((s) => s.color === "green") || activeHere[0];
      const rt = Math.round(nowMs() - stim.shownAt);
      const withinWindow = nowMs() - stim.shownAt <= reactionWindowMsRef.current;

      let distPx = 0;
      const stage = stageRef.current;
      if (stage) {
        const rectStage = stage.getBoundingClientRect();
        const cellEl = document.getElementById(`cell-${cellIdx}`);
        if (cellEl) {
          const r = cellEl.getBoundingClientRect();
          const targetXY = { x: r.left - rectStage.left + r.width / 2, y: r.top - rectStage.top + r.height / 2 };
          const touchXY = { x: ev.clientX - rectStage.left, y: ev.clientY - rectStage.top };
          distPx = Math.hypot(targetXY.x - touchXY.x, targetXY.y - touchXY.y);
        }
      }

      if (stim.color === "green" && withinWindow) {
        hitsRef.current += 1;
        reactionListRef.current.push(rt);
        distanceListRef.current.push(Math.round(distPx));
        emitEvent?.({ type: "HIT", ts: nowMs(), data: { idx: stim.idx, color: "green", reactionMs: rt, distancePx: Math.round(distPx) } });
        if ((hitsRef.current + errorsRef.current + missesRef.current) % 10 === 0) adaptDifficulty();
      } else {
        errorsRef.current += 1;
        emitEvent?.({
          type: "ERROR",
          ts: nowMs(),
          data: {
            idx: stim.idx,
            color: stim.color,
            reason: stim.color === "red" ? "no-go" : "late",
            reactionMs: rt,
            distancePx: Math.round(distPx),
          },
        });
      }

      clearTimeout(stim.timeoutId);
      setStimuli((prev) => {
        const next = prev.filter((s) => s.id !== stim.id);
        if (running && totalShownRef.current < TOTAL_STIMULI) queueSpawn();
        if (totalShownRef.current >= TOTAL_STIMULI && next.length === 0) stop();
        return next;
      });
    },
    [running, stimuli, adaptDifficulty, queueSpawn, stop, emitEvent]
  );

  useEffect(() => () => clearAllTimeouts(), [clearAllTimeouts]);

  return (
    <div
      ref={stageRef}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#1A4E8A",
        color: "#fff",
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 800 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Task 5 – Reakční barevná pole</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          session: {sessionId || "–"} · task: {taskId} · limit: {reactionWindowMsRef.current} ms ·
          shown: {totalShownRef.current}/{TOTAL_STIMULI}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!running ? (
          <button onClick={start} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", color: "#000", border: "none" }}>
            Start
          </button>
        ) : (
          <button onClick={stop} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", color: "#000", border: "none" }}>
            Stop
          </button>
        )}
        <div>Hits: {hitsRef.current}</div>
        <div>Errors: {errorsRef.current}</div>
        <div>Misses: {missesRef.current}</div>
      </div>

      <div
        style={{
          width: "90vmin",
          height: "90vmin",
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          gap: gridSizePx.gap,
          background: "#0D2B55",
          borderRadius: 20,
          padding: 8,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const here = stimuli.filter((s) => s.idx === idx);
          const show = here.find((s) => s.color === "green") || here[0] || null;
          const bg = show ? (show.color === "green" ? "#4ADE80" : "#F87171") : "#fff";
          const border = show
            ? show.color === "green"
              ? "2px solid #065F46"
              : "2px solid #7F1D1D"
            : "2px solid #D50032";

          return (
            <button
              key={idx}
              id={`cell-${idx}`}
              onClick={(ev) => onCellClick(idx, ev)}
              disabled={!running}
              style={{
                border,
                background: bg,
                borderRadius: 10,
                aspectRatio: "1 / 1",
                cursor: running ? "pointer" : "default",
                userSelect: "none",
              }}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
        Zelený = klikni rychle, červený = neklikej. Celkem {TOTAL_STIMULI} podnětů.
        Doba zobrazení 500–1500 ms, reakční limit se adaptivně mění.
      </div>
    </div>
  );
}
