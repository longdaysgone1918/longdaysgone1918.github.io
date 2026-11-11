// 每种语言一份 RSS 订阅，包含所有板块：/en/rss.xml 和 /zh/rss.xml
// One RSS feed per language covering every section: /en/rss.xml and /zh/rss.xml
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { entryPath, getEntries, sections } from '../../lib/content';
import { getMoments, momentExcerpt, momentPath } from '../../lib/moments';
import { getLangStaticPaths, htmlLang, useTranslations, type Lang } from '../../i18n/utils';

export function getStaticPaths() {
	return getLangStaticPaths();
}

export async function GET(context: APIContext) {
	const lang = context.params.lang as Lang;
	const t = useTranslations(lang);

	const moments = (await getMoments(lang)).map((moment) => ({
		title: momentExcerpt(moment),
		description: momentExcerpt(moment, 200),
		pubDate: moment.data.pubDate,
		link: momentPath(moment),
	}));

	const entries = (
		await Promise.all(
			sections.map(async (section) =>
				(await getEntries(section, lang)).map((entry) => ({
					title: entry.data.title,
					description: entry.data.description,
					pubDate: entry.data.pubDate,
					link: entryPath(section, entry),
				})),
			),
		)
	)
		.flat()
		.concat(moments)
		.sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

	return rss({
		title: t('site.title'),
		description: t('site.description'),
		site: context.site ?? 'https://tianranl.com',
		customData: `<language>${htmlLang[lang]}</language>`,
		items: entries,
	});
}
