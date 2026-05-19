# Ships Flight Sim

A browser-based 3D flight simulator with realistic physics, multiple flyable planes, tweakable parameters, and optional multiplayer support.

![Flight Sim](flight-sim3.html)

## Features
- Real-time aerodynamics and flight model (pitch/roll/yaw authority, stalls, ground handling)
- Multiple aircraft: F-14, A-10 Warthog, prop planes, stunt planes, drones
- In-browser plane tweaks and world designer tools
- Autopilot and self-evolving AI features
- Multiplayer server support (ghosts, rooms)
- Static deploy ready (Netlify/Vercel)

## Quick Start (Local)
```bash
bun install
bun run build          # produces dist/ with game.html + assets
bun run preview:dist   # serve the built game
```

Or run the dev servers:
```bash
bun run start          # tweaks + multiplayer servers
```

## Deploy
Configured for Netlify (see `netlify.toml`):
- `bun run build` → `dist/`
- Models and audio are cached long-term
- Push to Netlify or any static host

## Project Structure
- `flight-sim3.html` — main client (self-contained game)
- `tools/build-game.mjs` — packaging/obfuscation step for release
- `tweaks-server.mjs` / `multiplayer-server.mjs` — optional backend
- `models/` — GLB assets (small required ones committed)
- `archive/` — historical versions and experiments

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md)

## License
MIT — see [LICENSE](LICENSE)

---

Built with ❤️ for the love of flight sims and browser tech. Fly safe.