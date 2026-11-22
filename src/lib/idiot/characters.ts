// 陀思妥耶夫斯基《白痴》人物关系数据（中英两版）。想补充人物、修改译名或说明，只需改这个文件
// Character data for Dostoevsky's The Idiot (Chinese and English). To add characters or change names
// and descriptions, edit only this file.
//
// 坐标 x、y 是人物在图上的位置（画布 1000 × 740）/ x, y: position on the 1000 × 740 canvas
// spoiler：含结局或后半部情节的内容，默认隐藏 / content revealing later plot, hidden by default

export type Lang = 'zh' | 'en';
export type Text = { zh: string; en: string };
export type RelType = 'family' | 'love' | 'conflict' | 'friend' | 'money';
export type GroupId = 'yepanchin' | 'ivolgin' | 'lebedev' | 'past';

export interface Person {
	id: string;
	x: number;
	y: number;
	main?: boolean; // 主要人物，画得大一些 / main character, drawn larger
	group?: GroupId;
	name: Text; // 图上显示的简称 / short name shown on the graph
	full?: Text; // 全名 / full name
	desc: Text;
	spoiler?: Text; // 剧透部分的补充说明 / extra description that gives away the plot
	tag?: string; // 英文人物表里的一句话标签（中文版仍显示完整介绍）/ one-line tag for the English table (Chinese keeps the full text)
}

export interface Relation {
	a: string;
	b: string;
	type: RelType;
	label: Text;
	spoilerNote?: Text; // 补充的剧透说明 / additional note that gives away the plot
	spoiler?: boolean; // 整条关系都是剧透 / the whole relation is a spoiler
}

export const REL_TYPES: { id: RelType; label: Text; color: string; dash?: string }[] = [
	{ id: 'family', label: { zh: '亲属', en: 'Family' }, color: '#8a8f98' },
	{ id: 'love', label: { zh: '爱情与婚约', en: 'Love and marriage' }, color: '#d14b4b' },
	{ id: 'conflict', label: { zh: '冲突与对立', en: 'Conflict' }, color: '#e08600', dash: '6 4' },
	{ id: 'friend', label: { zh: '友谊与帮助', en: 'Friendship and help' }, color: '#3a8d4a' },
	{ id: 'money', label: { zh: '金钱与雇佣', en: 'Money and patronage' }, color: '#2f6fc0', dash: '2 4' },
];

export const GROUPS: { id: GroupId; label: Text; x: number; y: number; w: number; h: number }[] = [
	{ id: 'yepanchin', label: { zh: '叶潘钦家', en: 'The Yepanchins' }, x: 20, y: 20, w: 370, h: 300 },
	{ id: 'ivolgin', label: { zh: '伊沃尔金家', en: 'The Ivolgins' }, x: 630, y: 20, w: 355, h: 310 },
	{ id: 'lebedev', label: { zh: '列别杰夫家', en: 'The Lebedevs' }, x: 370, y: 575, w: 190, h: 153 },
	{ id: 'past', label: { zh: '梅什金的过去', en: 'Myshkin’s past' }, x: 20, y: 500, w: 180, h: 228 },
];

