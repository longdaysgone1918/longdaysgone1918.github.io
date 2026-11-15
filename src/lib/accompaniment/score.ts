// 乐谱数据：读取 score_m1_15.json，转换成引擎内部使用的结构
// Score data: read score_m1_15.json and convert it to the engine's internal structure

export interface Note {
	index: number; // 1-based index from the score file
	measure: number;
	beat: number; // eighth-note count within the measure
	qn: number; // score position in quarter notes (possibly warped by a timing profile)
	dur: number; // duration in quarter notes (possibly warped)
	pitch: number; // MIDI pitch
	vel: number;
	final: boolean;
	category?: string;
	qnOrig?: number; // position before warping (only set when a profile is applied)
	durOrig?: number; // duration before warping
}

export interface Score {
	piano: Note[]; // the visitor's part (solo violin II); called "piano" for historical reasons
	violin: Note[]; // the accompaniment (solo violin I)
	midiSecPerQuarter: number;
	tempoPriorRelativeToMidi: number;
}

interface RawNote {
	index: number;
	measure: number;
	beat_eighth: number;
	qn: number;
	dur_qn: number;
	pitch: number;
	velocity: number;
	final: boolean;
	category?: string;
}

interface RawScore {
	piano: RawNote[];
	violin: RawNote[];
	midi_sec_per_quarter_note: number;
	tempo_prior_relative_to_midi: number;
}

const toNote = (n: RawNote): Note => ({
	index: n.index,
	measure: n.measure,
	beat: n.beat_eighth,
	qn: n.qn,
	dur: n.dur_qn,
	pitch: n.pitch,
	vel: n.velocity,
	final: n.final,
	category: n.category,
});

export function parseScore(raw: RawScore): Score {
	return {
		piano: raw.piano.map(toNote),
		violin: raw.violin.map(toNote),
		midiSecPerQuarter: raw.midi_sec_per_quarter_note,
		tempoPriorRelativeToMidi: raw.tempo_prior_relative_to_midi,
	};
}

// HMM 状态：开头静音 → 音1 → (休止) → 音2 … → 结尾静音（与 Python 的 build_states 相同）
// HMM states: leading silence → note 1 → (rest) → note 2 … → trailing silence (same as Python build_states)
export type StateType = 'sil' | 'note' | 'rest';
export interface HmmState {
	type: StateType;
	k: number; // piano note index (0-based), -1 for silence
}

export function buildStates(piano: Note[], restMin = 0.2): HmmState[] {
	const states: HmmState[] = [{ type: 'sil', k: -1 }];
	piano.forEach((n, k) => {
		states.push({ type: 'note', k });
		if (k + 1 < piano.length && piano[k + 1].qn - (n.qn + n.dur) > restMin) {
			states.push({ type: 'rest', k });
		}
	});
	states.push({ type: 'sil', k: -1 });
	return states;
}

// numpy.interp 的一维版本（x 递增；超出范围时取端点值）
// One-dimensional numpy.interp (x increasing; clamps outside the range)
export function interp(x: number, xp: number[], fp: number[]): number {
	if (x <= xp[0]) return fp[0];
	const n = xp.length;
	if (x >= xp[n - 1]) return fp[n - 1];
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (xp[mid] <= x) lo = mid;
		else hi = mid;
	}
	const t = (x - xp[lo]) / (xp[hi] - xp[lo]);
	return fp[lo] + t * (fp[hi] - fp[lo]);
}

// 个人节奏轮廓：把乐谱位置换成"按习惯拉伸后的位置"（与 Python 的 warp_score 相同）
// Personal timing profile: map score positions through the learned profile (same as Python warp_score)
export function warpScore(score: Score, knotQ: number[], knotW: number[]): Score {
	const kq = [-1e3, ...knotQ, knotQ[knotQ.length - 1] + 1e3];
	const kw = [knotW[0] - (knotQ[0] + 1e3), ...knotW, knotW[knotW.length - 1] + 1e3];
	const f = (q: number) => interp(q, kq, kw);
	const warp = (n: Note): Note => {
		const a = f(n.qn);
		const b = f(n.qn + n.dur);
		return { ...n, qn: a, dur: Math.max(b - a, 1e-3), durOrig: n.dur, qnOrig: n.qn };
	};
	return { ...score, piano: score.piano.map(warp), violin: score.violin.map(warp) };
}
