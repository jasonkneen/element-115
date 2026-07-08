# Element-115

A browser-based 3D flight simulator with realistic physics, multiple flyable planes, tweakable parameters, and optional multiplayer support.

<img width="900" height="513" alt="6Jm01kXskK9mjQY9" src="https://github.com/user-attachments/assets/a49d8c5a-2a03-41b7-9368-a6d20db65509" />


## Features
- Real-time aerodynamics and flight model (pitch/roll/yaw authority, stalls, ground handling)
- Multiple aircraft: F-14, prop planes, stunt planes, drones
- In-browser plane tweaks and world designer tools
- Autopilot support
- Multiplayer server support (ghosts, rooms)
- Static deploy ready (Netlify/Vercel)

## Quick Start (Local)
```bash
bun install
bun run assemble       # rebuild flight-sim3.html from src/game modules
bun run build          # assemble + produce dist/ with game.html + assets
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
- `src/game/*.js` — **source of truth** for game logic (21 modules)
- `src/shell/` — HTML/CSS shell around the game IIFE
- `flight-sim3.html` — assembled client (`bun run assemble`)
- `tools/assemble-game.mjs` — stitch modules → `flight-sim3.html`
- `tools/build-game.mjs` — assemble + packaging for release
- `tweaks-server.mjs` / `multiplayer-server.mjs` — optional backend
- `models/` — GLB assets (small required ones committed)
- `archive/` — historical versions and experiments

See [src/README.md](src/README.md) for the module map and edit rules.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md)

## License
MIT — see [LICENSE](LICENSE)

---

Built with ❤️ for the love of flight sims and browser tech. Fly safe.

## Credits

- **F-15 model**: ["Low poly F-15"](https://sketchfab.com/3d-models/low-poly-f-15-0c1cfa22d7094556914fcdfba75bef5d) by [SIpriv](https://sketchfab.com/sipriv), licensed [CC Attribution](https://creativecommons.org/licenses/by/4.0/).
