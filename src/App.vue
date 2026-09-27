<script setup>
import { computed, onMounted, ref } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  ArrowDownToLine, ArrowRight, Box, Check, ChevronRight, CirclePlay, Clock3,
  Download, ExternalLink, Menu, Music2,
  Play, Search, Sparkles, X, Zap
} from 'lucide-vue-next'
import {
  articles as fallbackArticles,
  assets as fallbackAssets,
  dynamics as fallbackDynamics,
  videos as fallbackVideos,
} from './data'
import { fetchBilibiliFeed } from './services/bilibili'

const activeSection = ref('home')
const activeArticle = ref(null)
const searchOpen = ref(false)
const query = ref('')
const menuOpen = ref(false)
const downloaded = ref(null)
const articleFilter = ref('全部')
const articles = ref([...fallbackArticles])
const assets = ref([...fallbackAssets])
const videos = ref(fallbackVideos)
const dynamics = ref(fallbackDynamics)
const syncState = ref('演示数据')
const bilibiliSpaceUrl = import.meta.env.VITE_BILIBILI_SPACE_URL || 'https://space.bilibili.com/1858510441'

const nav = [
  { id: 'home', label: '首页' },
  { id: 'articles', label: '文章' },
  { id: 'videos', label: '视频' },
  { id: 'assets', label: '素材库' },
]

const filteredArticles = computed(() => {
  const source = articleFilter.value === '全部' ? articles.value : articles.value.filter(a => a.type === articleFilter.value)
  if (!query.value.trim()) return source
  const q = query.value.toLowerCase()
  return source.filter(a => `${a.title}${a.excerpt}${a.type}`.toLowerCase().includes(q))
})

const globalResults = computed(() => {
  if (!query.value.trim()) return []
  const q = query.value.toLowerCase()
  return articles.value.filter(a => `${a.title}${a.excerpt}`.toLowerCase().includes(q))
})

const articleHtml = computed(() => {
  if (!activeArticle.value?.markdown) return ''
  return DOMPurify.sanitize(marked.parse(activeArticle.value.markdown))
})

