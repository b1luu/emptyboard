type Props = {
  onStartNow: () => void;
  onStartCustom: () => void;
};

export function LandingPage({ onStartNow, onStartCustom }: Props) {
  return (
    <main className="relative mx-auto flex min-h-[88vh] w-full max-w-6xl items-center px-4 py-8 md:px-8">
      {/* Left doodle – rotation on wrapper, float on img so transforms don't fight */}
      <div className="pointer-events-none absolute -left-10 top-6 hidden rotate-[-8deg] md:block">
        <img
          src="/images/doodle-cat-faces.png"
          alt=""
          className="w-52 opacity-35 animate-float-a"
          style={{ animationDelay: "0.4s" }}
        />
      </div>

      {/* Right doodle / cat mascot – bounce in, then gentle float */}
      <div className="pointer-events-none absolute -right-8 bottom-0 hidden rotate-[4deg] md:block">
        <img
          src="/images/doodle-cat-sign.png"
          alt=""
          className="w-56 opacity-35 animate-bounce-then-float"
        />
      </div>

      <div className="w-full rounded-[2rem] border border-black bg-white p-8 text-black shadow-[8px_8px_0_0_rgba(0,0,0,0.9)] md:p-10">
        <p
          className="animate-slide-up-fade text-xs font-semibold uppercase tracking-[0.2em] text-black/70"
          style={{ animationDelay: "0ms" }}
        >
          EmptyBoard
        </p>

        <h2
          className="animate-slide-up-fade mt-3 text-3xl font-semibold tracking-tight md:text-5xl"
          style={{ animationDelay: "80ms" }}
        >
          Find an empty classroom
          <span className="block">without overthinking it.</span>
        </h2>

        <p
          className="animate-slide-up-fade mt-4 max-w-2xl text-sm leading-6 text-black/70"
          style={{ animationDelay: "160ms" }}
        >
          A minimal finder for UCSD. Start with rooms available now, or jump into custom date/time
          testing before opening the full recommendation list.
        </p>

        <div
          className="animate-slide-up-fade mt-8 grid gap-3 sm:grid-cols-2"
          style={{ animationDelay: "240ms" }}
        >
          <button
            onClick={onStartNow}
            className="rounded-2xl border border-black bg-black px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black/90"
          >
            Show rooms available now
          </button>
          <button
            onClick={onStartCustom}
            className="rounded-2xl border border-black bg-white px-4 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-black/5"
          >
            Choose custom date/time
          </button>
        </div>

        <div
          className="animate-slide-up-fade mt-6 flex flex-wrap items-center gap-3 text-xs text-black/60"
          style={{ animationDelay: "320ms" }}
        >
          <span className="rounded-full border border-black/20 px-3 py-1">Minimal mode</span>
          <span className="rounded-full border border-black/20 px-3 py-1">Deterministic results</span>
          <span className="rounded-full border border-black/20 px-3 py-1">Whiteboard doodle theme</span>
        </div>
      </div>
    </main>
  );
}
