// 采样合成器：按样本位置安排 note on / off，逐块渲染立体声（离线渲染和实时播放共用）
// Sample-based synthesiser: note on / off at exact sample positions, rendered block by block in stereo
// (shared by offline rendering and real-time playback)
import type { SoundFont, VoiceSpec } from './sf2';

export interface ChannelSetup {
	program: number; // GM 音色号（从 0 数）/ GM program (0-based)
	bank?: number;
	gain?: number; // 声部音量比例 / voice level
}

interface SynthEvent {
	time: number; // 样本序号 / sample index
	order: number;
	kind: 'on' | 'off';
	ch: number;
	key: number;
	vel: number;
}

class Voice {
	readonly spec: VoiceSpec;
	readonly ch: number;
	readonly key: number;
	readonly step: number; // 每个输出样本前进多少个采样点 / sample points per output sample
	readonly gainL: number;
	readonly gainR: number;
	pos = 0; // 相对 spec.start 的位置 / position relative to spec.start
	t = 0; // 发声以来的输出样本数 / output samples since note-on
	released = false;
	releaseT = 0;
	releaseLevel = 1;
	level = 0;
	done = false;
	private readonly d: number;
	private readonly a: number;
	private readonly h: number;
	private readonly dec: number;
	private readonly rel: number;
	private readonly sustainDb: number;

	constructor(spec: VoiceSpec, ch: number, key: number, gain: number, cents: number, sr: number) {
		this.spec = spec;
		this.ch = ch;
		this.key = key;
		this.step = 2 ** (((key - spec.rootKey) * spec.scaleTuning + spec.tuneCents + cents) / 1200) * (spec.sample.rate / sr);
		const angle = ((spec.pan + 500) / 1000) * (Math.PI / 2);
		this.gainL = gain * Math.cos(angle);
		this.gainR = gain * Math.sin(angle);
		this.d = spec.delay * sr;
		this.a = Math.max(1, spec.attack * sr);
		this.h = spec.hold * sr;
		this.dec = Math.max(1, spec.decay * sr);
		this.rel = Math.max(1, spec.release * sr);
		this.sustainDb = -spec.sustainCb / 10;
	}

	// 音量包络：起音线性上升，衰减和释放按分贝直线下降（96 dB / 设定时间）
	// Volume envelope: linear attack; decay and release fall linearly in dB (96 dB over the set time)
	private envelope(): number {
		const t = this.t;
		let lv: number;
		if (t < this.d) lv = 0;
		else if (t < this.d + this.a) lv = (t - this.d) / this.a;
		else if (t < this.d + this.a + this.h) lv = 1;
		else {
			const db = Math.max((-96 * (t - this.d - this.a - this.h)) / this.dec, this.sustainDb);
			lv = 10 ** (db / 20);
		}
		if (this.released) {
			const db = (-96 * (t - this.releaseT)) / this.rel;
			lv = Math.min(lv, this.releaseLevel * 10 ** (db / 20));
			if (db < -96) this.done = true;
		}
		return lv;
	}

	release(): void {
		if (this.released) return;
		this.released = true;
		this.releaseT = this.t;
		this.releaseLevel = this.level;
	}

	render(data: Float32Array, outL: Float32Array, outR: Float32Array, from: number, to: number): void {
		const { spec } = this;
		const loopLen = spec.loopEnd - spec.loopStart;
		const loopEndRel = spec.loopEnd - spec.start;
		const endRel = spec.end - spec.start;
		for (let i = from; i < to && !this.done; i++) {
			const lv = this.envelope();
			this.level = lv;
			const ip = Math.floor(this.pos);
			const frac = this.pos - ip;
			const s0 = data[spec.start + ip];
			const s1 = data[spec.start + ip + 1] ?? s0;
			const s = (s0 + (s1 - s0) * frac) * lv;
			outL[i] += s * this.gainL;
			outR[i] += s * this.gainR;
			this.t += 1;
			this.pos += this.step;
			if (spec.loop && loopLen > 0) {
				while (this.pos >= loopEndRel) this.pos -= loopLen;
			} else if (this.pos >= endRel - 1) {
				this.done = true;
			}
		}
	}
}

// 二阶巴特沃斯低通（与 scipy.signal.butter(2, fc) 相同的双线性变换）/ 2nd-order Butterworth low-pass
class LowPass {
	private readonly b0: number;
	private readonly b1: number;
	private readonly b2: number;
	private readonly a1: number;
	private readonly a2: number;
	private z1 = 0;
	private z2 = 0;

	constructor(fc: number, sr: number) {
		const k = Math.tan((Math.PI * fc) / sr);
		const norm = 1 / (1 + Math.SQRT2 * k + k * k);
		this.b0 = k * k * norm;
		this.b1 = 2 * this.b0;
		this.b2 = this.b0;
		this.a1 = 2 * (k * k - 1) * norm;
		this.a2 = (1 - Math.SQRT2 * k + k * k) * norm;
	}

