// 在线乐谱跟随：HMM 前向滤波（与 Python 的 ScoreFollower 相同）
// Online score follower: HMM forward filtering (same as Python ScoreFollower)
import { ENGINE } from './params';
import type { HmmState, Note } from './score';

export class ScoreFollower {
	readonly S: number;
	readonly pitch: Float64Array;
	readonly isNote: Uint8Array;
	readonly optional: Uint8Array;
	readonly qdur: Float64Array;
	readonly qStart: Float64Array;
	readonly qEnd: Float64Array;
	alpha: Float64Array;
	stay: Float64Array;

	constructor(piano: Note[], states: HmmState[], secPerQn: number) {
		const S = states.length;
		this.S = S;
		this.pitch = new Float64Array(S);
		this.isNote = new Uint8Array(S);
		this.optional = new Uint8Array(S);
		const qdur = new Float64Array(S);
		states.forEach((st, s) => {
			this.pitch[s] = st.type === 'note' ? piano[st.k].pitch : NaN;
			this.isNote[s] = st.type === 'note' ? 1 : 0;
			this.optional[s] = st.type === 'note' && piano[st.k].final ? 1 : 0;
			if (st.type === 'sil') {
				qdur[s] = 50.0;
			} else if (st.type === 'note') {
				const k = st.k;
				const nxt = k + 1 < piano.length ? piano[k + 1].qn : piano[k].qn + 1.0;
				const restFollows = s + 1 < S && states[s + 1].type === 'rest';
				qdur[s] = restFollows ? piano[k].dur : nxt - piano[k].qn;
			} else {
				const k = st.k;
				qdur[s] = piano[k + 1].qn - (piano[k].qn + piano[k].dur);
			}
		});
		this.qdur = qdur.map((v) => Math.max(v, 0.05));
		this.qStart = new Float64Array(S);
		states.forEach((st, s) => {
			if (st.type === 'note') this.qStart[s] = piano[st.k].qn;
			else if (st.type === 'rest') this.qStart[s] = piano[st.k].qn + piano[st.k].dur;
			else {
				const last = piano[piano.length - 1];
				this.qStart[s] = s === 0 ? -1e9 : last.qn + last.dur;
			}
		});
		this.qEnd = new Float64Array(S);
		for (let s = 0; s < S; s++) this.qEnd[s] = s === S - 1 ? 1e9 : this.qStart[s] + this.qdur[s];
		this.alpha = new Float64Array(S);
		this.alpha[0] = 1.0;
		this.stay = new Float64Array(S);
		this.setTempo(secPerQn);
	}

	setTempo(secPerQn: number): void {
		for (let s = 0; s < this.S; s++) {
			const frames = (this.qdur[s] * secPerQn) / ENGINE.HOP_SEC;
			const v = 1 - 1 / Math.max(frames, 1.0);
			this.stay[s] = Math.min(Math.max(v, 0.5), 0.999);
		}
		this.stay[0] = 0.995;
	}

	step(
		midi: number,
		voiced: boolean,
		qWindow: [number, number] | null,
		eps = 0.02,
		back = 0.005,
		ahead = 6,
		behind = 2,
	): [number, number] {
		const S = this.S;
		const a = this.alpha;
		const move = new Float64Array(S);
		const nw = new Float64Array(S);
		for (let s = 0; s < S; s++) {
			move[s] = a[s] * (1 - this.stay[s]);
			nw[s] = a[s] * this.stay[s];
		}
		// 与 Python 的运算顺序完全相同，包括"跳过一个音"那一行的下标错位（必须照样复现）
		// Same order of operations as Python, including the off-by-one in the "skip one note" line (kept on purpose)
		for (let s = 1; s < S; s++) nw[s] += move[s - 1] * (1 - eps);
		for (let s = 3; s < S; s++) nw[s] += move[s - 1] * eps;
		nw[1] += move[0] * eps;
		for (let s = 0; s < S - 1; s++) nw[s] += a[s + 1] * back;
		for (let s = 0; s < S; s++) {
			let e: number;
			if (voiced) {
				if (this.isNote[s]) {
					const d = Math.abs(midi - this.pitch[s]) / 0.35;
					e = 0.05 + 0.95 * Math.exp(-0.5 * d * d);
				} else e = 0.05;
			} else {
				e = this.isNote[s] ? (this.optional[s] ? 0.6 : 0.3) : 0.9;
			}
			nw[s] *= e;
		}
		// 只保留当前位置附近的状态 / keep a window around the current position
		let c = 0;
		for (let s = 1; s < S; s++) if (nw[s] > nw[c]) c = s;
		for (let s = 0; s < Math.max(0, c - behind); s++) nw[s] = 0;
		for (let s = c + ahead + 1; s < S; s++) nw[s] = 0;
		if (qWindow) {
			const [lo, hi] = qWindow;
			let inside = 0;
			const outside = new Uint8Array(S);
			for (let s = 0; s < S; s++) {
				outside[s] = this.qEnd[s] < lo || this.qStart[s] > hi ? 1 : 0;
				if (!outside[s]) inside += nw[s];
			}
			if (inside > 0) for (let s = 0; s < S; s++) if (outside[s]) nw[s] = 0;
		}
		let sum = 0;
		for (let s = 0; s < S; s++) sum += nw[s];
		const denom = Math.max(sum, 1e-300);
		for (let s = 0; s < S; s++) nw[s] /= denom;
		this.alpha = nw;
		let best = 0;
		for (let s = 1; s < S; s++) if (nw[s] > nw[best]) best = s;
		return [best, nw[best]];
	}
}
