// 读取“动态”的工具函数
// Helpers for loading moments

import { getCollection, type CollectionEntry } from 'astro:content';
import { localizePath, otherLang, splitPostId, type Lang } from '../i18n/utils';

export type Moment = CollectionEntry<'moments'>;

// 某种语言的全部动态，按时间从新到旧
// All moments in one language, newest first
export async function getMoments(lang: Lang): Promise<Moment[]> {
	const moments = await getCollection('moments');
	return moments
		.filter((moment) => splitPostId(moment.id)?.lang === lang)
		.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// 动态的地址：/zh/moments/2026-11-11-site-update/
// URL of a moment: /zh/moments/2026-11-11-site-update/
export function momentPath(moment: { id: string }): string {
	const parts = splitPostId(moment.id);
	if (!parts) throw new Error(`"${moment.id}" must be inside src/content/moments/en/ or src/content/moments/zh/`);
	return `/${parts.lang}/moments/${parts.slug}/`;
}

// 从正文里取出前几个字，当作列表和搜索结果里的标题
// The first few characters of the text, used as a title in lists and search results
export function momentExcerpt(moment: Moment, length = 40): string {
	const plain = (moment.body ?? '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_`~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

// 为每条动态生成页面，并找出它的另一种语言版本（文件名相同即为同一条）
// One page per moment, plus its other-language version (same file name = same moment)
export async function getMomentStaticPaths() {
	const moments = await getCollection('moments');
	const ids = new Set(moments.map((moment) => moment.id));

	return moments.flatMap((moment) => {
		const parts = splitPostId(moment.id);
		if (!parts) return [];
		const other = otherLang(parts.lang);
		const hasTranslation = ids.has(`${other}/${parts.slug}`);
		const altHref = hasTranslation
			? localizePath(other, `moments/${parts.slug}/`)
			: localizePath(other, 'moments/');
		return [
			{
				params: { lang: parts.lang, slug: parts.slug },
				props: { moment, altHref, hasTranslation, commentId: `moments/${parts.slug}` },
			},
		];
	});
}
