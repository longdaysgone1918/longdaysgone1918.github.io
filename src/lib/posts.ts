// 读取某个语言的全部文章，按发布日期从新到旧排序
// Load every post in one language, newest first

import { getCollection, type CollectionEntry } from 'astro:content';
import { splitPostId, type Lang } from '../i18n/utils';

export async function getPostsByLang(lang: Lang): Promise<CollectionEntry<'blog'>[]> {
	const posts = await getCollection('blog', (post) => splitPostId(post.id)?.lang === lang);
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// 文章在网站上的地址：/en/blog/hello-world/
// The URL of a post on the site: /en/blog/hello-world/
export function postPath(post: CollectionEntry<'blog'>): string {
	const parts = splitPostId(post.id);
	if (!parts) throw new Error(`Post "${post.id}" must be inside src/content/blog/en/ or src/content/blog/zh/`);
	return `/${parts.lang}/blog/${parts.slug}/`;
}
