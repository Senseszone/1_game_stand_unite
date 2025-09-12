// src/components/ColorReactionGame.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Go/No-Go (green = GO, red = NO-GO)
 * - 10x10 grid
 * - 1–3 současných podnětů
 * - náhodná doba zobrazení 500–1500 ms
 * - počáteční reakční limit 800 ms (adaptivně se mění)
 * - 50 podnětů celkem (každý podnět = 1 zobrazený čtverec)
 * Loguje:
 * - Reaction_Time_List (jen pro správné zásahy zelených)
 * - Miss log (zmeškané zelené)
 * - Errors (klik na červený / mimo GO okno)
 * - Accuracy, Distance_Error (px) pro zelené zásahy
 * - Adaptivní křivku (vývoj reactionWindowMs)
 */
export default function ColorReactionGame({ sessionId, taskId, emitEvent, emitScore }) {
  const GRID_SIZE = 10;
  const MAX_ACTIVE = 3;
  const TOTAL_STIMULI = 50;

  const [running, setRunning] = useState(false);
  const [gridSizePx] = useState(() => ({ gap: 4 })); // pro budoucí škálování

  // stimuly ve hře [{id, idx, color:'green'|'red', shownAt, expiresAt, timeoutId}]
  const [stimuli, setStimuli] = useState([]);
  const totalShownRef = useRef(0);

  // metriky
  const reactionWindowMsRef = useRef(800);      // adaptivní limit na reakci
  const displayMinMsRef = useRef(500);
  const displayMaxMsRef = useRef(1500);

  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  const missesRef = useRef(0);

  const reactionListRef = useRef([]);           // jen zelené správné hity
  const distanceListRef = useRef([]);           // px pro zelené hity
  const adaptHistoryRef = useRef([800]);        // vývoj limitu

  const startTsRef = useRef(null);
  const stageRef = useRef(null);
  const lastPlacedIdxRef = useRef(null);

  // helpers
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const nowMs = () => Date.now();

  const idxToRowCol = (idx) => ({ row: Math.floor(idx / GRID_SIZE), col: idx % GRID_SIZE });
  const rowColToIdx = (row, col) => row * GRID_SIZE + col;

  const pickIndex = useCallback(() => {
    // 50 % blízko posledního, 50 % úplně jinde
    const near = Math.random() < 0.5 && lastPlacedIdxRef.current !== null;
    if (!near || lastPlacedIdxRef.current === null) {
      return randInt(0, GRID_SIZE * GRID_SIZE - 1);
    }
    const { row, col } = idxToRowCol(lastPlacedIdxRef.current);
    const nr = Math.max(0, Math.min(GRID_SIZE - 1, row + randInt(-2, 2)));
    const nc = Math.max(0, Math.min(GRID_SIZE - 1, col + randInt(-2, 2)));
    return rowColToIdx(nr, nc);
  }, []);

  const spawnStimulus = useCallback(() => {
    if (totalShownRef.current >= TOTAL_STIMULI) return;
    const color = Math.random() < 0.6 ? "green" : "red"; // víc GO než NO-GO
    const idx = pickIndex();
    lastPlacedIdxRef.current = idx;

    const shownAt = nowMs();
    const displayDur = randInt(displayMinMsRef.current, displayMaxMsRef.current);
    const expiresAt = shownAt + displayDur;

    const id = `${shownAt}-${Math.random().toString(36).slice(2, 8)}`;

    const timeoutId = window.setTimeout(() => {
      setStimuli((prev) => {
        const stim = prev.find((s) => s.id === id);
        if (!stim) return prev;
        // vypršel
        // pokud byl zelený a nebyl zasažen → miss
        if (stim.color === "green") {
          missesRef.current += 1;
          emitEvent?.({
            type: "MISS",
            ts: nowMs(),
            data: { idx: stim.idx, color: "green", reason: "timeout" },
          });
        }
        const next = prev.filter((s) => s.id !== id);
        // doplň další, pokud je prostor a stále běží
        if (running && totalShownRef.current < TOTAL_STIMULI) {
          queueSpawn(); // postupně udržujeme aktivních do MAX_ACTIVE
        }
        // pokud skončily všechny a už jsme ukázali 50, ukonči
        if (totalShownRef.current >= TOTAL_STIMULI && next.length === 0) {
          stop();
        }
        return next;
      });
    }, displayDur);

    const newStim = { id, idx, color, shownAt, expiresAt, timeoutId };
    setStimuli((prev) => [...prev, newStim]);
    totalShownRef.current += 1;
    emitEvent?.({ type: "STIMULUS", ts: shownAt, data: { id, idx, color, displayMs: displayDur } });
  }, [pickIndex, running]); // eslint-disable-line

  const queueSpawn = useCallback(() => {
    // spawnuj s krátkým rozptylem, aby nevznikly "vlaky"
    const jitter = randInt(30, 120);
    window.setTimeout(() => {
      setStimuli((prev) => {
        if (!running) return prev;
        if (prev.length >= MAX_ACTIVE) return prev;
        if (totalShownRef.current >= TOTAL_STIMULI) return prev;
        // skutečné spawnování mimo setState kvůli sdílení logiky
        spawnStimulus();
        return prev;
      });
    }, jitter);
  }, [spawnStimulus, running]); // eslint-disable-line

  const clearAllTimeouts = useCallback(() => {
    setStimuli((prev) => {
      prev.forEach((s) => s.timeoutId && clearTimeout(s.timeoutId));
      return prev;
    });
  }, []);

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
    // inicialní nástřel
    for (let i = 0; i < MAX_ACTIVE; i++) queueSpawn();
  }, [queueSpawn, reset, sessionId, taskId, emitEvent]);

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

  // adaptivní obtížnost: po každých 8 zelených podnětech zhodnoť výkon
  const adaptDifficulty = useCallback(() => {
    const last8 = reactionListRef.current.slice(-8);
    const goodSpeed = last8.length === 8 && last8.every((ms) => ms < reactionWindowMsRef.current * 0.8);
    const lowErrors = errorsRef.current + missesRef.current < Math.max(2, Math.floor(totalShownRef.current / 15));

    if (goodSpeed && lowErrors) {
      reactionWindowMsRef.current = Math.max(400, Math.round(reactionWindowMsRef.current - 40));
    } else if (!goodSpeed && (errorsRef.current + missesRef.current) > Math.max(2, Math.floor(totalShownRef.current / 12))) {
      reactionWindowMsRef.current = Math.min(1200, Math.round(reactionWindowMsRef.current + 40));
    }
    adaptHistoryRef.current.push(reactionWindowMsRef.current);
    emitEvent?.({
      type: "ADAPT",
      ts: nowMs(),
      data: { reactionWindowMs: reactionWindowMsRef.current },
    });
  }, [emitEvent]);

  // klik na buňku
  const onCellClick = useCallback(
    (cellIdx, ev) => {
      if (!running) return;
      // najdi stimulus v dané buňce (preferuj zelený, pokud je víc)
      const activeHere = stimuli.filter((s) => s.idx === cellIdx);
      if (activeHere.length === 0) {
        // klik bez podnětu = chyba?
        errorsRef.current += 1;
        emitEvent?.({ type: "ERROR_EMPTY", ts: nowMs(), data: { idx: cellIdx } });
        return;
      }
      const greenFirst = activeHere.find((s) => s.color === "green") || activeHere[0];
      const stim = greenFirst;

      // spočti reaction time proti zobrazení stimulu
      const rt = Math.round(performance.now() - (stim._perfShownAt || performance.now()));
      const withinWindow = nowMs() - stim.shownAt <= reactionWindowMsRef.current;

      // spočti vzdálenost od středu
      const stage = stageRef.current;
      let distPx = 0;
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

      // vyhodnocení
      if (stim.color === "green" && withinWindow) {
        hitsRef.current += 1;
        reactionListRef.current.push(rt);
        distanceListRef.current.push(Math.round(distPx));
        emitEvent?.({
          type: "HIT",
          ts: nowMs(),
          data: { idx: stim.idx, color: "green", reactionMs: rt, distancePx: Math.round(distPx) },
        });
      } else {
        // klik na červený, nebo pozdě po zeleném
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

      // zruš timeout a odstraň kliknutý stimulus (pouze ten jeden)
      clearTimeout(stim.timeoutId);
      setStimuli((prev) => {
        const next = prev.filter((s) => s.id !== stim.id);
        // doplň další, pokud je prostor
        if (running && totalShownRef.current < TOTAL_STIMULI) queueSpawn();
        // pokud konec
        if (totalShownRef.current >= TOTAL_STIMULI && next.length === 0) {
          stop();
        }
        return next;
      });

      // lehké průběžné ladění obtížnosti
      if ((hitsRef.current + errorsRef.current + missesRef.current) % 8 === 0) {
        adaptDifficulty();
      }
    },
    [running, stimuli, adaptDifficulty, stop, queueSpawn, emitEvent]
  );

  // označ stimulu performance čas po mountu do gridu (pro přesnější RT)
  useEffect(() => {
    setStimuli((prev) =>
      prev.map((s) => (s._perfShownAt ? s : { ...s, _perfShownAt: performance.now() }))
    );
  }, [stimuli.length]);

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  return (
    <div
      ref={stageRef}
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
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          gap: gridSizePx.gap,
          background: "#0D2B55",
          borderRadius: 12,
          padding: 8,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const here = stimuli.filter((s) => s.idx === idx);
          // pokud je více, zobraz nejvyšší prioritu: green před red
          const show = here.find((s) => s.color === "green") || here[0] || null;
          const bg = show ? (show.color === "green" ? "#4ADE80" : "#F87171") : "#fff";
          const border = show ? (show.color === "green" ? "2px solid #065F46" : "2px solid #7F1D1D") : "2px solid #D50032";

          return (
            <button
              key={idx}
              id={`cell-${idx}`}
              onClick={(ev) => onCellClick(idx, ev)}
              disabled={!running}
              style={{
                border,
                background: bg,
                borderRadius: 8,
                cursor: running ? "pointer" : "default",
                userSelect: "none",
              }}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        Zelený = kliknout rychle, červený = neklikat. Celkem {TOTAL_STIMULI} podnětů. Doba zobrazení 500–1500 ms,
        reakční limit adaptivní.
      </div>
    </div>
  );
}
