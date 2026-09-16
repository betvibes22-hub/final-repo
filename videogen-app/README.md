# VideoGen — Free-Stack Script-to-Video Platform

A real, working script-to-video pipeline built entirely on genuinely free
services — no credit card required anywhere in this stack.

## The free stack this uses

| Step | Service | Cost | Notes |
|---|---|---|---|
| Script writing | [Groq](https://console.groq.com/keys) | Free, no card | 30 req/min, 14,400/day |
| Trend research (optional) | [Tavily](https://tavily.com) | Free, no card | 1,000 credits/month, resets |
| Voiceover | [ElevenLabs](https://elevenlabs.io) | Free, no card | ~10 min audio/month, **non-commercial only** |
| Visuals | Built-in placeholder | $0 | No signup needed |
| Hosting | [Render](https://render.com) | Free tier | Spins down after 15 min idle |

## What's actually here

```
├── app/
│   ├── page.tsx                 # Main UI
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── generate/route.ts    # Kicks off a generation job (uses Groq)
│       └── status/route.ts      # Poll job status
├── lib/
│   ├── providers/
│   │   ├── script-groq.ts       # Groq LLM script generation
│   │   ├── trends.ts            # Tavily trend research (optional)
│   │   ├── tts.ts               # ElevenLabs voiceover
│   │   ├── visuals.ts           # Placeholder visuals (swap for paid later)
│   │   └── compose.ts           # ffmpeg stitching
│   ├── jobs.ts                  # In-memory job queue
│   └── types.ts
├── package.json
├── next.config.js               # Fixes a known Next.js + ffmpeg build issue
├── .env.example                 # Every key this needs, all free
└── README.md
```

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in your free keys — see .env.example for where to get each one
npm run dev
```

## Deploying (Render)

Build command: `npm install && npm run build`
Start command: `npm start`

No subfolder — this repo's root IS the app root, unlike the earlier version.

## The ElevenLabs catch

Free tier is real and generous (~10 min/month) but **non-commercial only**.
Fine for testing and personal videos. If this project ever earns money,
you'll need to upgrade that one piece (from $5/mo) — nothing else in this
stack has that restriction.

## Visuals are placeholders by default

`VISUAL_PROVIDER=static-doodle` renders simple text-on-background frames
so the whole pipeline runs end-to-end for $0. Real AI-generated visuals
(Kling, Wan, etc.) all cost money — there's no free option for that step.
Swap it in `lib/providers/visuals.ts` when you're ready to spend on that.
