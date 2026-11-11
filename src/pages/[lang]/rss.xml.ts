// 每种语言一份 RSS 订阅：/en/rss.xml 和 /zh/rss.xml
// One RSS feed per language: /en/rss.xml and /zh/rss.xml
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPostsByLang, postPath } from '../../lib/posts';
import { getLangStaticPaths, htmlLang, useTranslations, type Lang } from '../../i18n/utils';

export function getStaticPaths() {
	return getLangStaticPaths();
}

export async function GET(context: APIContext) {
	const lang = context.params.lang as Lang;
	const t = useTranslations(lang);
	const posts = await getPostsByLang(lang);

	return rss({
		title: t('site.title'),
		description: t('site.description'),
		site: context.site ?? 'https://tianranl.com',
		customData: `<language>${htmlLang[lang]}</language>`,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			link: postPath(post),
		})),
	});
}