	process(x: Float32Array, from: number, to: number): void {
		for (let i = from; i < to; i++) {
			const y = this.b0 * x[i] + this.z1;
			this.z1 = this.b1 * x[i] - this.a1 * y + this.z2;
			this.z2 = this.b2 * x[i] - this.a2 * y;
			x[i] = y;
		}
	}
}

export class Synth {
	readonly sr: number;
	private readonly sf: SoundFont;
	private readonly channels: ChannelSetup[];
	private readonly events: SynthEvent[] = [];
	private voices: Voice[] = [];
	private order = 0;
	private sorted = true;
	pos = 0; // 已经渲染的样本数 / samples rendered so far
	tuningCents: number; // 与演奏者的音准一致 / match the player's tuning
	masterGain: number;
	private readonly lpL: LowPass | null;
	private readonly lpR: LowPass | null;

	constructor(sf: SoundFont, sr: number, channels: ChannelSetup[], tuningCents = 0, masterGain = 1, toneCutoff: number | null = 5000) {
		this.sf = sf;
		this.sr = sr;
		this.channels = channels;
		this.tuningCents = tuningCents;
		this.masterGain = masterGain;
		this.lpL = toneCutoff ? new LowPass(toneCutoff, sr) : null;
		this.lpR = toneCutoff ? new LowPass(toneCutoff, sr) : null;
	}

	// 时间以秒为单位（合成器自己的时钟，从 0 开始）/ times in seconds on the synth's own clock, starting at 0
	noteOn(time: number, ch: number, key: number, vel: number): void {
		this.push({ time: Math.round(time * this.sr), order: this.order++, kind: 'on', ch, key, vel });
	}

	noteOff(time: number, ch: number, key: number): void {
		this.push({ time: Math.round(time * this.sr), order: this.order++, kind: 'off', ch, key, vel: 0 });
	}

	private push(ev: SynthEvent): void {
		this.events.push(ev);
		this.sorted = false;
	}

	allNotesOff(): void {
		for (const v of this.voices) v.release();
	}

	private apply(ev: SynthEvent): void {
		const setup = this.channels[ev.ch];
		if (ev.kind === 'on') {
			// 力度对音量的影响：振幅 ∝ (力度/127)²（与 FluidSynth 默认的力度调制相同）
			// velocity → amplitude ∝ (vel/127)², as FluidSynth's default velocity modulator
			const velGain = (ev.vel / 127) ** 2 * (setup.gain ?? 1);
			for (const spec of this.sf.voicesFor(setup.bank ?? 0, setup.program, ev.key, ev.vel)) {
				const gain = velGain * 10 ** (-spec.attenuationCb / 200);
				this.voices.push(new Voice(spec, ev.ch, ev.key, gain, this.tuningCents, this.sr));
			}
		} else {
			for (const v of this.voices) if (v.ch === ev.ch && v.key === ev.key) v.release();
		}
	}

	render(outL: Float32Array, outR: Float32Array): void {
		const frames = outL.length;
		outL.fill(0);
		outR.fill(0);
		if (!this.sorted) {
			this.events.sort((a, b) => a.time - b.time || a.order - b.order);
			this.sorted = true;
		}
		const start = this.pos;
		let cur = 0;
		while (this.events.length && this.events[0].time < start + frames) {
			const ev = this.events.shift() as SynthEvent;
			const off = Math.min(Math.max(0, ev.time - start), frames);
			if (off > cur) {
				for (const v of this.voices) v.render(this.sf.data, outL, outR, cur, off);
				cur = off;
			}
			this.apply(ev);
		}
		for (const v of this.voices) v.render(this.sf.data, outL, outR, cur, frames);
		this.voices = this.voices.filter((v) => !v.done);
		const g = this.masterGain;
		for (let i = 0; i < frames; i++) {
			outL[i] *= g;
			outR[i] *= g;
		}
		this.lpL?.process(outL, 0, frames);
		this.lpR?.process(outR, 0, frames);
		this.pos += frames;
	}

	activeVoices(): number {
		return this.voices.length;
	}
}

// 离线渲染整段 / render a whole schedule offline
export function renderOffline(synth: Synth, seconds: number, block = 512): [Float32Array, Float32Array] {
	const n = Math.ceil(seconds * synth.sr);
	const L = new Float32Array(n);
	const R = new Float32Array(n);
	const bl = new Float32Array(block);
	const br = new Float32Array(block);
	for (let p = 0; p < n; p += block) {
		synth.render(bl, br);
		const m = Math.min(block, n - p);
		L.set(bl.subarray(0, m), p);
		R.set(br.subarray(0, m), p);
	}
	return [L, R];
}
