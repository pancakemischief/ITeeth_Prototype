import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { supabase } from './lib/supabaseClient'

// Expose supabase to window in development for console testing & diagnostics
if (typeof window !== 'undefined') {
  window.supabase = supabase;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
