// 网页版采用的改进规则（相对 Python M1-15 稳定版）/ improved rules used on the website (relative to Python M1-15)
//   · 只在至少半拍（0.75 个四分音符）的休止后等你重新进入（来自全曲版）
//     wait for your re-entry only after rests of at least half a beat (from the full version)
//   · 第 9 小节你休止时，伴奏演奏到小节线（或你进入后一拍）不等你（来自全曲版）
//     in m.9, while you rest, the accompaniment plays to the bar line (or one beat after your entry)
//   · 退回到更早的音需要连续 6 帧确认 / a step back to an earlier note needs 6 frames
//   · 下一个伴奏音被跳过时，上一个音不再延长（见 SessionOptions.cutSustainOnSkip）
//     when the next accompaniment note is skipped, the previous one is no longer sustained
import type { EngineOptions } from './engine';

export const WEB_ENGINE_OPTIONS: EngineOptions = {
	waitRestMinQn: 0.75,
	noWaitMeasures: [9],
	noWaitAfterEntryQn: 1.5,
	backConfirmFrames: 6,
};

export const VELOCITY_SCALE = 0.8; // 与 Python 版相同 / same as the Python version
