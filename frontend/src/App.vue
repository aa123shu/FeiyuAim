<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileArchive,
  Heart,
  Home,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  PackageCheck,
  Search,
  ShieldCheck,
  Upload,
  User,
  X,
} from 'lucide-vue-next'
import { apiDownload, apiRequest, loadCommunityState, saveSessionToken } from './lib/api'

const categories = ['全部', '识别模型', '触控模型', '推理配置', '其他']
const state = reactive({
  user: null,
  models: [],
  myModels: [],
  favoriteModels: [],
  pendingModels: [],
  reports: [],
  comments: [],
  stats: { users: 0, approvedModels: 0, downloads: 0 },
})
const activeView = ref('discover')
const activeCategory = ref('全部')
const searchText = ref('')
const selectedModelId = ref(null)
const showAuth = ref(false)
const showUpload = ref(false)
const authMode = ref('login')
const authError = ref('')
const toast = ref('')
const commentText = ref('')
const reportReason = ref('')
const showReport = ref(false)
const uploadFile = ref(null)
const downloadState = reactive({ modelId: null, status: 'idle', loaded: 0, total: 0, percent: 0 })
let toastTimer
let downloadProgressTimer

const authForm = reactive({ username: '', password: '', nickname: '' })
const uploadForm = reactive({
  title: '',
  summary: '',
  description: '',
  category: '识别模型',
  framework: 'ONNX',
  version: '1.0.0',
  tags: '',
})

const currentUser = computed(() => state.user)
const selectedModel = computed(() => [...state.models, ...state.myModels].find((model) => model.id === selectedModelId.value) || null)
const selectedComments = computed(() => state.comments)
const pendingModels = computed(() => state.pendingModels)

