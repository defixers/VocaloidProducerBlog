<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  ArrowLeft, Check, ChevronRight, FileText, FolderDown, LayoutDashboard,
  LogOut, Menu, Pencil, Plus, Save, Trash2, Upload, X, Zap,
} from '@lucide/vue'
import { createAdminApi, loginAdmin, logoutAdmin, restoreAdminSession } from './services/admin.js'
import { renderMarkdown } from './security/markdown.js'

const loginPassword = ref('')
const authenticated = ref(false)
const loading = ref(false)
const activeView = ref('overview')
const editorOpen = ref(false)
const menuOpen = ref(false)
const articles = ref([])
const resources = ref([])
const message = ref('')
const error = ref('')
const uploadFile = ref(null)
const resourceFileInput = ref(null)
const isDevelopment = import.meta.env.DEV

const emptyArticle = () => ({
  id: '',
  title: '',
  type: '作品档案',
  date: new Date().toISOString().slice(0, 10),
  excerpt: '',
  readTime: '5 分钟',
  color: '#df4f3b',
  image: '/images/anti-utopia-1600.webp',
  markdown: '## 新文章\n\n从这里开始写正文。',
  status: 'draft',
})

const articleForm = reactive(emptyArticle())
const resourceForm = reactive({ name: '', tag: '二创资源', meta: '' })

const nav = [
  { id: 'overview', label: '概览', icon: LayoutDashboard },
  { id: 'articles', label: '文章管理', icon: FileText },
  { id: 'resources', label: '二创资源', icon: FolderDown },
]

const markdownPreview = computed(() => renderMarkdown(articleForm.markdown))
const publishedCount = computed(() => articles.value.filter((article) => article.status === 'published').length)
const draftCount = computed(() => articles.value.filter((article) => article.status === 'draft').length)
const api = createAdminApi(() => { authenticated.value = false })

