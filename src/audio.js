// Ovoz: oqimli ijro (24 kHz PCM) + lip-sync, va doimiy mikrofon (16 kHz PCM) + "gapimni bo'lma" himoyasi

const SILENT = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.gain = ctx.createGain();
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.sources = new Set();
    this.nextTime = 0;
  }

  // base64 PCM16 LE bo'lagini navbatga qo'yish
  push(b64, rate = 24000) {
    const bin = atob(b64);
    const n = bin.length >> 1;
    const buf = this.ctx.createBuffer(1, n, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 0x8000;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.03) this.nextTime = now + 0.06; // kichik bufer — uzilishsiz
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  // darhol jim bo'lish (foydalanuvchi gapni bo'lganda)
  stop() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    this.nextTime = 0;
  }

  get playing() { return this.sources.size > 0; }

  lipSync() {
    if (!this.playing) return SILENT;
    this.analyser.getByteFrequencyData(this.freq);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (a, b) => {
      let s = 0, n = 0;
      for (let i = Math.floor(a / hz); i < Math.floor(b / hz); i++) { s += this.freq[i]; n++; }
      return n ? s / n / 255 : 0;
    };
    const low = band(150, 700), mid = band(700, 1600), high = band(1600, 4000);
    const vol = Math.min(1, Math.max(0, ((low + mid + high) / 3) * 2.4 - 0.08));
    if (vol < 0.03) return SILENT;
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

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('rec', Rec);`;

// Doimiy mikrofon. onChunk(base64Pcm16k) har ~100 ms da chaqiriladi.
export class Mic {
  constructor(ctx) {
    this.ctx = ctx;
    this.level = 0;
    this.muted = false;
    this.onChunk = null;
    this.ratio = ctx.sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(1600);
    this.outN = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'rec');
    this.node.port.onmessage = (e) => this.feed(e.data);
    this.src.connect(this.node);
  }

  feed(data) {
    let s = 0;
    for (const v of data) s += v * v;
    this.level = Math.sqrt(s / data.length);
    this.peak = Math.max(this.peak || 0, this.level);
    if (this.muted) return;
    // oddiy o'rtacha qiymat bilan 16 kHz ga tushirish
    const r = this.ratio;
    while (this.pos + r <= data.length) {
      let sum = 0, cnt = 0;
      for (let i = Math.max(0, Math.floor(this.pos)); i < Math.floor(this.pos + r); i++) { sum += data[i]; cnt++; }
      const v = Math.max(-1, Math.min(1, cnt ? sum / cnt : 0));
      this.out[this.outN++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.outN === this.out.length) { this.flush(); }
      this.pos += r;
    }
    this.pos -= data.length;
  }

  flush() {
    const bytes = new Uint8Array(this.out.buffer, 0, this.outN * 2);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.outN = 0;
    const peak = this.peak || 0;
    this.peak = 0;
    this.onChunk?.(btoa(bin), peak);
  }

  setMuted(m) { this.muted = m; if (m) this.level = 0; }
}
