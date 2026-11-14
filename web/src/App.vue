<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { bootstrap, changePassword, deleteFile, getFiles, getPublicConfig, login, logout, logoutAll, request, type PublicConfig, type RemoteFile, type User } from './api';
import { downloadFile, uploadFile, type TransferProgress } from './protocol';

interface Job { id: string; name: string; progress: number; status: string; error?: string }
interface AdminUser { id: string; username: string; role: 'user' | 'admin'; status: 'active' | 'disabled'; bandwidthBps: number | null; storageQuotaBytes: number; usedBytes: number; createdAt: string }

const user = ref<User | null>(null);
const loading = ref(true);
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const inviteCode = ref('');
const registerMode = ref(false);
const authError = ref('');
const files = ref<RemoteFile[]>([]);
const jobs = ref<Job[]>([]);
const pageError = ref('');
const adminUsers = ref<AdminUser[]>([]);
const busy = ref(false);
const publicConfig = ref<PublicConfig>({ registrationEnabled: true, inviteRequired: false, maxFileBytes: 0 });
const currentPassword = ref('');
const newPassword = ref('');
const newPasswordConfirm = ref('');
const accountMessage = ref('');
const accountError = ref(false);

const totalSize = computed(() => files.value.reduce((sum, file) => sum + file.size, 0));

onMounted(async () => {
  try { publicConfig.value = await getPublicConfig(); user.value = await bootstrap(); if (user.value) await enterApp(); }
  finally { loading.value = false; }
});

async function authenticate() {
  authError.value = ''; busy.value = true;
  try {
    if (registerMode.value && password.value !== confirmPassword.value) throw new Error('两次输入的密码不一致');
    user.value = await login(username.value, password.value, registerMode.value, inviteCode.value);
    password.value = ''; confirmPassword.value = ''; inviteCode.value = ''; await enterApp();
  }
  catch (error) { authError.value = message(error); }
  finally { busy.value = false; }
}
async function enterApp() { await refreshFiles(); if (user.value?.role === 'admin') await loadAdminUsers(); }
async function signOut() { await logout(); user.value = null; files.value = []; adminUsers.value = []; }
async function refreshFiles() { try { files.value = await getFiles(); } catch (error) { pageError.value = message(error); } }

async function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = [...(input.files ?? [])]; input.value = '';
  if (!selected.length) return;
  const queue = selected.map((file) => ({ file, job: { id: crypto.randomUUID(), name: file.name, progress: 0, status: '排队中' } as Job }));
  jobs.value.unshift(...queue.map((item) => item.job));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++]!;
      try {
        await uploadFile(item.file, (progress) => updateJob(item.job, progress));
      } catch (error) { item.job.error = message(error); item.job.status = '上传失败'; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  await refreshFiles();
}
function updateJob(job: Job, progress: TransferProgress) { job.progress = Math.max(0, Math.min(100, progress.percent)); job.status = progress.status; }

