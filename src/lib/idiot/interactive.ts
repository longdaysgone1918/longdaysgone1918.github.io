// 关系图的互动：突出显示、点击说明、筛选关系类型、剧透开关
// Graph interaction: highlighting, details on click, relationship filters, spoiler switch
import { PEOPLE, REL_TYPES, RELATIONS, type Lang } from './characters';
import { UI } from './render';

export function initIdiotGraph(root: HTMLElement): void {
	const lang = (root.dataset.lang === 'en' ? 'en' : 'zh') as Lang;
	const ui = UI[lang];
	const people = new Map(PEOPLE.map((p) => [p.id, p]));
	const types = new Map(REL_TYPES.map((t) => [t.id, t]));
	const info = root.querySelector<HTMLElement>('.idiot-info')!;
	const svg = root.querySelector<SVGSVGElement>('svg')!;
	const edgeEls = Array.from(root.querySelectorAll<SVGGElement>('.idiot-edge'));
	const nodeEls = new Map(Array.from(root.querySelectorAll<SVGGElement>('.idiot-node')).map((n) => [n.dataset.id!, n]));
	const enabled = new Set(REL_TYPES.map((t) => t.id as string));
	let spoilers = false;
	let selected: string | null = null; // 'p:<id>' 或 'e:<index>' / 'p:<id>' or 'e:<index>'

	const visible = (el: SVGGElement) => enabled.has(el.dataset.type!) && (spoilers || !('spoiler' in el.dataset));
	const el = (tag: string, cls?: string, text?: string) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	};

	const refresh = () => {
		root.classList.toggle('no-spoilers', !spoilers);
		for (const e of edgeEls) e.classList.toggle('off', !visible(e));
		// 剧透关系出现后，补上它的提示文字 / give spoiler relations their tooltip once shown
		for (const e of edgeEls) {
			const r = RELATIONS[Number(e.dataset.i)];
			const title = e.querySelector('title');
			if (title && r.spoiler) title.textContent = spoilers ? `${people.get(r.a)!.name[lang]} — ${people.get(r.b)!.name[lang]}：${r.label[lang]}` : ui.spoilerTag;
		}
		if (selected) show(selected);
	};

	// 突出显示一个人物和与他直接相关的人 / highlight a character and those directly connected
	const highlight = (id: string | null, edgeIndex: number | null = null) => {
		root.classList.toggle('focusing', id !== null || edgeIndex !== null);
		for (const n of nodeEls.values()) n.classList.remove('hl');
		for (const e of edgeEls) e.classList.remove('hl');
		if (edgeIndex !== null) {
			const e = edgeEls[edgeIndex];
			e.classList.add('hl');
			nodeEls.get(e.dataset.a!)?.classList.add('hl');
			nodeEls.get(e.dataset.b!)?.classList.add('hl');
			return;
		}
		if (id === null) return;
		nodeEls.get(id)?.classList.add('hl');
		for (const e of edgeEls) {
			if (!visible(e) || (e.dataset.a !== id && e.dataset.b !== id)) continue;
			e.classList.add('hl');
			nodeEls.get(e.dataset.a!)?.classList.add('hl');
			nodeEls.get(e.dataset.b!)?.classList.add('hl');
		}
	};

	const relationText = (i: number) => {
		const r = RELATIONS[i];
		let s = r.label[lang];
		if (spoilers && r.spoilerNote) s += lang === 'zh' ? `；${r.spoilerNote.zh}` : `; ${r.spoilerNote.en}`;
		return s;
	};

	const show = (sel: string) => {
		info.replaceChildren();
		if (sel.startsWith('p:')) {
			const p = people.get(sel.slice(2))!;
			const h = el('h3', undefined, p.name[lang]);
			info.append(h);
			if (p.full) info.append(el('p', 'idiot-full', p.full[lang]));
			const d = el('p', undefined, p.desc[lang]);
			if (spoilers && p.spoiler) d.append(' ', el('span', 'idiot-spoiler-shown', p.spoiler[lang]));
			info.append(d);
			const list = el('ul', 'idiot-rel-list');
			edgeEls.forEach((e, i) => {
				if (!visible(e) || (e.dataset.a !== p.id && e.dataset.b !== p.id)) return;
				const other = people.get(e.dataset.a === p.id ? e.dataset.b! : e.dataset.a!)!;
				const li = el('li');
				const sw = el('span', 'idiot-swatch');
				sw.style.setProperty('--c', types.get(RELATIONS[i].type)!.color);
				if (types.get(RELATIONS[i].type)!.dash) sw.dataset.dash = '';
				const who = el('button', 'idiot-link', other.name[lang]) as HTMLButtonElement;
				who.type = 'button';
				who.addEventListener('click', () => select(`p:${other.id}`));
				li.append(sw, who, `${lang === 'zh' ? '：' : ': '}${relationText(i)}`);
				list.append(li);
			});
			if (list.children.length) info.append(el('h4', undefined, ui.relations), list);
			highlight(p.id);
		} else {
			const i = Number(sel.slice(2));
			const r = RELATIONS[i];
			if (!visible(edgeEls[i])) {
				clear();
				return;
			}
			info.append(el('h3', undefined, `${people.get(r.a)!.name[lang]} — ${people.get(r.b)!.name[lang]}`));
			info.append(el('p', 'idiot-type', types.get(r.type)!.label[lang]));
			info.append(el('p', undefined, relationText(i)));
			highlight(null, i);
		}
	};

	const select = (sel: string) => {
		selected = sel;
		show(sel);
	};
	const clear = () => {
		selected = null;
		highlight(null);
		info.replaceChildren(el('p', 'idiot-hint', ui.hint));
	};

	for (const [id, n] of nodeEls) {
		n.addEventListener('mouseenter', () => !selected && highlight(id));
		n.addEventListener('mouseleave', () => (selected ? show(selected) : highlight(null)));
		n.addEventListener('focus', () => !selected && highlight(id));
		n.addEventListener('blur', () => !selected && highlight(null));
		n.addEventListener('click', (ev) => {
			ev.stopPropagation();
			select(`p:${id}`);
		});
		n.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				select(`p:${id}`);
			}
		});
	}
	edgeEls.forEach((e, i) => {
		e.addEventListener('click', (ev) => {
			ev.stopPropagation();
			select(`e:${i}`);
		});
	});
	svg.addEventListener('click', clear);
	root.querySelectorAll<HTMLInputElement>('input[data-type]').forEach((c) =>
		c.addEventListener('change', () => {
			if (c.checked) enabled.add(c.dataset.type!);
			else enabled.delete(c.dataset.type!);
			refresh();
		}),
	);
	root.querySelector<HTMLInputElement>('input[data-spoilers]')?.addEventListener('change', (ev) => {
		spoilers = (ev.target as HTMLInputElement).checked;
		refresh();
	});
	refresh();
}
