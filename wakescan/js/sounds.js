/* WakeScan — alarm sound engine.
   All sounds are synthesized with Web Audio so the app needs no audio
   files and works fully offline. Each sound defines a short pattern that
   is scheduled on a loop with a small lookahead. */
(function () {
  'use strict';

  let ctx = null;

  function audioCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /* Schedule one enveloped tone. Quick attack/release avoids clicks. */
  function tone(ac, dest, { type = 'sine', freq = 880, t, dur = 0.12, vol = 0.5, glideTo = null }) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.setValueAtTime(vol, t + Math.max(0.012, dur - 0.03));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    classic: {
      name: 'Classic Beep',
      desc: 'The no-nonsense digital alarm',
      loop: 1.44,
      schedule(ac, dest, t0) {
        for (let i = 0; i < 4; i++) {
          tone(ac, dest, { type: 'square', freq: 880, t: t0 + i * 0.24, dur: 0.12, vol: 0.32 });
        }
      },
    },
    digital: {
      name: 'Digital Pulse',
      desc: 'Fast two-tone chirps',
      loop: 1.2,
      schedule(ac, dest, t0) {
        for (let i = 0; i < 6; i++) {
          tone(ac, dest, {
            type: 'triangle',
            freq: i % 2 ? 1567.98 : 1174.66,
            t: t0 + i * 0.11,
            dur: 0.07,
            vol: 0.45,
          });
        }
      },
    },
    siren: {
      name: 'Siren',
      desc: 'Impossible to sleep through',
      loop: 1.1,
      schedule(ac, dest, t0) {
        tone(ac, dest, { type: 'sawtooth', freq: 620, glideTo: 1150, t: t0, dur: 0.55, vol: 0.22 });
        tone(ac, dest, { type: 'sawtooth', freq: 1150, glideTo: 620, t: t0 + 0.55, dur: 0.55, vol: 0.22 });
      },
    },
    chimes: {
      name: 'Gentle Rise',
      desc: 'Soft chimes that build up',
      loop: 3.6,
      schedule(ac, dest, t0) {
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        notes.forEach((f, i) => {
          tone(ac, dest, { type: 'sine', freq: f, t: t0 + i * 0.45, dur: 1.1, vol: 0.4 });
          tone(ac, dest, { type: 'sine', freq: f * 2, t: t0 + i * 0.45, dur: 0.8, vol: 0.08 });
        });
      },
    },
    buzzer: {
      name: 'Heavy Buzzer',
      desc: 'Brutal. For deep sleepers',
      loop: 0.9,
      schedule(ac, dest, t0) {
        for (let i = 0; i < 2; i++) {
          const t = t0 + i * 0.45;
          tone(ac, dest, { type: 'sawtooth', freq: 150, t, dur: 0.3, vol: 0.4 });
          tone(ac, dest, { type: 'square', freq: 75, t, dur: 0.3, vol: 0.3 });
        }
      },
    },
  };

  let running = null; // { timer, master, soundId, stopAt }

  function startLoop(soundId, { escalate = false, maxSeconds = null } = {}) {
    stop();
    const def = SOUNDS[soundId] || SOUNDS.classic;
    let ac;
    try {
      ac = audioCtx();
    } catch (e) { return; /* no Web Audio — vibration & visuals still run */ }
    const master = ac.createGain();
    master.connect(ac.destination);

    if (escalate) {
      // Start at a humane volume, ramp to full blast over 25 s.
      master.gain.setValueAtTime(0.4, ac.currentTime);
      master.gain.linearRampToValueAtTime(1.0, ac.currentTime + 25);
    } else {
      master.gain.setValueAtTime(0.9, ac.currentTime);
    }

    let nextT = ac.currentTime + 0.06;
    const stopAt = maxSeconds ? ac.currentTime + maxSeconds : null;

    const timer = setInterval(() => {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      while (nextT < ac.currentTime + 0.6) {
        if (stopAt && nextT >= stopAt) { stop(); return; }
        def.schedule(ac, master, nextT);
        nextT += def.loop;
      }
    }, 120);

    // Prime the first pattern immediately.
    def.schedule(ac, master, nextT);
    nextT += def.loop;

    running = { timer, master, soundId };
  }

  function stop() {
    if (!running) return;
    clearInterval(running.timer);
    try {
      running.master.gain.cancelScheduledValues(0);
      running.master.gain.setTargetAtTime(0.0001, audioCtx().currentTime, 0.04);
      const m = running.master;
      setTimeout(() => { try { m.disconnect(); } catch (e) {} }, 300);
    } catch (e) { /* context may be gone */ }
    running = null;
  }

  window.WakeSounds = {
    list: Object.keys(SOUNDS).map((id) => ({ id, name: SOUNDS[id].name, desc: SOUNDS[id].desc })),
    start: (id) => startLoop(id, { escalate: true }),
    preview: (id) => startLoop(id, { maxSeconds: 2.6 }),
    stop,
    isPlaying: () => !!running,
    playingId: () => (running ? running.soundId : null),
    /* Browsers require a user gesture before audio can play; call this
       from any tap so the context is unlocked by the time the alarm fires. */
    unlock() {
      try {
        const ac = audioCtx();
        if (ac.state === 'suspended') ac.resume().catch(() => {});
      } catch (e) { /* no audio support */ }
    },
  };
})();