export const PEOPLE: Person[] = [
	// ---------- 中心人物 / central figures ----------
	{
		id: 'myshkin', x: 520, y: 330, main: true,
		tag: 'The holy fool',
		name: { zh: '梅什金公爵', en: 'Prince Myshkin' },
		full: { zh: '列夫·尼古拉耶维奇·梅什金', en: 'Lev Nikolayevich Myshkin' },
		desc: {
			zh: '小说主人公。患癫痫，在瑞士治疗多年后回到彼得堡；善良、单纯，被人称为“白痴”。',
			en: 'The hero. An epileptic who returns to St Petersburg after years of treatment in Switzerland; kind and guileless, he is called an “idiot”.',
		},
		spoiler: { zh: '结尾病情复发，重回瑞士的疗养院。', en: 'At the end he relapses and returns to the clinic in Switzerland.' },
	},
	{
		id: 'nastasya', x: 640, y: 500, main: true,
		tag: 'Wounded pride',
		name: { zh: '纳斯塔西娅', en: 'Nastasya Filippovna' },
		full: { zh: '纳斯塔西娅·菲利波夫娜·巴拉什科娃', en: 'Nastasya Filippovna Barashkova' },
		desc: {
			zh: '美貌、骄傲而受过伤害的女子。少女时代起被托茨基收养并占有，如今他想把她嫁出去。',
			en: 'Beautiful, proud and deeply wounded. Taken in as a girl and kept by Totsky, who now wants to marry her off.',
		},
		spoiler: { zh: '最终被罗戈任杀死。', en: 'She is finally killed by Rogozhin.' },
	},
	{
		id: 'rogozhin', x: 800, y: 440, main: true,
		tag: 'Passion with deep pockets',
		name: { zh: '罗戈任', en: 'Rogozhin' },
		full: { zh: '帕尔芬·谢苗诺维奇·罗戈任', en: 'Parfyon Semyonovich Rogozhin' },
		desc: {
			zh: '商人之子，刚继承巨额遗产，对纳斯塔西娅怀有狂热的激情。',
			en: 'A merchant’s son who has just inherited a fortune, consumed by passion for Nastasya Filippovna.',
		},
		spoiler: { zh: '杀死纳斯塔西娅后被判十五年苦役。', en: 'After killing Nastasya Filippovna he is sentenced to fifteen years’ penal servitude.' },
	},
	{
		id: 'totsky', x: 560, y: 138,
		tag: 'The polite predator',
		name: { zh: '托茨基', en: 'Totsky' },
		full: { zh: '阿法纳西·伊万诺维奇·托茨基', en: 'Afanasy Ivanovich Totsky' },
		desc: {
			zh: '富有的地主，纳斯塔西娅的监护人和占有者；想娶叶潘钦家的长女亚历山德拉，愿出七万五千卢布，让加尼亚娶纳斯塔西娅。',
			en: 'A wealthy landowner, Nastasya Filippovna’s guardian and seducer; hoping to marry Alexandra Yepanchina, he offers 75,000 roubles for Ganya to marry Nastasya Filippovna.',
		},
	},
	// ---------- 叶潘钦家 / the Yepanchins ----------
	{
		id: 'yepanchin', x: 95, y: 80, group: 'yepanchin',
		tag: 'The real idiot',
		name: { zh: '叶潘钦将军', en: 'General Yepanchin' },
		full: { zh: '伊万·费奥多罗维奇·叶潘钦', en: 'Ivan Fyodorovich Yepanchin' },
		desc: {
			zh: '富有而有地位的将军，托茨基的朋友，加尼亚的上司；自己也对纳斯塔西娅动心，送过她珍珠。',
			en: 'A rich and well-placed general, Totsky’s friend and Ganya’s employer; he too is taken with Nastasya Filippovna and gives her pearls.',
		},
	},
	{
		id: 'lizaveta', x: 250, y: 70, group: 'yepanchin',
		tag: 'A kind-hearted thunderstorm',
		name: { zh: '叶潘钦夫人', en: 'Lizaveta Prokofyevna' },
		full: { zh: '莉扎薇塔·普罗科菲耶芙娜·叶潘钦娜', en: 'Lizaveta Prokofyevna Yepanchina' },
		desc: {
			zh: '将军夫人，脾气急躁而心地真诚；出身梅什金公爵家族，是梅什金的远亲。',
			en: 'The general’s wife, hot-tempered but sincere; born a Princess Myshkina, she is the prince’s distant relative.',
		},
		spoiler: { zh: '结尾到瑞士去看望梅什金。', en: 'At the end she visits Myshkin in Switzerland.' },
	},
	{
		id: 'alexandra', x: 75, y: 200, group: 'yepanchin',
		tag: 'The calm eldest',
		name: { zh: '亚历山德拉', en: 'Alexandra' },
		desc: { zh: '叶潘钦家的长女，二十五岁，性情温和；托茨基想娶她。', en: 'The eldest Yepanchin daughter, twenty-five and good-natured; Totsky hopes to marry her.' },
	},
	{
		id: 'adelaida', x: 185, y: 225, group: 'yepanchin',
		tag: 'The painter',
		name: { zh: '阿杰莱达', en: 'Adelaida' },
		desc: { zh: '次女，爱好绘画；后来与 Щ 公爵订婚。', en: 'The middle daughter, who paints; later engaged to Prince Shch.' },
	},
	{
		id: 'aglaya', x: 300, y: 282, group: 'yepanchin', main: true,
		tag: 'The proud tease',
		name: { zh: '阿格拉娅', en: 'Aglaya' },
		desc: {
			zh: '幼女，全家最宠爱，美丽、骄傲、好强；与梅什金相爱，却又常常嘲弄他。',
			en: 'The youngest daughter and the family’s favourite: beautiful, proud and headstrong; she loves Myshkin but often mocks him.',
		},
		spoiler: { zh: '后来嫁给一个自称伯爵的波兰流亡者。', en: 'She later marries a Polish émigré posing as a count.' },
	},
	{
		id: 'shch', x: 90, y: 385,
		tag: 'I don’t know him.',
		name: { zh: 'Щ 公爵', en: 'Prince Shch.' },
		desc: { zh: '阿杰莱达的未婚夫，为人稳重。', en: 'Adelaida’s fiancé, a steady and sensible man.' },
	},
	{
		id: 'radomsky', x: 300, y: 400,
		tag: 'The sensible suitor',
		name: { zh: '叶夫根尼·帕夫洛维奇', en: 'Yevgeny Pavlovich' },
		full: { zh: '叶夫根尼·帕夫洛维奇·拉多姆斯基', en: 'Yevgeny Pavlovich Radomsky' },
		desc: { zh: '富有而聪明的年轻军官，向阿格拉娅求婚的人之一。', en: 'A rich and clever young officer, one of Aglaya’s suitors.' },
		spoiler: { zh: '结尾在瑞士照料梅什金，常去看他。', en: 'At the end he looks after Myshkin in Switzerland and visits him.' },
	},
	{
		id: 'belokonskaya', x: 455, y: 60,
		tag: 'I don’t know her.',
		name: { zh: '别洛孔斯卡娅', en: 'Princess Belokonskaya' },
		desc: { zh: '莫斯科上流社会颇有影响的老公爵夫人，叶潘钦夫人的老朋友。', en: 'An influential old princess of Moscow society, Lizaveta Prokofyevna’s old friend.' },
	},
	// ---------- 伊沃尔金家 / the Ivolgins ----------
	{
		id: 'ivolgin', x: 720, y: 75, group: 'ivolgin',
		tag: 'Lieutenant Rzhevsky, retired',
		name: { zh: '伊沃尔金将军', en: 'General Ivolgin' },
		full: { zh: '阿尔达利翁·亚历山德罗维奇·伊沃尔金', en: 'Ardalion Alexandrovich Ivolgin' },
		desc: { zh: '退役将军，嗜酒、好吹牛，满口编造的往事。', en: 'A retired general, a drinker and braggart full of invented memories.' },
		spoiler: { zh: '偷了列别杰夫的钱包，事情败露后中风去世。', en: 'He steals Lebedev’s wallet and, after it comes out, dies of a stroke.' },
	},
	{
		id: 'nina', x: 870, y: 70, group: 'ivolgin',
		tag: 'Quiet endurance',
		name: { zh: '尼娜', en: 'Nina Alexandrovna' },
		full: { zh: '尼娜·亚历山德罗夫娜·伊沃尔金娜', en: 'Nina Alexandrovna Ivolgina' },
		desc: { zh: '伊沃尔金将军的妻子，善良隐忍。', en: 'General Ivolgin’s wife, kind and long-suffering.' },
	},
	{
		id: 'ganya', x: 700, y: 215, group: 'ivolgin',
		tag: 'The social climber',
		name: { zh: '加尼亚', en: 'Ganya' },
		full: { zh: '加夫里拉·阿尔达利翁诺维奇·伊沃尔金', en: 'Gavrila Ardalionovich Ivolgin' },
		desc: {
			zh: '叶潘钦将军的秘书，野心勃勃、爱钱又爱面子；为了七万五千卢布准备娶纳斯塔西娅，同时又追求阿格拉娅。',
			en: 'General Yepanchin’s secretary, ambitious, greedy and vain; ready to marry Nastasya Filippovna for 75,000 roubles while courting Aglaya.',
		},
	},
	{
		id: 'varya', x: 850, y: 200, group: 'ivolgin',
		tag: 'The family’s backbone',
		name: { zh: '瓦里娅', en: 'Varya' },
		full: { zh: '瓦尔瓦拉·阿尔达利翁诺夫娜', en: 'Varvara Ardalionovna' },
		desc: { zh: '加尼亚的妹妹，坚决反对哥哥娶纳斯塔西娅；后来嫁给普季岑。', en: 'Ganya’s sister, firmly against his marrying Nastasya Filippovna; she later marries Ptitsyn.' },
	},
	{
		id: 'kolya', x: 945, y: 250, group: 'ivolgin',
		tag: 'The eager go-between',
		name: { zh: '科利亚', en: 'Kolya' },
		full: { zh: '尼古拉·阿尔达利翁诺维奇', en: 'Nikolai Ardalionovich' },
		desc: { zh: '伊沃尔金家的小儿子，十几岁，热心忠诚，是梅什金和伊波利特的朋友。', en: 'The Ivolgins’ teenage younger son, warm-hearted and loyal; a friend of Myshkin and Ippolit.' },
	},
	{
		id: 'ptitsyn', x: 850, y: 390,
		tag: 'The patient moneylender',
		name: { zh: '普季岑', en: 'Ptitsyn' },
		desc: { zh: '放债人，加尼亚的朋友，后来娶了瓦里娅。', en: 'A moneylender, Ganya’s friend, who later marries Varya.' },
	},
	{
		id: 'ferdyshchenko', x: 700, y: 610,
		tag: 'The court jester',
		name: { zh: '费尔德先科', en: 'Ferdyshchenko' },
		desc: {
			zh: '伊沃尔金家的房客，爱出洋相的小丑式人物；在纳斯塔西娅的晚会上提议每人讲一件自己做过的最坏的事。',
			en: 'A lodger at the Ivolgins’, a buffoon; at Nastasya Filippovna’s party he proposes that everyone tell the worst thing they have ever done.',
		},
	},
	// ---------- 列别杰夫家及其他 / the Lebedevs and others ----------
	{
		id: 'lebedev', x: 445, y: 630, group: 'lebedev',
		tag: 'A toady with a prophecy',
		name: { zh: '列别杰夫', en: 'Lebedev' },
		full: { zh: '卢基扬·季莫菲耶维奇·列别杰夫', en: 'Lukyan Timofeyevich Lebedev' },
		desc: {
			zh: '小官吏，钻营讨好、爱讲《启示录》；在火车上结识罗戈任，后来把帕夫洛夫斯克的别墅租给梅什金。',
			en: 'A petty official, fawning and scheming, fond of expounding the Apocalypse; he meets Rogozhin on the train and later rents his Pavlovsk dacha to Myshkin.',
		},
	},
	{
		id: 'vera', x: 500, y: 690, group: 'lebedev',
		tag: 'Quiet kindness',
		name: { zh: '薇拉', en: 'Vera' },
		desc: { zh: '列别杰夫的女儿，照顾弟妹，真心关心梅什金。', en: 'Lebedev’s daughter, who looks after the younger children and truly cares for Myshkin.' },
	},
	{
		id: 'keller', x: 300, y: 665,
		tag: 'Rogue turned devotee',
		name: { zh: '凯勒尔', en: 'Keller' },
		desc: {
			zh: '退役中尉，起初跟着布尔多夫斯基一伙找梅什金的麻烦，后来成了他的崇拜者，还要在他和纳斯塔西娅的婚礼上做伴郎。',
			en: 'A retired lieutenant who at first joins Burdovsky’s group against Myshkin, then becomes his devotee and is to be best man at his wedding to Nastasya Filippovna.',
		},
	},
	{
		id: 'burdovsky', x: 300, y: 560,
		tag: 'The false heir',
		name: { zh: '布尔多夫斯基', en: 'Burdovsky' },
		desc: {
			zh: '自称是帕夫利谢夫的儿子，带着一群年轻人向梅什金索要钱财；加尼亚查明他其实不是。',
			en: 'Claims to be Pavlishchev’s son and, with a group of young men, demands money from Myshkin; Ganya shows that he is not.',
		},
	},
	{
		id: 'pavlishchev', x: 95, y: 560, group: 'past',
		tag: 'The absent benefactor',
		name: { zh: '帕夫利谢夫', en: 'Pavlishchev' },
		desc: { zh: '已故的富人，梅什金的恩人，出钱送他去瑞士治病。', en: 'A wealthy man, now dead, Myshkin’s benefactor, who paid for his treatment in Switzerland.' },
	},
	{
		id: 'schneider', x: 95, y: 670, group: 'past',
		tag: 'I don’t know him.',
		name: { zh: '施奈德', en: 'Schneider' },
		desc: { zh: '瑞士的医生，治疗梅什金多年。', en: 'The Swiss doctor who treated Myshkin for years.' },
	},
	{
		id: 'ippolit', x: 880, y: 620,
		tag: 'Defiant and dying',
		name: { zh: '伊波利特', en: 'Ippolit' },
		full: { zh: '伊波利特·捷连季耶夫', en: 'Ippolit Terentyev' },
		desc: {
			zh: '患肺结核的青年，科利亚的朋友；在梅什金的生日晚会上朗读《我的必要的说明》，随后企图开枪自杀。',
			en: 'A consumptive young man, Kolya’s friend; at Myshkin’s birthday party he reads “My Necessary Explanation” and then tries to shoot himself.',
		},
		spoiler: { zh: '在纳斯塔西娅死后不久病逝。', en: 'He dies of his illness soon after Nastasya Filippovna’s death.' },
	},
	{
		id: 'marfa', x: 945, y: 455,
		tag: 'I don’t know her.',
		name: { zh: '捷连季耶娃', en: 'Mrs Terentyeva' },
		full: { zh: '玛尔法·鲍里索夫娜·捷连季耶娃', en: 'Marfa Borisovna Terentyeva' },
		desc: { zh: '伊波利特的母亲，上尉的遗孀；伊沃尔金将军的情妇。', en: 'Ippolit’s mother, a captain’s widow; General Ivolgin’s mistress.' },
	},
];

