// 生成关系图的全部 HTML（筛选、关系图、说明框、人物表）。网站页面和测试都用这同一个函数
// Builds the whole widget's HTML (filters, graph, info box, character table); used by the site page and the tests
import { GROUPS, PEOPLE, REL_TYPES, RELATIONS, type Lang, type Person, type Relation } from './characters';

export const UI = {
	zh: {
		filters: '显示的关系',
		spoilers: '显示后半部和结局的情节（剧透）',
		hint: '把鼠标移到人物上，只突出显示与他相关的人；点击人物或连线，在这里查看说明。',
		relations: '关系',
		table: '人物一览',
		character: '人物',
		about: '简介',
		sections: { main: '主要人物', yepanchin: '叶潘钦家和相关人物', ivolgin: '伊沃尔金家和相关人物', others: '列别杰夫家和其他人物', past: '梅什金的过去' },
		graphLabel: '《白痴》人物关系图',
		spoilerTag: '剧透',
	},
	en: {
		filters: 'Relationships shown',
		spoilers: 'Show later plot and the ending (spoilers)',
		hint: 'Hover over a character to highlight only the people connected to them; click a character or a line to read about it here.',
		relations: 'Relationships',
		table: 'Characters',
		character: 'Character',
		about: 'In short',
		sections: { main: 'Main characters', yepanchin: 'The Yepanchins and their circle', ivolgin: 'The Ivolgins and their circle', others: 'The Lebedevs and others', past: 'Myshkin’s past' },
		graphLabel: 'Character map of The Idiot',
		spoilerTag: 'Spoiler',
	},
};

const SECTIONS: { id: keyof (typeof UI)['zh']['sections']; ids: string[] }[] = [
	{ id: 'main', ids: ['myshkin', 'nastasya', 'rogozhin', 'aglaya', 'totsky'] },
	{ id: 'yepanchin', ids: ['yepanchin', 'lizaveta', 'alexandra', 'adelaida', 'shch', 'radomsky', 'belokonskaya'] },
	{ id: 'ivolgin', ids: ['ivolgin', 'nina', 'ganya', 'varya', 'kolya', 'ptitsyn', 'ferdyshchenko'] },
	{ id: 'others', ids: ['lebedev', 'vera', 'ippolit', 'marfa', 'keller', 'burdovsky'] },
	{ id: 'past', ids: ['pavlishchev', 'schneider'] },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byId = new Map(PEOPLE.map((p) => [p.id, p]));
export const radius = (p: Person) => (p.main ? 19 : 12);

// 两人之间有多条关系时画成弧线，避免重叠 / several relations between two people are drawn as arcs
export function edgePath(r: Relation, index: number): string {
	const a = byId.get(r.a) as Person;
	const b = byId.get(r.b) as Person;
	const key = [r.a, r.b].sort().join('|');
	const same = RELATIONS.map((x, i) => ({ x, i })).filter(({ x }) => [x.a, x.b].sort().join('|') === key);
	const k = same.findIndex((s) => s.i === index);
	if (same.length === 1) return `M${a.x},${a.y} L${b.x},${b.y}`;
	// 统一方向，让偏移的正负在两人之间一致 / normalise direction so offsets are consistent
	const [p, q] = r.a < r.b ? [a, b] : [b, a];
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const len = Math.hypot(dx, dy) || 1;
	const offset = (k - (same.length - 1) / 2) * 46;
	const cx = (p.x + q.x) / 2 + (-dy / len) * offset;
	const cy = (p.y + q.y) / 2 + (dx / len) * offset;
	return `M${p.x},${p.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${q.x},${q.y}`;
}

export function widgetMarkup(lang: Lang): string {
	const ui = UI[lang];
	const type = new Map(REL_TYPES.map((t) => [t.id, t]));
	const filters = REL_TYPES.map(
		(t) =>
			`<label class="idiot-filter"><input type="checkbox" data-type="${t.id}" checked><span class="idiot-swatch" style="--c:${t.color}"${t.dash ? ' data-dash' : ''}></span>${esc(t.label[lang])}</label>`,
	).join('');
	const groups = GROUPS.map(
		(g) =>
			`<g class="idiot-group"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14"/><text x="${g.x + 12}" y="${g.y + 22}">${esc(g.label[lang])}</text></g>`,
	).join('');
	const edges = RELATIONS.map((r, i) => {
		const t = type.get(r.type)!;
		const d = edgePath(r, i);
		const title = `${byId.get(r.a)!.name[lang]} — ${byId.get(r.b)!.name[lang]}：${r.label[lang]}`;
		return `<g class="idiot-edge" data-i="${i}" data-type="${r.type}" data-a="${r.a}" data-b="${r.b}"${r.spoiler ? ' data-spoiler' : ''}><path class="idiot-line" d="${d}" stroke="${t.color}"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''}/><path class="idiot-hit" d="${d}"><title>${esc(r.spoiler ? `${ui.spoilerTag}` : title)}</title></path></g>`;
	}).join('');
	const nodes = PEOPLE.map((p) => {
		const r = radius(p);
		return `<g class="idiot-node${p.main ? ' main' : ''}" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name[lang])}"><circle cx="${p.x}" cy="${p.y}" r="${r}"/><text x="${p.x}" y="${p.y + r + 15}">${esc(p.name[lang])}</text></g>`;
	}).join('');
	const rows = SECTIONS.map((s) => {
		const head = `<tr class="idiot-section"><th colspan="2">${esc(ui.sections[s.id])}</th></tr>`;
		const body = s.ids
			.map((id) => {
				const p = byId.get(id)!;
				const full = p.full ? `<br><span class="idiot-full">${esc(p.full[lang])}</span>` : '';
				// 英文版用一句话标签；中文版用完整介绍（完整介绍在两种语言的说明框里都有）
				// English shows the one-line tag; Chinese shows the full text (the info box has the full text in both)
				if (lang === 'en' && p.tag) return `<tr><td><strong>${esc(p.name[lang])}</strong>${full}</td><td>${esc(p.tag)}</td></tr>`;
				const spoiler = p.spoiler ? ` <span class="idiot-spoiler">${esc(p.spoiler[lang])}</span>` : '';
				return `<tr><td><strong>${esc(p.name[lang])}</strong>${full}</td><td>${esc(p.desc[lang])}${spoiler}</td></tr>`;
			})
			.join('');
		return head + body;
	}).join('');
	return `<div class="idiot no-spoilers" data-idiot data-lang="${lang}">
<div class="idiot-controls"><span class="idiot-controls-title">${esc(ui.filters)}</span>${filters}
<label class="idiot-spoiler-toggle"><input type="checkbox" data-spoilers>${esc(ui.spoilers)}</label></div>
<div class="idiot-canvas"><svg viewBox="0 0 1000 740" role="group" aria-label="${esc(ui.graphLabel)}">${groups}<g class="idiot-edges">${edges}</g><g class="idiot-nodes">${nodes}</g></svg></div>
<div class="idiot-info" aria-live="polite"><p class="idiot-hint">${esc(ui.hint)}</p></div>
<h2>${esc(ui.table)}</h2>
<div class="idiot-table-wrap"><table class="idiot-table"><thead><tr><th>${esc(ui.character)}</th><th>${esc(ui.about)}</th></tr></thead><tbody>${rows}</tbody></table></div>
</div>`;
}
