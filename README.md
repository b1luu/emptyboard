# EmptyBoard

**Empty classroom finder** powered by UCSD’s public [Schedule of Classes](https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudent.htm). Raw section rows are normalized into **meetings** (room + day + start/end), grouped by room, **merged for overlaps**, then subtracted from a configurable **daily window** (default **8:00–22:00** Pacific via `EMPTYBOARD_DAY_START_MIN` / `EMPTYBOARD_DAY_END_MIN`) to produce **free intervals**. No LLM on the hot path—warm queries aim for **sub‑200 ms**.

## Quick start

```bash
npm install
npm run sync -- --term=WI26 --subjects=CSE
npm run build
npm start
```

Open `http://localhost:3000`. Development (Vite + API):

```bash
npm run dev
```

## Full-quarter index

```bash
npm run sync -- --term=WI26
```

Writes `data/<TERM>.json` (gitignored).

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/terms` | Term list (scraped from public SOC) |
| `GET /api/rooms/free-now?term=SP26` | Rooms with a free slot **now** or **later today** (Pacific) |
| `GET /api/rooms/search?term=SP26&day=Tu&start=14:00&end=16:00` | Rooms with a **free interval that fully contains** `[start,end]` on that weekday |
| `GET /api/rooms/:roomId/availability?term=SP26` | Busy/free breakdown per weekday (`roomId` is opaque base64url) |

Common query params: `building`, `minFreeMin`, `whiteboard=1` (placeholder flag).

## Notes

- **Correctness** depends on how UCSD encodes days/times in HTML; edge cases (TBA, remote, arranged) are skipped.
- **Sunday** has no letter-day code; use **search** with an explicit weekday instead of “open now”.
- **Whiteboard** is a UI/API placeholder until building metadata exists.
