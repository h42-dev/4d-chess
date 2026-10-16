import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-symbols-2/symbols-400.css'
import './index.css'
import App from './App.tsx'

// Page-view stats (GoatCounter: no cookies, no personal data). Off unless VITE_GOATCOUNTER is set at build time.
const counter = import.meta.env.VITE_GOATCOUNTER
if (counter) {
  // Count the page, not its ?game= code, so private game links never show up in the stats.
  // A ?ref= tag on shared links (e.g. ?ref=hn) is reported as the referrer.
  Object.assign(window, { goatcounter: { path: () => location.pathname } })
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://gc.zgo.at/count.js'
  script.dataset.goatcounter = counter
  document.head.append(script)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
