// 读取各板块内容的工具函数
// Helpers for loading the content of each section

import { getCollection, type CollectionEntry } from 'astro:content';
import { localizePath, otherLang, splitPostId, type Lang } from '../i18n/utils';

export type Section = 'essays' | 'reviews' | 'notes' | 'projects';
export const sections: Section[] = ['essays', 'reviews', 'notes', 'projects'];

export type Entry<S extends Section = Section> = CollectionEntry<S>;

// 某个板块、某种语言的全部内容，按发布日期从新到旧
// All entries of one section in one language, newest first
export async function getEntries<S extends Section>(section: S, lang: Lang): Promise<Entry<S>[]> {
	const entries = (await getCollection(section)) as Entry<S>[];
	return entries
		.filter((entry) => splitPostId(entry.id)?.lang === lang)
		.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// 内容在网站上的地址：/zh/essays/hello-world/
// The URL of an entry: /zh/essays/hello-world/
export function entryPath(section: Section, entry: { id: string }): string {
	const parts = splitPostId(entry.id);
	if (!parts) {
		throw new Error(`"${entry.id}" must be inside src/content/${section}/en/ or src/content/${section}/zh/`);
	}
	return `/${parts.lang}/${section}/${parts.slug}/`;
}

// 为某个板块的每篇内容生成页面，并找出它的另一种语言版本
// Build one page per entry in a section, and find each entry's other-language version
export async function getEntryStaticPaths<S extends Section>(section: S) {
	const entries = (await getCollection(section)) as Entry<S>[];
	const ids = new Set(entries.map((entry) => entry.id));

	return entries.flatMap((entry) => {
		const parts = splitPostId(entry.id);
		// 不在 en/ 或 zh/ 文件夹里的内容会被跳过
		// Entries outside the en/ and zh/ folders are skipped
		if (!parts) return [];

		const other = otherLang(parts.lang);
		const hasTranslation = ids.has(`${other}/${parts.slug}`);
		// 有翻译就跳到对应页面，没有就跳到另一种语言的板块列表
		// Link to the translation if it exists, otherwise to the section list in the other language
		const altHref = hasTranslation
			? localizePath(other, `${section}/${parts.slug}/`)
			: localizePath(other, `${section}/`);

		// 留言区的编号：中英两个版本共用同一组留言，例如 essays/hello-world
		// Comment thread id: both language versions share one thread, e.g. essays/hello-world
		const commentId = `${section}/${parts.slug}`;

		return [
			{
				params: { lang: parts.lang, slug: parts.slug },
				props: { entry, altHref, hasTranslation, commentId },
			},
		];
	});
}

// 首页的“最近更新”：所有板块合在一起，取最新的几篇
// "Latest" on the home page: newest entries across all sections
export async function getLatestEntries(lang: Lang, limit = 5) {
	const all = await Promise.all(
		sections.map(async (section) =>
			(await getEntries(section, lang)).map((entry) => ({ section, entry: entry as Entry })),
		),
	);
	return all
		.flat()
		.sort((a, b) => b.entry.data.pubDate.valueOf() - a.entry.data.pubDate.valueOf())
		.slice(0, limit);
}