const t = (zh: string, en: string): Text => ({ zh, en });

export const RELATIONS: Relation[] = [
	// ---------- 亲属 / family ----------
	{ a: 'yepanchin', b: 'lizaveta', type: 'family', label: t('夫妻', 'Husband and wife') },
	{ a: 'lizaveta', b: 'alexandra', type: 'family', label: t('母女', 'Mother and daughter') },
	{ a: 'lizaveta', b: 'adelaida', type: 'family', label: t('母女', 'Mother and daughter') },
	{ a: 'lizaveta', b: 'aglaya', type: 'family', label: t('母女', 'Mother and daughter') },
	{ a: 'lizaveta', b: 'myshkin', type: 'family', label: t('远亲（她出身梅什金公爵家族）', 'Distant relatives (she was born a Princess Myshkina)') },
	{ a: 'ivolgin', b: 'nina', type: 'family', label: t('夫妻', 'Husband and wife') },
	{ a: 'nina', b: 'ganya', type: 'family', label: t('母子', 'Mother and son') },
	{ a: 'nina', b: 'varya', type: 'family', label: t('母女', 'Mother and daughter') },
	{ a: 'nina', b: 'kolya', type: 'family', label: t('母子', 'Mother and son') },
	{ a: 'varya', b: 'ptitsyn', type: 'family', label: t('后来结为夫妻', 'Later husband and wife') },
	{ a: 'lebedev', b: 'vera', type: 'family', label: t('父女', 'Father and daughter') },
	{ a: 'marfa', b: 'ippolit', type: 'family', label: t('母子', 'Mother and son') },
	// ---------- 爱情与婚约 / love and marriage ----------
	{
		a: 'myshkin', b: 'nastasya', type: 'love',
		label: t('出于怜悯爱她，向她求婚；她两次在最后一刻随罗戈任离去', 'Loves her out of compassion and offers to marry her; twice she leaves with Rogozhin at the last moment'),
	},
	{ a: 'rogozhin', b: 'nastasya', type: 'love', label: t('狂热的激情；用十万卢布“买”她', 'Obsessive passion; he “buys” her with 100,000 roubles') },
	{
		a: 'myshkin', b: 'aglaya', type: 'love',
		label: t('彼此相爱，几乎订婚', 'In love, and almost engaged'),
		spoilerNote: t('她与纳斯塔西娅当面对质后，婚事破裂', 'It falls apart after her confrontation with Nastasya Filippovna'),
	},
	{ a: 'ganya', b: 'nastasya', type: 'love', label: t('为了七万五千卢布准备娶她', 'Ready to marry her for 75,000 roubles') },
	{ a: 'ganya', b: 'aglaya', type: 'love', label: t('暗中追求她', 'Courts her in secret') },
	{ a: 'radomsky', b: 'aglaya', type: 'love', label: t('求婚者之一', 'One of her suitors') },
	{ a: 'totsky', b: 'alexandra', type: 'love', label: t('想娶她', 'Hopes to marry her') },
	{ a: 'yepanchin', b: 'nastasya', type: 'love', label: t('暗中倾慕，送她珍珠', 'Secretly infatuated; gives her pearls') },
	{ a: 'shch', b: 'adelaida', type: 'love', label: t('订婚', 'Engaged') },
	{ a: 'ivolgin', b: 'marfa', type: 'love', label: t('情妇', 'His mistress') },
	// ---------- 冲突与对立 / conflict ----------
	{ a: 'totsky', b: 'nastasya', type: 'conflict', label: t('她的监护人，从少女时代起占有她；她恨他', 'Her guardian, who has kept her since girlhood; she hates him') },
	{
		a: 'aglaya', b: 'nastasya', type: 'conflict',
		label: t('情敌；纳斯塔西娅写信劝阿格拉娅嫁给梅什金', 'Rivals; Nastasya Filippovna writes urging Aglaya to marry Myshkin'),
		spoilerNote: t('两人最后当面对质', 'In the end they confront each other'),
	},
	{ a: 'ganya', b: 'myshkin', type: 'conflict', label: t('加尼亚打了梅什金一记耳光，后来道歉', 'Ganya slaps Myshkin, then apologises') },
	{ a: 'ganya', b: 'rogozhin', type: 'conflict', label: t('争夺纳斯塔西娅', 'Rivals for Nastasya Filippovna') },
	{ a: 'rogozhin', b: 'nastasya', type: 'conflict', label: t('杀死了她', 'Kills her'), spoiler: true },
	{ a: 'rogozhin', b: 'myshkin', type: 'conflict', label: t('罗戈任曾持刀袭击梅什金', 'Rogozhin attacks him with a knife'), spoiler: true },
	// ---------- 友谊与帮助 / friendship and help ----------
	{
		a: 'myshkin', b: 'rogozhin', type: 'friend',
		label: t('结拜兄弟，交换了十字架；也是情敌', 'Sworn brothers who exchanged crosses, and rivals in love'),
		spoilerNote: t('结尾两人一起守在纳斯塔西娅的遗体旁', 'At the end the two keep watch together beside Nastasya Filippovna’s body'),
	},
	{ a: 'kolya', b: 'myshkin', type: 'friend', label: t('忠实的朋友，帮他传信', 'A loyal friend who carries his messages') },
	{ a: 'kolya', b: 'ippolit', type: 'friend', label: t('朋友', 'Friends') },
	{ a: 'totsky', b: 'yepanchin', type: 'friend', label: t('朋友，一起安排两桩婚事', 'Friends who together plan two marriages') },
	{ a: 'ptitsyn', b: 'ganya', type: 'friend', label: t('朋友', 'Friends') },
	{ a: 'keller', b: 'myshkin', type: 'friend', label: t('先是找麻烦的一伙人之一，后来成了他的崇拜者', 'First one of the group harassing him, then his devotee') },
	{ a: 'keller', b: 'burdovsky', type: 'friend', label: t('同伙', 'Allies') },
	{ a: 'ippolit', b: 'myshkin', type: 'friend', label: t('在他的生日晚会上朗读自白；对他既依赖又怨恨', 'Reads his confession at Myshkin’s birthday party; both depends on and resents him') },
	{ a: 'ferdyshchenko', b: 'nastasya', type: 'friend', label: t('她晚会上的常客', 'A regular at her gatherings') },
	{ a: 'vera', b: 'myshkin', type: 'friend', label: t('照顾他，默默关心他', 'Looks after him and quietly cares for him') },
	{ a: 'belokonskaya', b: 'lizaveta', type: 'friend', label: t('老朋友', 'Old friends') },
	{ a: 'schneider', b: 'myshkin', type: 'friend', label: t('瑞士的主治医生', 'His doctor in Switzerland') },
	{ a: 'radomsky', b: 'myshkin', type: 'friend', label: t('在瑞士照料他', 'Looks after him in Switzerland'), spoiler: true },
	// ---------- 金钱与雇佣 / money and patronage ----------
	{ a: 'pavlishchev', b: 'myshkin', type: 'money', label: t('恩人，出钱送他去瑞士治病', 'His benefactor, who paid for his treatment in Switzerland') },
	{ a: 'totsky', b: 'ganya', type: 'money', label: t('愿出七万五千卢布，让他娶纳斯塔西娅', 'Offers him 75,000 roubles to marry Nastasya Filippovna') },
	{ a: 'yepanchin', b: 'ganya', type: 'money', label: t('上司与秘书', 'Employer and secretary') },
	{ a: 'burdovsky', b: 'myshkin', type: 'money', label: t('自称帕夫利谢夫之子，向他索要钱财', 'Claims to be Pavlishchev’s son and demands money') },
	{ a: 'burdovsky', b: 'pavlishchev', type: 'money', label: t('自称是他的儿子（其实不是）', 'Claims to be his son (he is not)') },
	{ a: 'lebedev', b: 'myshkin', type: 'money', label: t('房东；表面殷勤，暗中算计', 'His landlord; obsequious on the surface, scheming underneath') },
];
