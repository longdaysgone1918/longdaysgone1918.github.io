// 清除相册照片里的隐藏信息（拍摄地点、时间、相机型号等），并按拍摄方向把照片转正
// Removes hidden information from gallery photos (location, time, camera model and so on) and turns them upright
//
// 用法 / usage:  node scripts/clean-photos.mjs
// 每次往 src/assets/gallery/ 放新照片后、提交之前运行一次。已经清除过的照片会自动跳过
// Run once after adding photos to src/assets/gallery/, before committing. Photos already cleaned are skipped
// sharp 是 Astro 自带的图片工具，不需要另外安装 / sharp comes with Astro; nothing extra to install
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'src/assets/gallery';
const IMAGE = /\.(jpe?g|png|webp)$/i;

// 包括各个相册文件夹里的照片 / including photos inside album folders
const names = (await readdir(DIR, { recursive: true })).map((n) => n.split(path.sep).join('/')).sort();
let cleaned = 0;
let skipped = 0;
for (const name of names) {
	const file = path.join(DIR, name);
	if (/\.(heic|heif)$/i.test(name)) {
		console.log(`NOT SUPPORTED  ${name}: convert HEIC photos to JPG first`);
		continue;
	}
	if (!IMAGE.test(name)) continue;
	const input = await readFile(file);
	const meta = await sharp(input).metadata();
	// 没有 EXIF、XMP、IPTC 信息，而且方向正常：不用处理 / no EXIF, XMP or IPTC data and already upright: nothing to do
	if (!meta.exif && !meta.xmp && !meta.iptc && (meta.orientation ?? 1) === 1) {
		skipped++;
		continue;
	}
	// rotate() 按拍摄方向转正；sharp 默认不把任何元数据写进新文件
	// rotate() turns the photo upright; by default sharp writes no metadata into the new file
	let img = sharp(input).rotate();
	const fmt = meta.format;
	if (fmt === 'jpeg') img = img.jpeg({ quality: 92, mozjpeg: true });
	else if (fmt === 'png') img = img.png();
	else if (fmt === 'webp') img = img.webp({ quality: 92 });
	else {
		console.log(`SKIPPED        ${name}: unsupported format ${fmt}`);
		continue;
	}
	await writeFile(file, await img.toBuffer());
	cleaned++;
	console.log(`CLEANED        ${name}`);
}
console.log(`Done: ${cleaned} cleaned, ${skipped} already clean.`);
