function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-night-950">
      {/* Star field decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {[...Array(60)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.1,
            }}
          />
        ))}
      </div>

      {/* Logo / title */}
      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <svg
          className="h-20 w-20 drop-shadow-[0_0_20px_rgba(99,102,241,0.6)]"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="50" cy="50" r="45" fill="#0a0a1a" stroke="#6366f1" strokeWidth="3" />
          <circle cx="50" cy="50" r="8" fill="#f59e0b" />
          <circle cx="72" cy="35" r="4" fill="#c0c0c0" />
          <path
            d="M 20 60 Q 50 20 80 60"
            stroke="#6366f1"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </svg>

        <h1 className="bg-gradient-to-r from-indigo-400 via-violet-300 to-indigo-400 bg-clip-text text-6xl font-bold tracking-tight text-transparent drop-shadow-lg">
          DarkHorizon
        </h1>

        <p className="max-w-md text-lg text-night-200">
          Plan your astronomical observations — find the perfect dark sky site for tonight.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-full border border-night-700 bg-night-900/60 px-5 py-2 text-sm text-night-300 backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
          Sprint 1 — Scaffold complete
        </div>
      </div>
    </div>
  )
}

export default App
