import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// `/` is the SKYGRID landing page; `/command` is the SkyGuard command center, untouched.
// Both are heavy, so each only loads when its route is the one on screen.
const Landing = lazy(() => import('./site/Landing.tsx'))
const App = lazy(() => import('./App.tsx'))
const SignIn = lazy(() => import('./components/ui/modern-login-signup.tsx'))
const isSignIn = window.location.pathname.startsWith('/signin')
const isCommand = window.location.pathname.startsWith('/command')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: isCommand ? '#0B0D10' : '#04070C' }} />}>
      {isCommand ? <App /> : isSignIn ? <SignIn /> : <Landing />}
    </Suspense>
  </StrictMode>,
)
