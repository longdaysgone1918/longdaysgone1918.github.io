// 音高检测：YIN，每 10 毫秒一帧（与 Python 的 yin_frame / StreamingPitch 相同）
// Pitch detection: YIN, one frame every 10 ms (same as Python yin_frame / StreamingPitch)

export const SR = 16000; // 分析采样率 / analysis sample rate
export const HOP = 160; // 帧移 10 ms / hop
export const W = 512; // 差分窗口 / difference window
export const TMAX = Math.floor(SR / 150) + 2; // 最大时延（150 Hz）/ longest lag
export const TMIN = Math.floor(SR / 1100); // 最小时延（1100 Hz）/ shortest lag
export const L = W + TMAX; // 每帧需要的样本数 / samples per frame
const YIN_THRESHOLD = 0.2;

export interface PitchFrame {
	t: number; // 帧中心时间（秒）/ frame centre time (s)
	midi: number; // 未去音准偏差的音高 / raw pitch (MIDI), tuning not removed
	aperiodicity: number;
	energyDb: number;
}

// 单帧 YIN：f 至少有 L 个样本 / one YIN frame; f has at least L samples
export function yinFrame(f: Float32Array, offset = 0): [number, number, number] {
	const d = new Float64Array(TMAX + 1);
	for (let tau = 1; tau <= TMAX; tau++) {
		let s = 0;
		for (let j = 0; j < W; j++) {
			const diff = f[offset + j] - f[offset + j + tau];
			s += diff * diff;
		}
		d[tau] = s;
	}
	// 累积均值归一化 / cumulative mean normalised difference
	const c = new Float64Array(TMAX + 1);
	c[0] = 1;
	let cum = 0;
	for (let tau = 1; tau <= TMAX; tau++) {
		cum += d[tau];
		c[tau] = (d[tau] * tau) / Math.max(cum, 1e-12);
	}
	// 第一个低于阈值的谷；没有就取最小值 / first dip below the threshold, else the minimum
	let t = -1;
	for (let tau = TMIN; tau <= TMAX; tau++) {
		if (c[tau] < YIN_THRESHOLD) {
			t = tau;
			break;
		}
	}
	if (t < 0) {
		t = TMIN;
		for (let tau = TMIN + 1; tau <= TMAX; tau++) if (c[tau] < c[t]) t = tau;
	}
	while (t + 1 <= TMAX && c[t + 1] < c[t]) t += 1;
	// 抛物线插值 / parabolic interpolation
	let off = 0;
	if (t >= 1 && t < TMAX) {
		const den = c[t - 1] - 2 * c[t] + c[t + 1];
		if (den !== 0) off = (0.5 * (c[t - 1] - c[t + 1])) / den;
	}
	const f0 = SR / (t + off);
	let e = 0;
	for (let j = 0; j < W; j++) e += f[offset + j] * f[offset + j];
	const edb = 20 * Math.log10(Math.sqrt(e / W) + 1e-9);
	return [69 + 12 * Math.log2(f0 / 440), c[t], edb];
}

// 抽取滤波器：与 scipy.signal.firwin(numtaps, cutoff)（汉明窗、直流增益为 1）相同
// Decimation filter: same as scipy.signal.firwin(numtaps, cutoff) (Hamming window, unit DC gain)
export function firwin(numtaps: number, cutoff: number): Float64Array {
	const h = new Float64Array(numtaps);
	const mid = (numtaps - 1) / 2;
	let sum = 0;
	for (let n = 0; n < numtaps; n++) {
		const m = n - mid;
		const x = cutoff * m;
		const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
		const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (numtaps - 1));
		h[n] = cutoff * sinc * win;
		sum += h[n];
	}
	for (let n = 0; n < numtaps; n++) h[n] /= sum;
	return h;
}

// 流式：把连续到达的音频块（16 kHz 的整数倍）降到 16 kHz，再变成每 10 ms 一帧
// Streaming: decimate incoming blocks (a multiple of 16 kHz) to 16 kHz and turn them into 10 ms frames
export class StreamingPitch {
	private readonly factor: number;
	private readonly fir: Float64Array | null = null;
	private readonly hist: Float64Array | null = null; // 滤波器状态：最近的输入样本 / filter state: recent inputs
	private readonly delay: number; // 滤波器群延迟（秒）/ filter group delay (s)
	private phase = 0;
	private buf = new Float32Array(0);
	private base = 0; // buf[0] 对应的 16 kHz 样本序号 / 16 kHz sample index of buf[0]
	private frame = 0;

	constructor(srIn = SR) {
		if (srIn % SR !== 0) throw new Error(`input sample rate ${srIn} must be a multiple of ${SR}`);
		this.factor = srIn / SR;
		if (this.factor > 1) {
			this.fir = firwin(8 * this.factor * 2 + 1, 0.9 / this.factor);
			this.hist = new Float64Array(this.fir.length - 1);
			this.delay = (this.fir.length - 1) / 2 / srIn;
		} else {
			this.delay = 0;
		}
	}

	// 因果 FIR 滤波（与 scipy.signal.lfilter 带状态时相同），再每 factor 个取一个
	// Causal FIR filtering (same as scipy.signal.lfilter with state), then keep every factor-th sample
	private decimate(x: Float32Array): Float32Array {
		if (this.factor === 1 || !this.fir || !this.hist) return x;
		const fir = this.fir;
		const hist = this.hist;
		const nt = fir.length;
		const out: number[] = [];
		for (let i = 0; i < x.length; i++) {
			if ((i - this.phase) % this.factor === 0 && i >= this.phase) {
				// y[i] = sum_j fir[j] * x[i - j]，x 的负下标来自上一块 / negative indices come from the previous block
				let y = 0;
				for (let j = 0; j < nt; j++) {
					const idx = i - j;
					y += fir[j] * (idx >= 0 ? x[idx] : hist[hist.length + idx]);
				}
				out.push(y);
			}
		}
		// 更新状态：保留最近 nt - 1 个输入 / keep the last nt - 1 inputs
		const keep = nt - 1;
		if (x.length >= keep) {
			for (let j = 0; j < keep; j++) hist[j] = x[x.length - keep + j];
		} else {
			hist.copyWithin(0, x.length);
			for (let j = 0; j < x.length; j++) hist[keep - x.length + j] = x[j];
		}
		this.phase = (((this.phase - x.length) % this.factor) + this.factor) % this.factor;
		return Float32Array.from(out);
	}

	push(x: Float32Array): PitchFrame[] {
		const y = this.decimate(x);
		const merged = new Float32Array(this.buf.length + y.length);
		merged.set(this.buf, 0);
		merged.set(y, this.buf.length);
		this.buf = merged;
		const out: PitchFrame[] = [];
		for (;;) {
			const start = this.frame * HOP - this.base;
			if (start + L > this.buf.length) break;
			const [m, ap, edb] = yinFrame(this.buf, start);
			out.push({ t: (this.frame * HOP + L / 2) / SR - this.delay, midi: m, aperiodicity: ap, energyDb: edb });
			this.frame += 1;
		}
		const drop = this.frame * HOP - this.base;
		if (drop > 0) {
			this.buf = this.buf.slice(drop);
			this.base += drop;
		}
		return out;
	}
}
