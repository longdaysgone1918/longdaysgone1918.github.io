// 速度模型：二维卡尔曼滤波（与 Python 的 TempoKalman 相同）
// Tempo model: 2-D Kalman filter (same as Python TempoKalman)
// 状态 x = [T, s]：T = 参考乐谱位置 qRef 的演奏时间，s = 每个四分音符的秒数
// State x = [T, s]: T = performance time of the reference score position qRef, s = seconds per quarter note
import { ENGINE } from './params';

export class TempoKalman {
	qRef: number;
	x: [number, number];
	P: [[number, number], [number, number]];

	constructor(q0: number, t0: number, s0: number) {
		this.qRef = q0;
		this.x = [t0, s0];
		this.P = [
			[0.02 ** 2, 0],
			[0, (0.1 * s0) ** 2],
		];
	}

	predictTime(q: number): number {
		return this.x[0] + this.x[1] * (q - this.qRef);
	}

	update(q: number, t: number): number {
		const dq = q - this.qRef;
		const [T, s] = this.x;
		const P = this.P;
		// x = F x, P = F P F^T + Q，F = [[1, dq], [0, 1]]
		const x0 = T + dq * s;
		const x1 = s;
		const q00 = ENGINE.DRIFT_TIME ** 2 * Math.abs(dq);
		const q11 = (ENGINE.DRIFT_TEMPO * s) ** 2 * Math.abs(dq);
		// F P
		const fp00 = P[0][0] + dq * P[1][0];
		const fp01 = P[0][1] + dq * P[1][1];
		const fp10 = P[1][0];
		const fp11 = P[1][1];
		// (F P) F^T
		const p00 = fp00 + fp01 * dq + q00;
		const p01 = fp01;
		const p10 = fp10 + fp11 * dq;
		const p11 = fp11 + q11;
		const S = p00 + ENGINE.OBS_NOISE ** 2;
		const k0 = p00 / S;
		const k1 = p10 / S;
		const innovation = t - x0;
		const sOld = s;
		this.x = [x0 + k0 * innovation, x1 + k1 * innovation];
		// P = P - outer(K, P[0, :])
		this.P = [
			[p00 - k0 * p00, p01 - k0 * p01],
			[p10 - k1 * p00, p11 - k1 * p01],
		];
		// 一次更新里速度最多变化 ±20% / tempo may change by at most ±20% per update
		this.x[1] = Math.min(Math.max(this.x[1], sOld / 1.2), sOld * 1.2);
		this.qRef = q;
		return innovation;
	}

	// 休止后重新进入：只校正时间，不改变速度 / re-entry after a rest: correct the time only, keep the tempo
	reenter(q: number, t: number): void {
		this.x[0] = t;
		this.qRef = q;
		this.P[0][0] = ENGINE.OBS_NOISE ** 2;
		this.P[0][1] = 0;
		this.P[1][0] = 0;
		this.P[1][1] = Math.max(this.P[1][1], (0.12 * this.x[1]) ** 2);
	}

	clone(): { x: [number, number]; P: [[number, number], [number, number]]; qRef: number } {
		return {
			x: [this.x[0], this.x[1]],
			P: [
				[this.P[0][0], this.P[0][1]],
				[this.P[1][0], this.P[1][1]],
			],
			qRef: this.qRef,
		};
	}
}
