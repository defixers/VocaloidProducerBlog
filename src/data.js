import antiUtopiaMarkdown from './content/anti-utopia.md?raw'
import childhoodEndMarkdown from './content/childhood-end.md?raw'
import teenagePoemMarkdown from './content/teenage-poem.md?raw'

export const articles = [
  {
    id: 1,
    type: '作品档案',
    date: '2025.02.03',
    title: '《反乌托邦》：在黑暗里继续歌唱',
    excerpt: '从平白如话的现实书写，到星尘与诗岸交错的人声，一份关于代表作的创作档案。',
    readTime: '7 分钟',
    color: '#d64a38',
    image: '/images/anti-utopia-1600.webp',
    markdown: antiUtopiaMarkdown,
  },
  {
    id: 2,
    type: '科幻书架',
    date: '2025.06.01',
    title: '从克拉克到《童年的终结》',
    excerpt: '科幻不是布景，而是理解成长的一种坐标：关于童年、远方与反季节的心。',
    readTime: '6 分钟',
    color: '#527db5',
    image: '/images/childhood-end-1600.webp',
    markdown: childhoodEndMarkdown,
  },
  {
    id: 3,
    type: '阶段记录',
    date: '2026.06.26',
    title: '少年幻想总是诗，然后继续向前',
    excerpt: '从备考暂别，到高考后的回归：创作并不总是连续，但声音会记住那段空白。',
    readTime: '5 分钟',
    color: '#cc6a38',
    image: '/images/teenage-poem-1600.webp',
    markdown: teenagePoemMarkdown,
  },
]

export const videos = [
  { id: 'BV1CVPoeNEq4', title: '反乌托邦 / 星尘・诗岸原创摇滚', stats: '1919.5万播放 · 106.3万收藏', date: '2025-02-03', cover: '/images/anti-utopia-1600.webp', duration: '2:33' },
  { id: 'BV1Lr8R6ZEbA', title: '未解之谜 / 洛天依原创', stats: '30.1万播放 · 2.2万收藏', date: '2026-08-27', cover: '/images/mystery-1600.webp', duration: '3:28' },
  { id: 'BV1Ve7P67Eqa', title: '少年幻想总是诗 / 星尘原创', stats: '47.5万播放 · 3.4万收藏', date: '2026-06-26', cover: '/images/teenage-poem-1600.webp', duration: '3:14' },
  { id: 'BV1fRXxY1EkH', title: '奇迹从来没出现 / 星尘原创', stats: '270.1万播放 · 8.3万收藏', date: '2025-03-22', cover: '/images/miracle-1600.webp', duration: '4:22' },
  { id: 'BV1h6jpzGEcb', title: '童年的终结 / 星尘原创摇滚', stats: '146.7万播放 · 7.8万收藏', date: '2025-06-01', cover: '/images/childhood-end-1600.webp', duration: '3:32' },
  { id: 'BV1K6tpzaEdj', title: '完美的真空 / 星尘・诗岸原创', stats: '66.2万播放 · 1.9万收藏', date: '2025-08-12', cover: '/images/perfect-vacuum-1600.webp', duration: '5:24' },
]

export const assets = [
  {
    id: 1,
    name: '《奇迹从来没出现》人声 MIDI',
    meta: 'Standard MIDI File · 16 KB',
    tag: '人声轨',
    downloadUrl: '/downloads/miracle-vocal.mid',
    downloadName: '奇迹从来没出现人声midi.mid',
  },
]

export const dynamics = [
  { time: '2026-08-27', text: '《未解之谜》由洛天依演唱，现已收录进作品时间线。', topic: '#未解之谜' },
  { time: '2026-06-26', text: '《少年幻想总是诗》发布。越过那段空白，创作重新开始。', topic: '#少年幻想总是诗' },
  { time: '2025-06-01', text: '用三分三十一秒证明，年少时曾经有颗反季节的心。', topic: '#童年的终结' },
]
