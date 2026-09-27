import { createApp } from 'vue'

const isAdmin = window.location.pathname.startsWith('/admin')
const [{ default: RootComponent }] = await Promise.all(
  isAdmin
    ? [import('./AdminApp.vue'), import('./style.css'), import('./admin.css')]
    : [import('./App.vue'), import('./style.css')],
)

createApp(RootComponent).mount('#app')