const visibleModels = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  return state.models
    .filter((model) => model.status === 'approved')
    .filter((model) => activeCategory.value === '全部' || model.category === activeCategory.value)
    .filter((model) => {
      if (!query) return true
      return [model.title, model.summary, model.authorName, model.framework, ...(model.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
})

const myModels = computed(() => state.myModels)
const favoriteModels = computed(() => state.favoriteModels)

function applyLoadedState(loaded) {
  state.user = loaded.user
  state.models = loaded.models
  state.myModels = loaded.myModels
  state.favoriteModels = loaded.favoriteModels
  state.pendingModels = loaded.pendingModels
  state.reports = loaded.reports
  state.stats = loaded.stats
}

async function refreshCommunity() {
  applyLoadedState(await loadCommunityState())
}

function notify(message) {
  toast.value = message
  clearTimeout(toastTimer)
  // Keep important state changes visible long enough to be read on a phone.
  toastTimer = setTimeout(() => (toast.value = ''), 3600)
}

function requireUser(action) {
  if (currentUser.value) return true
  authMode.value = 'login'
  showAuth.value = true
  authError.value = ''
  notify(`登录后可${action}`)
  return false
}

function openModel(model) {
  selectedModelId.value = model.id
  commentText.value = ''
  showReport.value = false
  state.comments = []
  apiRequest('/models/' + encodeURIComponent(model.id) + '/comments')
    .then(({ comments }) => {
      if (selectedModelId.value === model.id) state.comments = comments
    })
    .catch((error) => notify(error.message || '评论加载失败'))
}

function closeModel() {
  selectedModelId.value = null
  showReport.value = false
}

async function submitAuth() {
  authError.value = ''
  const username = authForm.username.trim()
  const password = authForm.password
  if (!username || !password) {
    authError.value = '请输入账号和密码'
    return
  }

  try {
    const payload = authMode.value === 'login'
      ? await apiRequest('/auth/login', { method: 'POST', body: { username, password } })
      : await apiRequest('/auth/register', {
          method: 'POST',
          body: { username, password, nickname: authForm.nickname.trim() },
        })
    saveSessionToken(payload.token)
    await refreshCommunity()
    showAuth.value = false
    notify(authMode.value === 'login' ? '已登录：' + payload.user.nickname : '注册成功，已登录')
  } catch (error) {
    authError.value = error.message || '登录失败，请重试'
  }
}

function logout() {
  saveSessionToken('')
  state.user = null
  state.myModels = []
  state.favoriteModels = []
  state.pendingModels = []
  state.reports = []
  activeView.value = 'discover'
  notify('已退出登录')
}

function openUpload() {
  if (!requireUser('发布模型')) return
  showUpload.value = true
}

function onFileChange(event) {
  uploadFile.value = event.target.files?.[0] || null
}

async function submitUpload() {
  if (!uploadForm.title.trim() || !uploadForm.summary.trim() || !uploadFile.value) {
    notify('请填写标题、简介并选择模型文件')
    return
  }
  try {
    const form = new FormData()
    form.set('title', uploadForm.title.trim())
    form.set('summary', uploadForm.summary.trim())
    form.set('description', uploadForm.description.trim() || uploadForm.summary.trim())
    form.set('category', uploadForm.category)
    form.set('framework', uploadForm.framework.trim() || '其他')
    form.set('version', uploadForm.version.trim() || '1.0.0')
    form.set('tags', uploadForm.tags)
    form.set('file', uploadFile.value)
    await apiRequest('/models', { method: 'POST', body: form })
    await refreshCommunity()
    showUpload.value = false
    resetUploadForm()
    activeView.value = 'profile'
    notify('上传成功，已提交审核')
  } catch (error) {
    notify(error.message || '上传失败，请重试')
  }
}

function resetUploadForm() {
  Object.assign(uploadForm, {
    title: '',
    summary: '',
    description: '',
    category: '识别模型',
    framework: 'ONNX',
    version: '1.0.0',
    tags: '',
  })
  uploadFile.value = null
}

function modelFileName(model) {
  const rawName = String(model?.fileName || 'model.onnx')
  // Repair old records whose UTF-8 filename was decoded as Latin-1 by the
  // multipart parser. Correct Unicode names are left unchanged.
  let fileName = rawName
  if ([...rawName].every((character) => character.codePointAt(0) <= 0xff)) {
    try {
      const bytes = Uint8Array.from(rawName, (character) => character.codePointAt(0))
      fileName = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      fileName = rawName
    }
  }
  return fileName.replace(/[\\/]/g, '_') || 'model.onnx'
}

async function downloadModel(model) {
  if (downloadState.status === 'downloading' || downloadState.status === 'importing') return
  clearTimeout(downloadProgressTimer)
  Object.assign(downloadState, { modelId: model.id, status: 'downloading', loaded: 0, total: 0, percent: 0 })
  try {
    const blob = await apiDownload(
      '/models/' + encodeURIComponent(model.id) + '/download',
      ({ loaded, total, percent }) => Object.assign(downloadState, { loaded, total, percent }),
    )
    Object.assign(downloadState, { status: 'importing', loaded: blob.size, total: blob.size, percent: 100 })

    if (window.FatFishAndroid?.saveFile) {
      await nextTick()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      const base64 = String(dataUrl).split(',', 2)[1] || ''
      const result = window.FatFishAndroid.saveFile(modelFileName(model), model.fileType, base64)
      if (String(result).startsWith('ERROR:')) throw new Error(result)
      const importedMessage = String(result || '')
      notify(importedMessage.startsWith('已自动导入到已安装模型')
        ? importedMessage.replace('已自动导入到已安装模型', '已下载并导入到已安装模型')
        : importedMessage || '下载完成')
    } else {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = modelFileName(model)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notify('下载完成，文件已保存')
    }

    await refreshCommunity()
    downloadState.status = 'complete'
    downloadProgressTimer = setTimeout(() => Object.assign(downloadState, {
      modelId: null, status: 'idle', loaded: 0, total: 0, percent: 0,
    }), 3800)
  } catch (error) {
    const message = String(error?.message || '').replace(/^ERROR:/, '')
    notify(message || '模型导入失败，请重新尝试')
    downloadState.status = 'error'
    downloadProgressTimer = setTimeout(() => Object.assign(downloadState, {
      modelId: null, status: 'idle', loaded: 0, total: 0, percent: 0,
    }), 3800)
  }
}

function isLiked(model) {
  return Boolean(currentUser.value && model.isFavorited)
}

function likeCount(model) {
  return model.favoriteCount || 0
}

async function toggleLike(model) {
  if (!requireUser('收藏模型')) return
  try {
    const path = '/models/' + encodeURIComponent(model.id) + '/favorite'
    const result = model.isFavorited
      ? await apiRequest(path, { method: 'DELETE' })
      : await apiRequest(path, { method: 'PUT' })
    model.isFavorited = result.favorited
    model.favoriteCount = result.favoriteCount
    await refreshCommunity()
  } catch (error) {
    notify(error.message || '收藏操作失败')
  }
}

async function submitComment() {
  if (!requireUser('发表评论')) return
  const content = commentText.value.trim()
  if (!content) return
  try {
    const { comment } = await apiRequest('/models/' + encodeURIComponent(selectedModel.value.id) + '/comments', {
      method: 'POST',
      body: { content },
    })
    state.comments.push(comment)
    commentText.value = ''
    notify('评论已发布')
  } catch (error) {
    notify(error.message || '评论发布失败')
  }
}

async function submitReport() {
  if (!requireUser('提交举报')) return
  if (!reportReason.value.trim()) {
    notify('请填写举报原因')
    return
  }
  try {
    await apiRequest('/models/' + encodeURIComponent(selectedModel.value.id) + '/reports', {
      method: 'POST',
      body: { reason: reportReason.value.trim() },
    })
    reportReason.value = ''
    showReport.value = false
    notify('举报已提交，管理员会进行核查')
  } catch (error) {
    notify(error.message || '举报提交失败')
  }
}

async function reviewModel(model, status) {
  try {
    await apiRequest('/admin/models/' + encodeURIComponent(model.id) + '/review', {
      method: 'PATCH',
      body: { status },
    })
    await refreshCommunity()
    notify(status === 'approved' ? '已通过审核' : '已拒绝发布')
  } catch (error) {
    notify(error.message || '审核失败')
  }
}

async function reviewReport(report, status) {
  try {
    await apiRequest('/admin/reports/' + encodeURIComponent(report.id), {
      method: 'PATCH',
      body: { status },
    })
    await refreshCommunity()
    notify(status === 'resolved' ? '举报已标记为已处理' : '举报已忽略')
  } catch (error) {
    notify(error.message || '举报处理失败')
  }
}

function setView(view) {
  if ((view === 'profile' || view === 'admin') && !requireUser('查看该页面')) return
  if (view === 'admin' && currentUser.value?.role !== 'admin') return
  activeView.value = view
}

function formatSize(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

onMounted(() => {
  refreshCommunity().catch((error) => notify(error.message || '社区服务器暂不可用'))
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand-button" type="button" @click="setView('discover')">
        <img src="/assets/app-icon.png" alt="" />
        <span>肥鱼模型社区</span>
      </button>
      <nav class="desktop-nav" aria-label="主要导航">
        <button :class="{ active: activeView === 'discover' }" @click="setView('discover')">模型广场</button>
        <button :class="{ active: activeView === 'profile' }" @click="setView('profile')">个人中心</button>
        <button v-if="currentUser?.role === 'admin'" :class="{ active: activeView === 'admin' }" @click="setView('admin')">
          审核管理
          <span v-if="pendingModels.length" class="nav-count">{{ pendingModels.length }}</span>
        </button>
      </nav>
      <div class="account-actions">
        <button class="icon-button mobile-menu" type="button" title="菜单"><Menu :size="20" /></button>
        <button v-if="!currentUser" class="text-button" type="button" @click="showAuth = true"><LogIn :size="17" />登录</button>
        <button v-else class="user-chip" type="button" @click="setView('profile')">
          <span class="avatar">{{ currentUser.nickname.slice(0, 1) }}</span>
          <span>{{ currentUser.nickname }}</span>
        </button>
      </div>
    </header>

    <main>
      <template v-if="activeView === 'discover'">
        <section class="community-masthead">
          <div class="masthead-overlay">
            <p class="eyebrow">MODEL EXCHANGE</p>
            <h1>发现并分享设备模型</h1>
            <p>上传、审核、下载和交流都在一个页面完成。</p>
            <div class="masthead-actions">
              <label class="search-field">
                <Search :size="19" />
                <input v-model="searchText" type="search" placeholder="搜索模型、作者或标签" />
              </label>
              <button class="primary-button" type="button" @click="openUpload"><Upload :size="18" />发布模型</button>
            </div>
          </div>
        </section>

        <section class="content-layout">
          <aside class="category-panel">
            <div class="section-label">模型分类</div>
            <button
              v-for="category in categories"
              :key="category"
              :class="['category-button', { active: activeCategory === category }]"
              type="button"
              @click="activeCategory = category"
            >
              <span>{{ category }}</span>
              <span>{{ category === '全部' ? state.models.filter((m) => m.status === 'approved').length : state.models.filter((m) => m.status === 'approved' && m.category === category).length }}</span>
            </button>
            <div class="community-note">
              <ShieldCheck :size="19" />
              <div>
                <strong>发布前审核</strong>
                <span>用户上传后由管理员确认，再进入模型广场。</span>
              </div>
            </div>
          </aside>

          <section class="model-feed">
            <div class="feed-heading">
              <div>
                <h2>{{ activeCategory === '全部' ? '最新模型' : activeCategory }}</h2>
                <p>共 {{ visibleModels.length }} 个可下载模型</p>
              </div>
              <button class="secondary-button compact-upload" type="button" @click="openUpload"><Upload :size="17" />上传</button>
            </div>

            <div v-if="visibleModels.length" class="model-list">
              <article v-for="model in visibleModels" :key="model.id" class="model-row" @click="openModel(model)">
                <div class="model-icon"><img src="/assets/app-icon.png" alt="" /></div>
                <div class="model-main">
                  <div class="model-title-line">
                    <h3>{{ model.title }}</h3>
                    <span class="verified-label"><BadgeCheck :size="14" />已审核</span>
                  </div>
                  <p>{{ model.summary }}</p>
                  <div class="tag-line">
                    <span class="framework-tag">{{ model.framework }}</span>
                    <span v-for="tag in model.tags" :key="tag">{{ tag }}</span>
                  </div>
                  <div class="model-meta">
                    <span>{{ model.authorName }}</span>
                    <span>v{{ model.version }}</span>
                    <span>{{ formatDate(model.createdAt) }}</span>
                  </div>
                </div>
                <div class="model-stats">
                  <span><Download :size="16" />{{ model.downloads }}</span>
                  <span><Heart :size="16" />{{ likeCount(model) }}</span>
                  <ChevronRight :size="20" />
                </div>
              </article>
            </div>
            <div v-else class="empty-state">
              <Search :size="30" />
              <strong>没有找到对应模型</strong>
              <span>换一个关键词或分类试试。</span>
            </div>
          </section>

          <aside class="activity-panel">
            <div class="section-label">社区动态</div>
            <div class="metric-row"><span>已发布模型</span><strong>{{ state.stats.approvedModels }}</strong></div>
            <div class="metric-row"><span>社区成员</span><strong>{{ state.stats.users }}</strong></div>
            <div class="metric-row"><span>累计下载</span><strong>{{ state.stats.downloads }}</strong></div>
            <div class="activity-divider"></div>
            <div class="section-label">发布流程</div>
            <ol class="process-list">
              <li><span>1</span>填写模型信息并上传文件</li>
              <li><span>2</span>管理员检查说明与文件格式</li>
              <li><span>3</span>审核通过后进入模型广场</li>
            </ol>
          </aside>
        </section>
      </template>

      <section v-else-if="activeView === 'profile'" class="page-section profile-page">
        <div class="page-heading">
          <div>
            <p class="eyebrow">MY COMMUNITY</p>
            <h1>个人中心</h1>
            <p>管理发布记录、收藏和账号状态。</p>
          </div>
          <button class="secondary-button" type="button" @click="logout"><LogOut :size="17" />退出登录</button>
        </div>
        <div class="profile-summary">
          <span class="large-avatar">{{ currentUser?.nickname.slice(0, 1) }}</span>
          <div><strong>{{ currentUser?.nickname }}</strong><span>@{{ currentUser?.username }} · {{ currentUser?.role === 'admin' ? '管理员' : '社区用户' }}</span></div>
          <div class="profile-stat"><strong>{{ myModels.length }}</strong><span>我的发布</span></div>
          <div class="profile-stat"><strong>{{ favoriteModels.length }}</strong><span>我的收藏</span></div>
        </div>

        <div class="profile-grid">
          <section>
            <div class="feed-heading"><div><h2>我的发布</h2><p>上传的模型和审核状态</p></div><button class="primary-button small" @click="openUpload"><Upload :size="16" />发布</button></div>
            <div v-if="myModels.length" class="simple-list">
              <button v-for="model in myModels" :key="model.id" type="button" @click="openModel(model)">
                <FileArchive :size="22" />
                <span><strong>{{ model.title }}</strong><small>{{ modelFileName(model) }} · {{ formatSize(model.fileSize) }}</small></span>
                <em :class="`status-${model.status}`">{{ model.status === 'approved' ? '已通过' : model.status === 'rejected' ? '未通过' : '审核中' }}</em>
              </button>
            </div>
            <div v-else class="empty-inline">还没有发布模型。</div>
          </section>
          <section>
            <div class="feed-heading"><div><h2>我的收藏</h2><p>点赞收藏的社区模型</p></div></div>
            <div v-if="favoriteModels.length" class="simple-list">
              <button v-for="model in favoriteModels" :key="model.id" type="button" @click="openModel(model)">
                <Heart :size="22" class="heart-fill" />
                <span><strong>{{ model.title }}</strong><small>{{ model.authorName }} · {{ model.framework }}</small></span>
                <ChevronRight :size="18" />
              </button>
            </div>
            <div v-else class="empty-inline">点赞模型后会显示在这里。</div>
          </section>
        </div>
      </section>

      <section v-else class="page-section admin-page">
        <div class="page-heading">
          <div><p class="eyebrow">ADMIN REVIEW</p><h1>内容管理</h1><p>审核新模型并处理社区举报。</p></div>
          <span class="review-count">{{ pendingModels.length }} 个待审核 · {{ state.reports.filter((report) => report.status === 'open').length }} 条待处理举报</span>
        </div>
        <section class="admin-section">
          <div class="feed-heading"><div><h2>模型审核</h2><p>检查用户上传内容并决定是否发布。</p></div></div>
          <div v-if="pendingModels.length" class="review-list">
            <article v-for="model in pendingModels" :key="model.id">
              <div class="review-file"><FileArchive :size="27" /><span><strong>{{ modelFileName(model) }}</strong><small>{{ formatSize(model.fileSize) }} · {{ model.framework }}</small></span></div>
              <div class="review-copy"><h2>{{ model.title }}</h2><p>{{ model.summary }}</p><span>发布者：{{ model.authorName }} · {{ formatDate(model.createdAt) }}</span></div>
              <div class="review-actions"><button class="danger-button" @click="reviewModel(model, 'rejected')"><X :size="17" />拒绝</button><button class="primary-button" @click="reviewModel(model, 'approved')"><Check :size="17" />通过</button></div>
            </article>
          </div>
          <div v-else class="empty-inline">审核队列已清空。</div>
        </section>
        <section class="admin-section">
          <div class="feed-heading"><div><h2>用户举报</h2><p>查看举报原因并记录处理结果。</p></div></div>
          <div v-if="state.reports.length" class="review-list">
            <article v-for="report in state.reports" :key="report.id">
              <div class="review-file"><AlertTriangle :size="25" /><span><strong>{{ report.modelTitle }}</strong><small>举报人：{{ report.reporterName }} · {{ formatDate(report.createdAt) }}</small></span></div>
              <div class="review-copy"><h2>{{ report.status === 'open' ? '待处理举报' : report.status === 'resolved' ? '已处理' : '已忽略' }}</h2><p>{{ report.reason }}</p></div>
              <div v-if="report.status === 'open'" class="review-actions"><button class="text-button" @click="reviewReport(report, 'dismissed')">忽略</button><button class="primary-button" @click="reviewReport(report, 'resolved')"><Check :size="17" />已处理</button></div>
            </article>
          </div>
          <div v-else class="empty-inline">目前没有举报。</div>
        </section>
      </section>
    </main>

    <nav class="mobile-bottom-nav" aria-label="移动端导航">
      <button :class="{ active: activeView === 'discover' }" @click="setView('discover')"><Home :size="21" /><span>社区</span></button>
      <button @click="openUpload"><Upload :size="21" /><span>发布</span></button>
      <button :class="{ active: activeView === 'profile' }" @click="setView('profile')"><User :size="21" /><span>我的</span></button>
      <button v-if="currentUser?.role === 'admin'" :class="{ active: activeView === 'admin' }" @click="setView('admin')"><ShieldCheck :size="21" /><span>审核</span></button>
    </nav>

    <div v-if="selectedModel" class="dialog-backdrop" @click.self="closeModel">
      <section class="detail-dialog" role="dialog" aria-modal="true" aria-label="模型详情">
        <header class="dialog-header">
          <button class="icon-button mobile-back" type="button" @click="closeModel"><ArrowLeft :size="21" /></button>
          <div><p>{{ selectedModel.category }}</p><h2>{{ selectedModel.title }}</h2></div>
          <button class="icon-button" type="button" title="关闭" @click="closeModel"><X :size="21" /></button>
        </header>
        <div class="detail-scroll">
          <div class="detail-hero">
            <img src="/assets/app-icon.png" alt="" />
            <div>
              <span class="verified-label"><BadgeCheck :size="14" />已通过社区审核</span>
              <p>{{ selectedModel.summary }}</p>
              <div class="tag-line"><span class="framework-tag">{{ selectedModel.framework }}</span><span v-for="tag in selectedModel.tags" :key="tag">{{ tag }}</span></div>
            </div>
          </div>
          <div class="detail-facts">
            <div><span>版本</span><strong>v{{ selectedModel.version }}</strong></div>
            <div><span>大小</span><strong>{{ formatSize(selectedModel.fileSize) }}</strong></div>
            <div><span>下载</span><strong>{{ selectedModel.downloads }}</strong></div>
            <div><span>发布者</span><strong>{{ selectedModel.authorName }}</strong></div>
          </div>
          <section class="detail-section"><h3>模型说明</h3><p>{{ selectedModel.description }}</p></section>
          <section class="detail-section comments-section">
            <div class="comments-heading"><h3>讨论 {{ selectedComments.length }}</h3><MessageCircle :size="19" /></div>
            <div class="comment-composer"><textarea v-model="commentText" rows="2" placeholder="说说你的测试结果或使用建议"></textarea><button class="secondary-button" @click="submitComment">发布</button></div>
            <div v-if="selectedComments.length" class="comment-list">
              <article v-for="comment in selectedComments" :key="comment.id"><span class="avatar small-avatar">{{ comment.authorName.slice(0, 1) }}</span><div><strong>{{ comment.authorName }}</strong><p>{{ comment.content }}</p><time>{{ formatDate(comment.createdAt) }}</time></div></article>
            </div>
            <div v-else class="empty-inline">还没有讨论，发布第一条评论。</div>
          </section>
          <section v-if="showReport" class="report-box"><label>举报原因<textarea v-model="reportReason" rows="3" placeholder="请说明问题，例如文件损坏、说明不实或违规内容"></textarea></label><div><button class="text-button" @click="showReport = false">取消</button><button class="danger-button" @click="submitReport">提交举报</button></div></section>
        </div>
        <footer class="detail-actions">
          <button class="icon-action" :class="{ liked: isLiked(selectedModel) }" @click="toggleLike(selectedModel)"><Heart :size="20" />{{ isLiked(selectedModel) ? '已收藏' : '收藏' }}</button>
          <button class="icon-action" @click="showReport = !showReport"><AlertTriangle :size="20" />举报</button>
          <div class="download-area">
            <button class="primary-button download-button" :disabled="downloadState.modelId === selectedModel.id && ['downloading', 'importing'].includes(downloadState.status)" @click="downloadModel(selectedModel)">
              <Download v-if="downloadState.modelId !== selectedModel.id || downloadState.status === 'idle'" :size="19" />
              <PackageCheck v-else-if="downloadState.status === 'complete'" :size="19" />
              <span>{{ downloadState.modelId === selectedModel.id && downloadState.status === 'downloading' ? `下载中 ${downloadState.percent}%` : downloadState.modelId === selectedModel.id && downloadState.status === 'importing' ? '正在导入模型' : downloadState.modelId === selectedModel.id && downloadState.status === 'complete' ? '已下载并导入' : '下载模型' }}</span>
            </button>
            <template v-if="downloadState.modelId === selectedModel.id && ['downloading', 'importing', 'complete'].includes(downloadState.status)">
              <div class="download-progress" role="progressbar" :aria-valuenow="downloadState.percent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${downloadState.percent}%` }"></span></div>
              <small>{{ downloadState.status === 'importing' ? '正在写入已安装模型…' : downloadState.status === 'complete' ? '已完成导入' : `${formatSize(downloadState.loaded)} / ${downloadState.total ? formatSize(downloadState.total) : '读取大小中'}` }}</small>
            </template>
          </div>
        </footer>
      </section>
    </div>

    <div v-if="showAuth" class="dialog-backdrop" @click.self="showAuth = false">
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-label="账号登录">
        <button class="icon-button close-button" @click="showAuth = false"><X :size="20" /></button>
        <img src="/assets/app-icon.png" alt="" />
        <p class="eyebrow">肥鱼账号</p>
        <h2>{{ authMode === 'login' ? '登录模型社区' : '创建社区账号' }}</h2>
        <p>{{ authMode === 'login' ? '登录后可以发布、收藏、评论和举报。' : '注册后即可与其他社区用户共享模型。' }}</p>
        <form @submit.prevent="submitAuth">
          <label v-if="authMode === 'register'">社区昵称<input v-model="authForm.nickname" autocomplete="nickname" placeholder="显示给其他用户的名称" /></label>
          <label>账号<input v-model="authForm.username" autocomplete="username" placeholder="请输入账号" /></label>
          <label>密码<input v-model="authForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" /></label>
          <div v-if="authError" class="form-error">{{ authError }}</div>
          <button class="primary-button wide" type="submit">{{ authMode === 'login' ? '登录' : '注册并登录' }}</button>
        </form>
        <button class="switch-auth" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'; authError = ''">{{ authMode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录' }}</button>
      </section>
    </div>

    <div v-if="showUpload" class="dialog-backdrop" @click.self="showUpload = false">
      <section class="upload-dialog" role="dialog" aria-modal="true" aria-label="上传模型">
        <header class="dialog-header"><div><p>MODEL PUBLISH</p><h2>发布模型</h2></div><button class="icon-button" @click="showUpload = false"><X :size="21" /></button></header>
        <form class="upload-form" @submit.prevent="submitUpload">
          <div class="form-row"><label>模型名称<input v-model="uploadForm.title" placeholder="例如：低延迟识别模型" /></label><label>版本号<input v-model="uploadForm.version" placeholder="1.0.0" /></label></div>
          <label>一句话简介<input v-model="uploadForm.summary" maxlength="80" placeholder="说明模型特点和适用场景" /></label>
          <label>详细说明<textarea v-model="uploadForm.description" rows="4" placeholder="兼容设备、使用方法、参数建议和已知问题"></textarea></label>
          <div class="form-row"><label>分类<select v-model="uploadForm.category"><option v-for="category in categories.slice(1)" :key="category">{{ category }}</option></select></label><label>模型格式<select v-model="uploadForm.framework"><option>ONNX</option><option>TFLite</option><option>NCNN</option><option>PyTorch</option><option>TensorRT</option><option>其他</option></select></label></div>
          <label>标签<input v-model="uploadForm.tags" placeholder="稳定, MTK, 低延迟（最多 6 个）" /></label>
          <label class="file-picker"><input type="file" accept=".onnx,.bin,.param,.json,.zip,.pt,.tflite,.model" @change="onFileChange" /><FileArchive :size="27" /><span><strong>{{ uploadFile?.name || '选择模型文件' }}</strong><small>{{ uploadFile ? formatSize(uploadFile.size) : '支持 ONNX、TFLite、NCNN、JSON、ZIP 等常见格式' }}</small></span></label>
          <div class="publish-note"><Clock3 :size="18" /><span>提交后进入审核队列，管理员通过后才会公开显示。</span></div>
          <button class="primary-button wide" type="submit"><Upload :size="18" />提交审核</button>
        </form>
      </section>
    </div>

    <transition name="toast"><div v-if="toast" class="toast-message">{{ toast }}</div></transition>
  </div>
</template>