async function loadContent() {
  loading.value = true
  error.value = ''
  try {
    const content = await api('/api/admin/content')
    articles.value = content.articles
    resources.value = content.resources
    authenticated.value = true
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

async function login() {
  loading.value = true
  error.value = ''
  try {
    await loginAdmin(loginPassword.value)
    loginPassword.value = ''
    await loadContent()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

async function logout() {
  error.value = ''
  try {
    await logoutAdmin()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loginPassword.value = ''
    authenticated.value = false
  }
}

function notify(text) {
  message.value = text
  setTimeout(() => { message.value = '' }, 2400)
}

async function handleMutationError(requestError) {
  if (requestError.status === 409) {
    await loadContent()
    error.value = `${requestError.message}；列表已刷新，请确认后再次保存`
    return
  }
  error.value = requestError.message
}

function scrollToTop() {
  const root = document.documentElement
  const previousBehavior = root.style.scrollBehavior
  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, 0)
  root.style.scrollBehavior = previousBehavior
}

async function scrollToTopAfterRender() {
  await nextTick()
  scrollToTop()
}

function setView(view) {
  activeView.value = view
  editorOpen.value = false
  menuOpen.value = false
  scrollToTopAfterRender()
}

function newArticle() {
  Object.assign(articleForm, emptyArticle())
  editorOpen.value = true
  activeView.value = 'articles'
  scrollToTopAfterRender()
}

function editArticle(article) {
  Object.assign(articleForm, article)
  editorOpen.value = true
  activeView.value = 'articles'
  scrollToTopAfterRender()
}

async function saveArticle() {
  loading.value = true
  error.value = ''
  try {
    const { id, createdAt, updatedAt, ...editableArticle } = articleForm
    const payload = JSON.stringify(editableArticle)
    const path = articleForm.id ? `/api/admin/articles/${articleForm.id}` : '/api/admin/articles'
    const method = articleForm.id ? 'PUT' : 'POST'
    const { article: saved } = await api(path, { method, body: payload })
    const index = articles.value.findIndex((article) => article.id === saved.id)
    if (index === -1) articles.value.unshift(saved)
    else articles.value[index] = saved
    Object.assign(articleForm, saved)
    notify(saved.status === 'published' ? '文章已发布' : '草稿已保存')
  } catch (requestError) {
    await handleMutationError(requestError)
  } finally {
    loading.value = false
  }
}

async function removeArticle(article) {
  if (!window.confirm(`确定删除《${article.title}》吗？此操作无法撤销。`)) return
  try {
    await api(`/api/admin/articles/${article.id}`, { method: 'DELETE' })
    articles.value = articles.value.filter((item) => item.id !== article.id)
    editorOpen.value = false
    notify('文章已删除')
  } catch (requestError) {
    await handleMutationError(requestError)
  }
}

function selectFile(event) {
  uploadFile.value = event.target.files?.[0] || null
  if (uploadFile.value && !resourceForm.name) resourceForm.name = uploadFile.value.name.replace(/\.[^.]+$/, '')
}

async function uploadResource() {
  if (!uploadFile.value) {
    error.value = '请先选择文件'
    return
  }
  loading.value = true
  error.value = ''
  const formData = new FormData()
  formData.append('file', uploadFile.value)
  formData.append('name', resourceForm.name)
  formData.append('tag', resourceForm.tag)
  formData.append('meta', resourceForm.meta)
  try {
    const { resource: saved } = await api('/api/admin/resources', { method: 'POST', body: formData })
    resources.value.unshift(saved)
    Object.assign(resourceForm, { name: '', tag: '二创资源', meta: '' })
    uploadFile.value = null
    if (resourceFileInput.value) resourceFileInput.value.value = ''
    notify('资源已上传并公开')
  } catch (requestError) {
    await handleMutationError(requestError)
  } finally {
    loading.value = false
  }
}

async function removeResource(resource) {
  if (!window.confirm(`确定删除“${resource.name}”及其文件吗？`)) return
  try {
    await api(`/api/admin/resources/${resource.id}`, { method: 'DELETE' })
    resources.value = resources.value.filter((item) => item.id !== resource.id)
    notify('资源已删除')
  } catch (requestError) {
    await handleMutationError(requestError)
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

function handleKeydown(event) {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  loading.value = true
  try {
    if (await restoreAdminSession()) await loadContent()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <main v-if="!authenticated" class="admin-login">
    <section class="login-panel">
      <div class="admin-logo"><span><Zap :size="18" fill="currentColor" /></span><b>UTOPIA / CONTROL</b></div>
      <p class="admin-kicker">ADMIN ACCESS</p>
      <h1>内容管理后台</h1>
      <p>管理创作文章、Markdown 草稿和二创下载资源。</p>
      <form @submit.prevent="login">
        <label>管理密码<input v-model="loginPassword" type="password" autocomplete="current-password" placeholder="输入管理密码" required /></label>
        <button type="submit" :disabled="loading">进入后台 <ChevronRight :size="18" /></button>
      </form>
      <small v-if="isDevelopment">开发环境默认密码：<code>utopia-dev</code></small>
      <p v-if="error" class="form-error">{{ error }}</p>
      <a href="/"><ArrowLeft :size="16" /> 返回主站</a>
    </section>
  </main>

  <div v-else class="admin-shell">
    <aside id="admin-navigation" :class="['admin-sidebar', { open: menuOpen }]">
      <div class="admin-logo"><span><Zap :size="18" fill="currentColor" /></span><b>UTOPIA / CONTROL</b></div>
      <nav>
        <button v-for="item in nav" :key="item.id" :class="{ active: activeView === item.id }" @click="setView(item.id)">
          <component :is="item.icon" :size="18" />{{ item.label }}
        </button>
      </nav>
      <div class="sidebar-bottom">
        <a href="/" target="_blank"><ArrowLeft :size="17" />查看主站</a>
        <button @click="logout"><LogOut :size="17" />退出登录</button>
      </div>
    </aside>
    <button v-if="menuOpen" class="admin-backdrop" aria-label="关闭导航" @click="menuOpen = false"></button>

    <section class="admin-workspace">
      <header class="admin-topbar">
        <button class="admin-menu" :title="menuOpen ? '关闭导航' : '打开导航'" :aria-expanded="menuOpen" aria-controls="admin-navigation" @click="menuOpen = !menuOpen"><X v-if="menuOpen"/><Menu v-else/></button>
        <div><span>UTOPIA CONTENT SYSTEM</span><strong>{{ nav.find(item => item.id === activeView)?.label }}</strong></div>
        <button class="new-command" @click="newArticle"><Plus :size="17" />新建文章</button>
      </header>

      <div v-if="activeView === 'overview'" class="admin-page">
        <div class="admin-page-title"><div><span>OVERVIEW / 01</span><h1>工作概览</h1></div><p>内容数据保存在服务器，公开站只读取已发布内容。</p></div>
        <section class="metric-grid">
          <div><small>已发布文章</small><strong>{{ publishedCount }}</strong><span>PUBLIC ARTICLES</span></div>
          <div><small>待完成草稿</small><strong>{{ draftCount }}</strong><span>DRAFTS</span></div>
          <div><small>下载资源</small><strong>{{ resources.length }}</strong><span>FILES</span></div>
        </section>
        <section class="recent-section">
          <div class="section-row-title"><h2>最近编辑</h2><button @click="setView('articles')">全部文章 <ChevronRight :size="16" /></button></div>
          <div v-if="articles.length" class="compact-list">
            <button v-for="article in articles.slice(0, 5)" :key="article.id" @click="editArticle(article)">
              <span :class="['status-dot', article.status]"></span><div><b>{{ article.title }}</b><small>{{ article.type }} · {{ formatDate(article.updatedAt) }}</small></div><span class="status-label">{{ article.status === 'published' ? '已发布' : '草稿' }}</span><ChevronRight :size="17" />
            </button>
          </div>
          <div v-else class="admin-empty"><FileText :size="30"/><p>还没有后台文章。</p><button @click="newArticle">创建第一篇</button></div>
        </section>
      </div>

      <div v-else-if="activeView === 'articles'" class="admin-page">
        <div class="admin-page-title"><div><span>JOURNAL / 02</span><h1>{{ editorOpen ? (articleForm.id ? '编辑文章' : '新建文章') : '文章管理' }}</h1></div><button v-if="editorOpen" class="quiet-button" @click="editorOpen = false"><ArrowLeft :size="16"/>返回列表</button></div>

        <div v-if="!editorOpen" class="content-table">
          <div class="table-head"><span>文章</span><span>状态</span><span>更新</span><span></span></div>
          <div v-for="article in articles" :key="article.id" class="table-row">
            <div><b>{{ article.title }}</b><small>{{ article.type }} · {{ article.date }}</small></div>
            <span :class="['status-chip', article.status]">{{ article.status === 'published' ? '已发布' : '草稿' }}</span>
            <time>{{ formatDate(article.updatedAt) }}</time>
            <div class="row-actions"><button title="编辑" @click="editArticle(article)"><Pencil :size="17"/></button><button class="danger" title="删除" @click="removeArticle(article)"><Trash2 :size="17"/></button></div>
          </div>
          <div v-if="!articles.length" class="admin-empty"><FileText :size="30"/><p>还没有后台文章。</p><button @click="newArticle">新建文章</button></div>
        </div>

        <form v-else class="article-editor" @submit.prevent="saveArticle">
          <div class="editor-fields">
            <div class="field-row"><label>标题<input v-model="articleForm.title" required placeholder="文章标题" /></label><label>状态<select v-model="articleForm.status"><option value="draft">草稿</option><option value="published">发布</option></select></label></div>
            <div class="field-row three"><label>分类<input v-model="articleForm.type" /></label><label>发布日期<input v-model="articleForm.date" type="date" /></label><label>阅读时间<input v-model="articleForm.readTime" /></label></div>
            <label>摘要<textarea v-model="articleForm.excerpt" rows="2" placeholder="用于文章列表和搜索结果"></textarea></label>
            <div class="field-row"><label>封面路径<input v-model="articleForm.image" placeholder="/images/cover.webp" /></label><label class="color-field">强调色<input v-model="articleForm.color" type="color" /></label></div>
            <label class="markdown-field">Markdown 正文<textarea v-model="articleForm.markdown" spellcheck="false"></textarea></label>
          </div>
          <aside class="markdown-preview"><span>PREVIEW</span><h1>{{ articleForm.title || '未命名文章' }}</h1><p class="preview-excerpt">{{ articleForm.excerpt }}</p><div v-html="markdownPreview"></div></aside>
          <div class="editor-actions"><button v-if="articleForm.id" type="button" class="delete-command" @click="removeArticle(articleForm)"><Trash2 :size="17"/>删除</button><button type="submit" class="save-command" :disabled="loading"><Save :size="17"/>{{ articleForm.status === 'published' ? '保存并发布' : '保存草稿' }}</button></div>
        </form>
      </div>

      <div v-else class="admin-page">
        <div class="admin-page-title"><div><span>DOWNLOADS / 03</span><h1>二创资源</h1></div><p>上传后文件会立即出现在主站下载区。</p></div>
        <section class="upload-panel">
          <div class="upload-heading"><Upload :size="22"/><div><h2>上传新资源</h2><p>最大 100 MB，支持 MIDI、音频、压缩包、图片、PDF 和 PSD。</p></div></div>
          <form @submit.prevent="uploadResource">
            <label class="file-drop" for="resource-file"><input id="resource-file" ref="resourceFileInput" type="file" required @change="selectFile"/><Upload :size="24"/><b>{{ uploadFile?.name || '选择文件' }}</b><span>{{ uploadFile ? `${Math.ceil(uploadFile.size / 1024)} KB` : '点击浏览本地文件' }}</span></label>
            <div class="resource-fields"><label>显示名称<input v-model="resourceForm.name" required placeholder="例如：《歌曲名》人声 MIDI"/></label><label>标签<input v-model="resourceForm.tag" /></label><label>补充说明<input v-model="resourceForm.meta" placeholder="格式、版本或使用范围"/></label></div>
            <button class="save-command" type="submit" :disabled="loading"><Upload :size="17"/>上传并公开</button>
          </form>
        </section>
        <section class="resource-list">
          <div class="section-row-title"><h2>已上传资源</h2><span>{{ resources.length }} FILES</span></div>
          <div v-for="resource in resources" :key="resource.id" class="resource-row"><span class="file-mark"><FolderDown :size="19"/></span><div><b>{{ resource.name }}</b><small>{{ resource.meta }} · {{ Math.ceil(resource.size / 1024) }} KB</small></div><span class="status-chip published">{{ resource.tag }}</span><a :href="resource.downloadUrl" :download="resource.downloadName" title="下载"><FolderDown :size="17"/></a><button class="danger" title="删除" @click="removeResource(resource)"><Trash2 :size="17"/></button></div>
          <div v-if="!resources.length" class="admin-empty"><FolderDown :size="30"/><p>还没有通过后台上传的资源。</p></div>
        </section>
      </div>
    </section>

    <div v-if="error" class="admin-toast error"><X :size="18"/>{{ error }}<button @click="error = ''"><X :size="15"/></button></div>
    <div v-if="message" class="admin-toast"><Check :size="18"/>{{ message }}</div>
  </div>
</template>
