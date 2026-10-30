# VeloPool

3D 8-ball pool in the browser: Three.js rendering, a custom rigid-body engine (ball spin, sliding/rolling friction, cushion and pocket physics), standard 8-ball rules, a CPU opponent, and a UI built on Apple's Human Interface Guidelines (glass materials, SF system fonts, 44pt touch targets, light/dark mode, safe areas).

## Controls
| | Desktop | Touch |
|---|---|---|
| Aim | Drag / `←` `→` (hold `Shift` for fine) | Drag, or the *Fine aim* strip |
| Camera | `Shift`/right-drag orbit, wheel zoom, `V` 2D/3D | Look toggle, pinch zoom, 2D/3D button |
| Power | Pull the power bar down and release (or hold `Space`) | Pull the bar down and release, or tap **Shoot** |
| Spin | Cue-ball button | Cue-ball button |
| Ball in hand | Drag the cue ball, then **Place** / `Enter` | Same |

## Develop
```
npm install
npm run dev
npm run build   # production bundle in dist/
```

## Deploy (Vercel, production only)
`vercel.json` skips every non-production build (`ignoreCommand`), so preview deployments are never built.
`npm run deploy` runs `vercel deploy --prod` and then `scripts/prune-deployments.mjs`, which deletes all older production deployments (needs `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`).
