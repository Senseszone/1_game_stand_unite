// src/components/SpamperceptionBlocks.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Spamperception Blocks – diagnostická verze
 * 4 bloky (čísla, písmena, barvy, obrazce)
 * každý blok = 10 sekvencí
 * sekvence startuje na 3 prvcích, +1 při úspěchu, -1 při chybě (meze 2–7)
 */
export default function SpamperceptionBlocks({ sessionId, taskId = "spamperception-blocks-v1", emitEvent, emitScore }) {
  const GRID = 10;
  const CELLS = GRID * GRID;

  const MODES = ["digits", "letters", "colors", "shapes"];
  const SEQS_PER_BLOCK = 10;
  const START_LEN = 3;
  const MIN_LEN = 2;
  const MAX_LEN = 7;
  const ON_MS = 600;
  const GAP_MS = 400;

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | present | respond | between
  const [blockIdx, setBlockIdx] = useState(0);
  const [trialIdx, setTrialIdx] = useState(0);
  const [seq, setSeq] = useState([]);
  const [litIdx, setLitIdx] = useState(null);
  const [replayPos, setReplayPos] = useState(0);
  const [seqLen, setSeqLen] = useState(START_LEN);

  const timersRef = useRef([]);
  const logsRef = useRef([]);
  const spanMaxRef = useRef({ digits: 0, letters: 0, colors: 0, shapes: 0 });
  const startTsRef = useRef(null);

  // pomocné funkce
  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  const randSeq = (len) => {
    const used = new Set();
    const arr = [];
    while (arr.length < len) {
      const idx = Math.floor(Math.random() * CELLS);
      if (!used.has(idx)) {
        used.add(idx);
        arr.push(idx);
      }
    }
    return arr;
  };

  // prezentace sekvence
  const presentSeq = useCallback(
    (arr) => {
      setPhase("present");
      let t = 0;
      arr.forEach((cell, i) => {
        timersRef.current.push(
          setTimeout(() => setLitIdx(cell), t)
        );
        t += ON_MS;
        timersRef.current.push(
          setTimeout(() => setLitIdx(null), t)
        );
        t += GAP_MS;
      });
      timersRef.current.push(
        setTimeout(() => {
          setPhase("respond");
          setReplayPos(0);
          emitEvent?.({ type: "SEQ_PRESENTED", ts: Date.now(), data: { block: MODES[blockIdx], len: arr.length } });
        }, t)
      );
    },
    [blockIdx, emitEvent]
  );

  // spuštění trialu
  const startTrial = useCallback(
    (len) => {
      const arr = randSeq(len);
      setSeq(arr);
      presentSeq(arr);
    },
    [presentSeq]
  );

  // vyhodnocení trialu
  const finishTrial = useCallback(
    (ok) => {
      const mode = MODES[blockIdx];
      if (ok) {
        spanMaxRef.current[mode] = Math.max(spanMaxRef.current[mode], seq.length);
      }
      // nastav novou délku
      const nextLen = Math.max(MIN_LEN, Math.min(MAX_LEN, seqLen + (ok ? 1 : -1)));
      setSeqLen(nextLen);

      if (trialIdx + 1 >= SEQS_PER_BLOCK) {
        // blok hotov
        if (blockIdx + 1 >= MODES.length) {
          // konec celé hry
          setRunning(false);
          setPhase("idle");
          emitScore?.({
            taskId,
            sessionId,
            durationMs: startTsRef.current ? Date.now() - startTsRef.current : 0,
            metrics: {
              spanMax_digits: spanMaxRef.current.digits,
              spanMax_letters: spanMaxRef.current.letters,
              spanMax_colors: spanMaxRef.current.colors,
              spanMax_shapes: spanMaxRef.current.shapes,
            },
            details: {
              logs: logsRef.current,
            },
          });
        } else {
          // přejdi na další blok
          setBlockIdx(blockIdx + 1);
          setTrialIdx(0);
          setSeqLen(START_LEN);
          setPhase("between");
          setTimeout(() => startTrial(START_LEN), 800);
        }
      } else {
        // další trial
        setTrialIdx(trialIdx + 1);
        setPhase("between");
        setTimeout(() => startTrial(nextLen), 600);
      }
    },
    [blockIdx, trialIdx, seqLen, seq, taskId, sessionId, emitScore, startTrial]
  );

  const onCellClick = (idx) => {
    if (phase !== "respond") return;
    const expected = seq[replayPos];
    const correct = idx === expected;
    logsRef.current.push({
      ts: Date.now(),
      block: MODES[blockIdx],
      trial: trialIdx + 1,
      pos: replayPos,
      expected,
      clicked: idx,
      correct,
    });
    if (correct) {
      if (replayPos + 1 >= seq.length) {
        emitEvent?.({ type: "RESP_OK", ts: Date.now(), data: { block: MODES[blockIdx], len: seq.length } });
        finishTrial(true);
      } else {
        setReplayPos(replayPos + 1);
      }
    } else {
      emitEvent?.({ type: "RESP_ERR", ts: Date.now(), data: { block: MODES[blockIdx], pos: replayPos } });
      finishTrial(false);
    }
  };

  // start/stop
  const start = () => {
    clearTimers();
    logsRef.current = [];
    spanMaxRef.current = { digits: 0, letters: 0, colors: 0, shapes: 0 };
    setRunning(true);
    setBlockIdx(0);
    setTrialIdx(0);
    setSeqLen(START_LEN);
    setPhase("between");
    startTsRef.current = Date.now();
    emitEvent?.({ type: "START", ts: startTsRef.current, data: { sessionId, taskId } });
    setTimeout(() => startTrial(START_LEN), 500);
  };

  const stop = () => {
    clearTimers();
    setRunning(false);
    setPhase("idle");
    emitEvent?.({ type: "STOP", ts: Date.now() });
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#1A4E8A", color: "#fff", padding: 16, gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Spamperception Blocks</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          session: {sessionId || "–"} · block: {blockIdx + 1}/{MODES.length} ({MODES[blockIdx]})
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!running ? (
          <button onClick={start} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", color: "#000" }}>Start</button>
        ) : (
          <button onClick={stop} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", color: "#000" }}>Stop</button>
        )}
        <div>Trial {trialIdx + 1}/{SEQS_PER_BLOCK}</div>
        <div>Length {seqLen}</div>
      </div>

      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: `repeat(${GRID}, 1fr)`,
        gridTemplateRows: `repeat(${GRID}, 1fr)`,
        gap: 4,
        background: "#0D2B55",
        borderRadius: 12,
        padding: 8,
      }}>
        {Array.from({ length: CELLS }, (_, i) => (
          <button
            key={i}
            onClick={() => onCellClick(i)}
            style={{
              border: "1px solid #333",
              background: litIdx === i ? "#F87171" : "#fff",
              borderRadius: 6,
              cursor: phase === "respond" ? "pointer" : "default",
            }}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        V každém bloku se zobrazí 10 sekvencí. Správná reprodukce → delší sekvence, chyba → kratší sekvence.  
      </div>
    </div>
  );
}
