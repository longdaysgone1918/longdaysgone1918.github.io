// 录音处理器：把麦克风的音频按块传给主线程，并附上每块的音量（用于音量条）
// Recorder processor: passes microphone audio to the main thread in chunks, with each chunk's level (for the meter)
class RecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buf = new Float32Array(4096);
		this.n = 0;
	}

	process(inputs) {
		const ch = inputs[0] && inputs[0][0];
		if (ch) {
			for (let i = 0; i < ch.length; i++) {
				this.buf[this.n++] = ch[i];
				if (this.n === this.buf.length) {
					let sum = 0;
					for (let j = 0; j < this.n; j++) sum += this.buf[j] * this.buf[j];
					this.port.postMessage({ samples: this.buf.slice(0), rms: Math.sqrt(sum / this.n) });
					this.n = 0;
				}
			}
		}
		return true;
	}
}

registerProcessor('recorder-processor', RecorderProcessor);
