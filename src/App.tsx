import { Analytics } from "@vercel/analytics/react"
import MapView from './components/MapView'

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-night-950">
      <main className="flex-1 overflow-hidden">
        <MapView />
      </main>
      <Analytics />
    </div>
  )
}
