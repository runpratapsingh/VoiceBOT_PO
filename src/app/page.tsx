import VoiceBot from "@/components/VoiceBot";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-teal-500/30">
      {/* Hero Section */}
      <main className="relative flex flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-32 md:pt-32 md:pb-48">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-500/10 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full"></div>
        </div>

        <div className="max-w-4xl text-center space-y-8 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
            </span>
            Next-Gen D365 Assistant
          </div>
          
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50 leading-none">
            STREAMLINE YOUR <br/> <span className="text-teal-500">ERP.</span>
          </h1>
          
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-400 leading-relaxed">
            Nexus reimagines Business Central workflows. From instant purchase orders to inventory checks, your operations start with a single conversation.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <button className="px-8 py-4 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg shadow-teal-500/20">
              Start Ordering
            </button>
            <button className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl border border-white/10 transition-all backdrop-blur-md">
              View Inventory
            </button>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full mt-32">
          {[
             { title: "Smart Orders", desc: "Instant Purchase Orders synchronized with Business Central." },
             { title: "Voice Live", desc: "Talk to Nexus, our AI assistant, for real-time ERP support." },
             { title: "Automated Workflows", desc: "Tailor-made experiences crafted by intelligence, for you." }
          ].map((f, i) => (
            <div key={i} className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-sm hover:border-teal-500/50 transition-colors group">
              <h3 className="text-xl font-bold mb-2 group-hover:text-teal-400 transition-colors">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* VoiceBot Component */}
      <VoiceBot />

      {/* Footer */}
      <footer className="border-t border-white/5 bg-slate-950 px-6 py-12">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
           <div className="text-2xl font-black tracking-tighter">NEXUS <span className="text-teal-500">ERP</span></div>
           <div className="flex gap-8 text-sm text-slate-500 font-medium">
              <a href="#" className="hover:text-teal-400 transition-colors">Privacy</a>
              <a href="#" className="hover:text-teal-400 transition-colors">Terms</a>
              <a href="#" className="hover:text-teal-400 transition-colors">Support</a>
           </div>
           <div className="text-sm text-slate-600">© 2026 Nexus ERP Solutions</div>
        </div>
      </footer>
    </div>
  );
}