function go(section) {
  activeSection.value = section
  activeArticle.value = null
  menuOpen.value = false
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function openArticle(article) {
  activeArticle.value = article
  activeSection.value = 'article'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function downloadAsset(asset) {
  const link = document.createElement('a')
  link.href = asset.downloadUrl
  link.download = asset.downloadName
  document.body.appendChild(link)
  link.click()
  link.remove()
  downloaded.value = asset.id
  setTimeout(() => { downloaded.value = null }, 2200)
}

function openFeatured() {
  window.open('https://www.bilibili.com/video/BV1CVPoeNEq4', '_blank', 'noopener,noreferrer')
}

function imageSrcset(source) {
  if (!source.endsWith('-1600.webp')) return source
  return `${source.replace('-1600.webp', '-640.webp')} 640w, ${source} 1600w`
}

async function loadPublishedContent() {
  try {
    const response = await fetch('/api/content')
    if (!response.ok) return
    const content = await response.json()
    if (content.articles?.length) articles.value = [...content.articles, ...fallbackArticles]
    if (content.resources?.length) assets.value = [...content.resources, ...fallbackAssets]
  } catch (error) {
    console.info('Using bundled content.', error)
  }
}

onMounted(async () => {
  loadPublishedContent()
  try {
    const feed = await fetchBilibiliFeed()
    if (!feed) return
    if (feed.videos.length) videos.value = feed.videos
    if (feed.dynamics.length) dynamics.value = feed.dynamics
    syncState.value = '刚刚同步'
  } catch (error) {
    console.info('Using local Bilibili fallback data.', error)
    syncState.value = '离线缓存'
  }
})
</script>

<template>
  <div class="site-shell">
    <header class="topbar">
      <button class="brand" aria-label="返回首页" @click="go('home')">
        <span class="brand-mark"><Zap :size="17" fill="currentColor" /></span>
        <span>乌托邦P <b>UTOPIA</b></span>
      </button>

      <nav class="desktop-nav" aria-label="主导航">
        <button v-for="item in nav" :key="item.id" :class="{ active: activeSection === item.id }" @click="go(item.id)">
          {{ item.label }}
        </button>
      </nav>

      <div class="header-actions">
        <button class="icon-button" aria-label="搜索" title="搜索" @click="searchOpen = true"><Search :size="19" /></button>
        <a class="bili-link" :href="bilibiliSpaceUrl" target="_blank" rel="noreferrer">BILIBILI <ExternalLink :size="14" /></a>
        <button class="icon-button menu-button" aria-label="打开菜单" @click="menuOpen = !menuOpen"><X v-if="menuOpen" :size="20"/><Menu v-else :size="20" /></button>
      </div>
      <nav v-if="menuOpen" class="mobile-nav">
        <button v-for="item in nav" :key="item.id" @click="go(item.id)">{{ item.label }}</button>
      </nav>
    </header>

    <main v-if="activeSection === 'home'">
      <section class="hero">
        <img class="hero-image" src="/images/anti-utopia-1600.webp" srcset="/images/anti-utopia-640.webp 640w, /images/anti-utopia-1600.webp 1600w" sizes="100vw" width="1600" height="900" fetchpriority="high" decoding="async" alt="乌托邦P代表作《反乌托邦》封面" />
        <div class="hero-scrim"></div>
        <div class="hero-content">
          <div class="status-line"><span></span> SYNTHESIZER V / ROCK / SCIENCE FICTION</div>
          <h1>乌托邦<br><em>UTOPIA_P</em></h1>
          <p>普通一学生。写摇滚，也写少年、现实与并不存在的好地方。</p>
          <div class="hero-actions">
            <button class="primary-button" @click="openArticle(articles[0])">打开作品档案 <ArrowRight :size="18" /></button>
            <button class="round-play" aria-label="在 B 站播放反乌托邦" @click="openFeatured"><Play :size="20" fill="currentColor" /></button>
            <span class="track-name">在 B 站观看 · 反乌托邦</span>
          </div>
        </div>
        <div class="hero-release">
          <span>FILE NO. 2025-0203</span>
          <strong>反乌托邦</strong>
          <small>星尘 × 诗岸</small>
        </div>
      </section>

      <section class="ticker" aria-label="站点动态">
        <span>SYNC / BILIBILI</span><b>UID 1858510441</b><span>·</span><span>42万+关注</span><span>·</span><span>摇滚</span><span>·</span><span>星尘 / 诗岸 / 洛天依</span>
      </section>

      <section class="section-wrap articles-preview">
        <div class="section-heading">
          <div><span class="eyebrow">FIELD NOTES / 01</span><h2>歌与现实的注脚</h2></div>
          <button class="text-button" @click="go('articles')">查看全部 <ArrowRight :size="17" /></button>
        </div>
        <div class="article-grid">
          <article v-for="(article, index) in articles" :key="article.id" class="article-card" @click="openArticle(article)">
            <div class="article-image-wrap"><img :src="article.image" :srcset="imageSrcset(article.image)" sizes="(max-width: 820px) calc(100vw - 32px), 33vw" width="1600" height="900" loading="lazy" decoding="async" :alt="article.title" /><span>{{ String(index + 1).padStart(2, '0') }}</span></div>
            <div class="article-meta"><b :style="{ color: article.color }">{{ article.type }}</b><span>{{ article.date }}</span><span>· {{ article.readTime }}</span></div>
            <h3>{{ article.title }}</h3>
            <p>{{ article.excerpt }}</p>
            <button aria-label="阅读全文"><ArrowRight :size="19" /></button>
          </article>
        </div>
      </section>

      <section class="video-band">
        <div class="section-wrap">
          <div class="section-heading light">
            <div><span class="eyebrow">BILIBILI ARCHIVE / 02</span><h2>不存在之地的歌</h2></div>
            <div class="sync-badge"><span></span> 自动同步 · {{ syncState }}</div>
          </div>
          <div class="video-grid">
            <a v-for="video in videos.slice(0, 3)" :key="video.id" class="video-card" :href="`https://www.bilibili.com/video/${video.id}`" target="_blank" rel="noreferrer">
              <div class="video-cover"><img :src="video.cover" :srcset="imageSrcset(video.cover)" sizes="(max-width: 820px) calc(100vw - 32px), 33vw" width="1600" height="900" loading="lazy" decoding="async" :alt="video.title" /><span class="duration">{{ video.duration }}</span><span class="play-overlay"><CirclePlay :size="42" /></span></div>
              <div class="video-info"><small>{{ video.id }} · {{ video.date }}</small><h3>{{ video.title }}</h3><p>{{ video.stats }}</p></div>
            </a>
          </div>
          <button class="outline-button" @click="go('videos')">进入视频档案 <ChevronRight :size="18" /></button>
        </div>
      </section>

      <section class="section-wrap asset-preview">
        <div class="asset-intro">
          <span class="eyebrow">SECOND CREATION / 03</span>
          <h2>让歌继续<br />被听见。</h2>
          <p>人声 MIDI 与已开放的创作资料可在这里直接下载。使用素材时请保留原作者与原曲信息，并遵守作者发布的使用说明。</p>
          <button class="primary-button dark" @click="go('assets')">浏览全部素材 <Box :size="18" /></button>
        </div>
        <div class="asset-list">
          <div v-for="asset in assets.slice(0, 3)" :key="asset.id" class="asset-row">
            <span class="asset-icon"><Music2 /></span>
            <div><h3>{{ asset.name }}</h3><p>{{ asset.meta }}</p></div>
            <span class="license">{{ asset.tag }}</span>
            <button class="download-button" :aria-label="`下载 ${asset.name}`" @click="downloadAsset(asset)"><Check v-if="downloaded === asset.id" :size="20"/><Download v-else :size="20"/></button>
          </div>
        </div>
      </section>

      <section class="dynamic-band">
        <div class="section-wrap dynamic-grid">
          <div class="dynamic-title"><span class="pulse-dot"></span><h2>此刻动态</h2><p>来自 BILIBILI</p></div>
          <div v-for="dynamic in dynamics" :key="dynamic.time" class="dynamic-item"><span>{{ dynamic.time }}</span><p>{{ dynamic.text }}</p><b>{{ dynamic.topic }}</b></div>
        </div>
      </section>
    </main>

    <main v-else-if="activeSection === 'articles'" class="listing-page">
      <section class="page-head section-wrap"><span class="eyebrow">FIELD NOTES / UTOPIA</span><h1>创作档案</h1><p>摇滚、科幻与少年心事。记录作品背后的现实坐标，也保存那些不能塞进视频简介里的话。</p></section>
      <section class="section-wrap listing-controls">
        <div class="filters"><button v-for="tag in ['全部', '作品档案', '科幻书架', '阶段记录']" :key="tag" :class="{ active: articleFilter === tag }" @click="articleFilter = tag">{{ tag }}</button></div>
        <label class="search-field"><Search :size="17"/><input v-model="query" placeholder="搜索文章" /></label>
      </section>
      <section class="section-wrap archive-list">
        <article v-for="article in filteredArticles" :key="article.id" @click="openArticle(article)">
          <img :src="article.image" :srcset="imageSrcset(article.image)" sizes="(max-width: 560px) calc(100vw - 32px), 250px" width="1600" height="900" loading="lazy" decoding="async" :alt="article.title" />
          <div><span :style="{ color: article.color }">{{ article.type }} / {{ article.date }}</span><h2>{{ article.title }}</h2><p>{{ article.excerpt }}</p><small><Clock3 :size="14"/> {{ article.readTime }}</small></div>
          <ArrowRight class="archive-arrow" />
        </article>
        <p v-if="!filteredArticles.length" class="empty-state">没有找到相关文章。</p>
      </section>
    </main>

    <main v-else-if="activeSection === 'article' && activeArticle" class="article-page">
      <button class="back-button section-wrap" @click="go('articles')">← 返回文章列表</button>
      <article>
        <header class="article-hero section-wrap"><span :style="{ color: activeArticle.color }">UTOPIA FILE / {{ activeArticle.type }} / {{ activeArticle.date }}</span><h1>{{ activeArticle.title }}</h1><p>{{ activeArticle.excerpt }}</p><small><Clock3 :size="14" /> 阅读约 {{ activeArticle.readTime }}</small></header>
        <img class="article-banner" :src="activeArticle.image" :srcset="imageSrcset(activeArticle.image)" sizes="100vw" width="1600" height="900" fetchpriority="high" decoding="async" :alt="activeArticle.title" />
        <div class="article-body"><div class="article-markdown" v-html="articleHtml"></div><div class="article-end"><span>END OF FILE</span><button @click="go('articles')">继续阅读 <ArrowRight :size="17" /></button></div></div>
      </article>
    </main>

    <main v-else-if="activeSection === 'videos'" class="listing-page dark-page">
      <section class="page-head section-wrap"><span class="eyebrow">VIDEO ARCHIVE / UID 1858510441</span><h1>作品时间线</h1><p>B 站投稿自动同步。星尘、诗岸、洛天依，与写给现实世界的科幻摇滚。</p></section>
      <section class="section-wrap video-archive">
        <a v-for="(video, i) in videos" :key="video.id" :href="`https://www.bilibili.com/video/${video.id}`" target="_blank" rel="noreferrer">
          <span class="video-no">0{{ i + 1 }}</span><div class="video-cover"><img :src="video.cover" :srcset="imageSrcset(video.cover)" sizes="(max-width: 560px) calc(100vw - 72px), 270px" width="1600" height="900" loading="lazy" decoding="async" :alt="video.title"/><span class="play-overlay"><CirclePlay :size="46"/></span></div><div><small>{{ video.id }} / {{ video.date }}</small><h2>{{ video.title }}</h2><p>{{ video.stats }}</p></div><ExternalLink class="external"/>
        </a>
      </section>
    </main>

    <main v-else-if="activeSection === 'assets'" class="listing-page">
      <section class="page-head section-wrap asset-head"><div><span class="eyebrow">SECOND CREATION DOWNLOADS</span><h1>二创资料室</h1><p>下载用于翻调、编曲参考与二次创作的开放文件。使用时请标注原曲与作者，具体范围以作者发布的说明为准。</p></div><ArrowDownToLine :size="72" /></section>
      <section class="section-wrap license-note"><Sparkles :size="20"/><p><b>使用提示</b> 下载文件不代表著作权转让。公开发布二创作品前，请确认对应歌曲的署名、转载与商业使用规则。</p></section>
      <section class="section-wrap full-assets">
        <div v-for="asset in assets" :key="asset.id" class="asset-row">
          <span class="asset-icon"><Music2 /></span>
          <div><h2>{{ asset.name }}</h2><p>{{ asset.meta }}</p></div>
          <span class="license">{{ asset.tag }}</span>
          <button class="primary-button small" @click="downloadAsset(asset)"><Check v-if="downloaded === asset.id" :size="17"/><Download v-else :size="17"/>{{ downloaded === asset.id ? '已加入下载' : '下载' }}</button>
        </div>
      </section>
    </main>

    <footer>
      <div class="footer-brand"><span class="brand-mark"><Zap :size="16" fill="currentColor" /></span><strong>UTOPIA_乌托邦P</strong></div>
      <p>至少我还在为你而歌唱。</p>
      <div><button @click="go('articles')">文章</button><button @click="go('videos')">视频</button><button @click="go('assets')">素材</button><a href="mailto:hello@qiyin.music">合作联系</a></div>
      <small>© 2026 UTOPIA_P. UNOFFICIAL SITE TEMPLATE.</small>
    </footer>

    <div v-if="searchOpen" class="search-modal" @click.self="searchOpen = false">
      <div class="search-dialog">
        <button class="close-search" aria-label="关闭搜索" @click="searchOpen = false"><X /></button>
        <span class="eyebrow">SEARCH THE ARCHIVE</span><h2>搜点什么</h2>
        <label><Search :size="22"/><input v-model="query" autofocus placeholder="输入标题或关键词…" /></label>
        <div class="search-results"><button v-for="article in globalResults" :key="article.id" @click="searchOpen = false; openArticle(article)"><span>{{ article.type }}</span><b>{{ article.title }}</b><ArrowRight :size="17"/></button><p v-if="query && !globalResults.length">没有找到匹配内容。</p></div>
      </div>
    </div>

    <div v-if="downloaded" class="toast"><Check :size="18"/> 文件下载已开始</div>
  </div>
</template>
