export default function WelcomePage({ onEnterApp }) {
  return (
    <div className="velorah-container">
      {/* Fullscreen Looping Background Video (Vibrant & Bright) */}
      <video
        autoPlay
        loop
        muted
        playsInline
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4"
        className="velorah-bg-video"
      />

      {/* Pure Vertically & Horizontally Centered Hero Section */}
      <section className="velorah-pure-hero animate-fade-rise">
        <h1 className="velorah-heading">
          Where <em>dreams</em> rise <em>through the silence.</em>
        </h1>

        <p className="velorah-subtext animate-fade-rise-delay">
          We're designing tools for deep thinkers, bold creators, and quiet rebels. Amid the chaos,
          we build digital spaces for sharp focus and inspired work.
        </p>

        <button
          className="liquid-glass velorah-cta-lg animate-fade-rise-delay-2"
          onClick={() => onEnterApp('login')}
        >
          Begin Journey
        </button>
      </section>
    </div>
  );
}
