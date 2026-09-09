import { useEffect, useRef } from 'react'
import './site.css'
import { mountScene, setMode } from './scene'
import {
  Accountability, AskTheGrid, Audience, Climb, DroneView, Emergency, Finale, Footer, Government, Hero,
  Incidents, Intelligence, LandingNet, LiveFeed, Nav, Network, Ops,
} from './sections'

/** The whole page is one scene. Sections scroll over a fixed canvas and hand it the camera. */
export default function Landing() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const unmount = mountScene(canvas.current)
    document.title = 'SKYGRID · The operating system for the low-altitude world'
    // a hard reload mid-page should still open on the hero, not on a random beat
    history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    setMode('HERO')
    return unmount
  }, [])
  return (
    <div className="skygrid">
      <div className="sg-canvas-host"><canvas ref={canvas} /></div>
      <div className="sg-atmos" />
      <div className="sg-grid-overlay" />
      <Nav />
      <main className="sg-flow">
        <Hero />
        <Climb />
        <Ops />
        <DroneView />
        <LiveFeed />
        <Intelligence />
        <Incidents />
        <Emergency />
        <Government />
        <LandingNet />
        <AskTheGrid />
        <Accountability />
        <Audience />
        <Network />
        <Finale />
      </main>
      <Footer />
    </div>
  )
}
