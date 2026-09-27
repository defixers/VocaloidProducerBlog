import { createApp } from 'vue'
import App from './App.vue'
import AdminApp from './AdminApp.vue'
import './style.css'
import './admin.css'

const RootComponent = window.location.pathname.startsWith('/admin') ? AdminApp : App

createApp(RootComponent).mount('#app')
