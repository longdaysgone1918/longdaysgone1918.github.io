// 读取相册：src/assets/gallery/ 下的每个文件夹是一个相册 / albums: each folder in src/assets/gallery/ is one album
import type { ImageMetadata } from 'astro';
import { ALBUMS, CAPTIONS, NEWEST_FIRST } from '../data/gallery';

export const UNSORTED = 'unsorted'; // 直接放在 gallery 文件夹里的照片 / photos directly in the gallery folder

export interface GalleryPhoto {
	file: string;
	title: string;
	src: ImageMetadata;
}

export interface Album {
	slug: string; // 文件夹名，也用在网址里 / folder name, also used in the address
	title: string; // 空字符串 = 用页面上的默认名字 / empty = use the page's default name
	description: string;
	photos: GalleryPhoto[];
}

const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/gallery/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', {
	eager: true,
});

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true }) * (NEWEST_FIRST ? -1 : 1);

export function getAlbums(): Album[] {
	const groups = new Map<string, GalleryPhoto[]>();
	for (const [path, mod] of Object.entries(files)) {
		const parts = path.slice('/src/assets/gallery/'.length).split('/');
		// 子文件夹里再分的文件夹也算在第一层的相册里 / deeper folders count towards their top-level album
		const slug = parts.length > 1 ? parts[0] : UNSORTED;
		const file = parts[parts.length - 1];
		if (!groups.has(slug)) groups.set(slug, []);
		groups.get(slug)!.push({ file, title: CAPTIONS[file] ?? '', src: mod.default });
	}
	return [...groups.entries()]
		.map(([slug, photos]) => ({
			slug,
			title: ALBUMS[slug]?.title ?? (slug === UNSORTED ? '' : slug),
			description: ALBUMS[slug]?.description ?? '',
			photos: photos.sort((a, b) => byName(a.file, b.file)),
		}))
		.sort((a, b) => (a.slug === UNSORTED ? 1 : b.slug === UNSORTED ? -1 : byName(a.slug, b.slug)));
}
