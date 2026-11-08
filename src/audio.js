// Ovoz: ijro + lab harakati (lip-sync) va mikrofondan yozib olish

export class Voice {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.source = null;
  }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  stop() {
    try { this.source?.stop(); } catch {}
    this.source = null;
  }

  async play(arrayBuffer, onStart) {
    this.stop();
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      src.onended = () => { if (this.source === src) this.source = null; resolve(); };
      this.source = src;
      src.start();
      onStart?.(buf.duration);
    });
  }

  get playing() { return !!this.source; }

  // Spektr bo'yicha unli tovushlarga taxminiy moslash
  lipSync() {
    if (!this.source) return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.analyser.getByteFrequencyData(this.freq);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (a, b) => {
      let s = 0, n = 0;
      for (let i = Math.floor(a / hz); i < Math.floor(b / hz); i++) { s += this.freq[i]; n++; }
      return n ? s / n / 255 : 0;
    };
    const low = band(150, 700), mid = band(700, 1600), high = band(1600, 4000);
    const vol = Math.min(1, Math.max(0, (low + mid + high) / 3 * 2.4 - 0.08));
    if (vol < 0.03) return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    const tot = low + mid + high + 1e-5;
    const l = low / tot, m = mid / tot, h = high / tot;
    return {
      aa: vol * Math.min(1, m * 1.6 + 0.15),
      oh: vol * Math.max(0, l - 0.45) * 1.6,
      ou: vol * Math.max(0, l - 0.55) * 1.2,
      ee: vol * Math.max(0, h - 0.3) * 1.5,
      ih: vol * Math.max(0, h - 0.25) * 0.8,
    };
  }
}

// Mikrofon -> 16 kHz WAV (base64)
const WORKLET = `
class Rec extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('rec', Rec);`;

export class Recorder {
  constructor(ctx) { this.ctx = ctx; this.chunks = []; this.level = 0; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!this.loaded) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.loaded = true;
    }
    this.chunks = [];
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'rec');
    this.node.port.onmessage = (e) => {
      this.chunks.push(e.data);
      let s = 0; for (const v of e.data) s += v * v;
      this.level = Math.sqrt(s / e.data.length);
    };
    this.src.connect(this.node);
  }

  stop() {
    this.src?.disconnect(); this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.level = 0;
    const len = this.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(len);
    let o = 0; for (const c of this.chunks) { all.set(c, o); o += c.length; }
    const duration = len / this.ctx.sampleRate;
    return { base64: toWav16k(all, this.ctx.sampleRate), duration };
  }
}

function toWav16k(data, rate) {
  const target = 16000, ratio = rate / target;
  const n = Math.floor(data.length / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[Math.floor(i * ratio)]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, target, true); dv.setUint32(28, target * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