async function download(file: RemoteFile) {
  const job: Job = { id: crypto.randomUUID(), name: file.name, progress: 0, status: '准备下载' }; jobs.value.unshift(job);
  try { await downloadFile(file, (progress) => updateJob(job, progress)); }
  catch (error) { job.error = message(error); job.status = '下载失败'; }
}
async function remove(file: RemoteFile) {
  if (!window.confirm(`确定删除“${file.name}”吗？此操作不可撤销。`)) return;
  try { await deleteFile(file.id); await refreshFiles(); }
  catch (error) { pageError.value = message(error); }
}
async function loadAdminUsers() { adminUsers.value = (await request<{users: AdminUser[]}>('/api/admin/users')).users; }
async function setBandwidth(item: AdminUser, value: string) {
  const mbps = value.trim() ? Number(value) : null;
  const bytesPerSecond = mbps === null ? null : Math.round(mbps * 1024 * 1024);
  try {
    await request(`/api/admin/users/${item.id}/settings`, { method: 'PATCH', body: JSON.stringify({ bandwidthBps: bytesPerSecond }) });
    await loadAdminUsers();
  } catch (error) { pageError.value = message(error); }
}
async function setQuota(item: AdminUser, value: string) {
  const gib = Number(value); if (!Number.isFinite(gib) || gib <= 0) return;
  try { await request(`/api/admin/users/${item.id}/settings`, { method: 'PATCH', body: JSON.stringify({ storageQuotaBytes: Math.round(gib * 1024 ** 3) }) }); await loadAdminUsers(); }
  catch (error) { pageError.value = message(error); }
}
async function setStatus(item: AdminUser, status: 'active' | 'disabled') {
  if (status === 'disabled' && !window.confirm(`禁用“${item.username}”会立即撤销其所有会话，是否继续？`)) return;
  try { await request(`/api/admin/users/${item.id}/settings`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadAdminUsers(); }
  catch (error) { pageError.value = message(error); }
}
async function setRole(item: AdminUser, role: 'user' | 'admin') {
  const action = role === 'admin' ? '提升为管理员' : '降为普通用户';
  if (!window.confirm(`确定将“${item.username}”${action}吗？该用户的现有登录会话会立即撤销。`)) return;
  try { await request(`/api/admin/users/${item.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); await loadAdminUsers(); }
  catch (error) { pageError.value = message(error); }
}
async function updatePassword() {
  accountMessage.value = ''; accountError.value = false;
  try {
    if (newPassword.value !== newPasswordConfirm.value) throw new Error('两次输入的新密码不一致');
    user.value = await changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = ''; newPassword.value = ''; newPasswordConfirm.value = ''; accountMessage.value = '密码已更新，其他会话已全部撤销。';
  } catch (error) { accountError.value = true; accountMessage.value = message(error); }
}
async function logoutEverywhere() { if (!window.confirm('确定撤销所有设备上的登录会话吗？')) return; await logoutAll(); user.value = null; files.value = []; }
function openAccountSecurity() { document.getElementById('account-security')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function formatBytes(value: number) { if (!value) return '0 B'; const units = ['B', 'KiB', 'MiB', 'GiB']; const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function message(error: unknown) { return error instanceof Error ? error.message : '发生未知错误'; }
</script>

<template>
  <main v-if="loading" class="center"><div class="loader"></div><p>正在建立安全会话…</p></main>
  <main v-else-if="!user" class="auth-shell">
    <section class="brand-panel">
      <div class="shield">S</div>
      <p class="eyebrow">SOFTWARE & SYSTEM SECURITY · LAB 1B</p>
      <h1>Sentinel<br>Transfer</h1>
      <p class="lead">端到端传输保护、可恢复分块与可验证完整性，全部建立在自定义 WSS 应用层协议之上。</p>
      <ul class="security-list"><li>TLS 1.2+ 加密信道</li><li>SHA-256 分块及整文件校验</li><li>单次 WebSocket 票据</li><li>服务端隔离存储与审计</li></ul>
    </section>
    <section class="auth-card">
      <p class="eyebrow">{{ registerMode ? 'CREATE ACCOUNT' : 'SECURE SIGN IN' }}</p>
      <h2>{{ registerMode ? '创建新账户' : '欢迎回来' }}</h2>
      <form @submit.prevent="authenticate">
        <label>用户名<input v-model="username" autocomplete="username" minlength="3" maxlength="32" required placeholder="3–32 个字符"></label>
        <label>密码<input v-model="password" :autocomplete="registerMode ? 'new-password' : 'current-password'" type="password" minlength="12" maxlength="128" required placeholder="至少 12 位"></label>
        <label v-if="registerMode">确认密码<input v-model="confirmPassword" autocomplete="new-password" type="password" minlength="12" maxlength="128" required placeholder="再次输入密码"></label>
        <label v-if="registerMode && publicConfig.inviteRequired">邀请码<input v-model="inviteCode" type="password" maxlength="128" required autocomplete="off"></label>
        <p v-if="registerMode" class="hint">须包含大写、小写字母、数字和特殊字符。公开注册只能创建普通用户；管理员须在服务器本机安全初始化。</p>
        <p v-if="authError" class="error" role="alert">{{ authError }}</p>
        <button class="primary" :disabled="busy">{{ busy ? '安全验证中…' : registerMode ? '创建账户' : '登录' }}</button>
      </form>
      <button v-if="publicConfig.registrationEnabled || registerMode" class="text-button" @click="registerMode = !registerMode">{{ registerMode ? '已有账户？返回登录' : '没有账户？立即注册' }}</button>
      <p v-else class="hint">公开注册已关闭，请联系管理员创建或开放账户。</p>
    </section>
  </main>

  <main v-else class="app-shell">
    <header>
      <div class="wordmark"><span class="shield small">S</span><div><strong>Sentinel Transfer</strong><small>WSS / PROTOCOL V1</small></div></div>
      <div class="user-menu"><span><b>{{ user.username }}</b><small>{{ user.role === 'admin' ? '管理员' : '标准用户' }}</small></span><button class="ghost" @click="openAccountSecurity">修改密码</button><button class="ghost" @click="signOut">退出</button></div>
    </header>
    <section class="hero">
      <div><p class="eyebrow">ENCRYPTED FILE VAULT</p><h1>安全文件空间</h1><p>{{ files.length }} 个文件 · {{ formatBytes(totalSize) }} · 所有权隔离已启用</p></div>
      <label class="upload-button">选择文件上传<input type="file" multiple @change="selectFiles"></label>
    </section>
    <p v-if="pageError" class="error banner" role="alert">{{ pageError }} <button @click="pageError = ''">关闭</button></p>

    <section v-if="jobs.length" class="panel jobs-panel">
      <div class="section-title"><h2>传输任务</h2><button class="text-button" @click="jobs = jobs.filter((j) => j.progress < 100 && !j.error)">清除已完成</button></div>
      <div v-for="job in jobs" :key="job.id" class="job">
        <div class="job-meta"><strong>{{ job.name }}</strong><span :class="{ danger: job.error }">{{ job.status }} · {{ job.progress.toFixed(0) }}%</span></div>
        <div class="progress"><i :style="{ width: `${job.progress}%` }" :class="{ failed: job.error }"></i></div>
      </div>
    </section>

    <section class="panel">
      <div class="section-title"><div><p class="eyebrow">FILES</p><h2>我的文件</h2></div><button class="ghost" @click="refreshFiles">刷新</button></div>
      <div v-if="!files.length" class="empty"><span>⇧</span><h3>还没有文件</h3><p>选择文件后，客户端会先计算 SHA-256，再开始可恢复的加密分块传输。</p></div>
      <div v-else class="file-table">
        <div class="table-head"><span>名称</span><span>大小</span><span>上传时间</span><span>SHA-256</span><span></span></div>
        <div v-for="file in files" :key="file.id" class="file-row">
          <span class="file-name"><i>F</i><b>{{ file.name }} <small>v{{ file.version }}</small></b></span><span>{{ formatBytes(file.size) }}</span><span>{{ formatDate(file.createdAt) }}</span><code :title="file.sha256">{{ file.sha256.slice(0, 12) }}…</code>
          <span class="actions"><button @click="download(file)">下载</button><button class="danger-button" @click="remove(file)">删除</button></span>
        </div>
      </div>
    </section>

    <section id="account-security" class="panel account-panel">
      <div class="section-title"><div><p class="eyebrow">ACCOUNT SECURITY</p><h2>账户安全</h2></div><button class="danger-button standalone" @click="logoutEverywhere">撤销所有设备会话</button></div>
      <form class="account-form" @submit.prevent="updatePassword">
        <label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        <label>确认新密码<input v-model="newPasswordConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>
        <button class="primary">更新密码</button>
      </form>
      <p v-if="accountMessage" :class="accountError ? 'error account-message' : 'hint account-message'" role="status">{{ accountMessage }}</p>
    </section>

    <section v-if="user.role === 'admin'" class="panel admin-panel">
      <div class="section-title"><div><p class="eyebrow">ADMIN</p><h2>用户安全与资源策略</h2></div><span class="muted">禁用立即撤销会话；配额包含已完成和传输中的文件</span></div>
      <div v-for="item in adminUsers" :key="item.id" class="admin-row"><span><b>{{ item.username }}</b><small>{{ item.role === 'admin' ? '管理员' : '普通用户' }} · {{ item.status === 'active' ? '已启用' : '已禁用' }} · 已用 {{ formatBytes(item.usedBytes) }}</small></span><div class="admin-controls"><label>MiB/s<input type="number" min="0.0625" max="1024" step="0.25" :value="item.bandwidthBps ? item.bandwidthBps / 1024 / 1024 : ''" @change="setBandwidth(item, ($event.target as HTMLInputElement).value)"></label><label>配额 GiB<input type="number" min="0.001" max="16384" step="0.25" :value="item.storageQuotaBytes / 1024 ** 3" @change="setQuota(item, ($event.target as HTMLInputElement).value)"></label><button v-if="item.username !== user?.username" class="ghost" @click="setRole(item, item.role === 'admin' ? 'user' : 'admin')">{{ item.role === 'admin' ? '降为普通用户' : '提升为管理员' }}</button><button :class="item.status === 'active' ? 'danger-button standalone' : 'ghost'" @click="setStatus(item, item.status === 'active' ? 'disabled' : 'active')">{{ item.status === 'active' ? '禁用' : '启用' }}</button></div></div>
    </section>
    <footer>Sentinel Transfer · 所有文件以随机磁盘标识存储 · 安全事件已记录到不可由客户端修改的审计日志</footer>
  </main>
</template>

