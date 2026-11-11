// 标签：把各板块和动态里用到的标签汇总起来
// Tags: collect the tags used across every section and in moments

import { localizePath, tagSlug, useTranslations, type Lang } from '../i18n/utils';
import { entryPath, getEntries, sections } from './content';
import { getMoments, momentExcerpt, momentPath } from './moments';

export interface TaggedItem {
	href: string;
	title: string;
	date: Date;
	label: string;
}

export interface TagGroup {
	name: string;
	slug: string;
	items: TaggedItem[];
}

// 某种语言下的所有标签，每个标签带上用到它的内容，按时间从新到旧
// Every tag in one language, each with the items that use it, newest first
export async function getTags(lang: Lang): Promise<TagGroup[]> {
	const t = useTranslations(lang);
	const groups = new Map<string, TagGroup>();

	const add = (tags: string[] | undefined, item: TaggedItem) => {
		for (const name of tags ?? []) {
			const slug = tagSlug(name);
			if (!slug) continue;
			const group = groups.get(slug) ?? { name: name.trim(), slug, items: [] };
			group.items.push(item);
			groups.set(slug, group);
		}
	};

	for (const section of sections) {
		for (const entry of await getEntries(section, lang)) {
			add(entry.data.tags, {
				href: entryPath(section, entry),
				title: entry.data.title,
				date: entry.data.pubDate,
				label: t(`nav.${section}`),
			});
		}
	}
	for (const moment of await getMoments(lang)) {
		add(moment.data.tags, {
			href: momentPath(moment),
			title: momentExcerpt(moment),
			date: moment.data.pubDate,
			label: t('nav.moments'),
		});
	}

	for (const group of groups.values()) {
		group.items.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	}
	return [...groups.values()];
}

// 标签页的地址：/zh/tags/巴赫/
// URL of a tag page: /zh/tags/巴赫/
export function tagPath(lang: Lang, name: string): string {
	return localizePath(lang, `tags/${tagSlug(name)}/`);
}
