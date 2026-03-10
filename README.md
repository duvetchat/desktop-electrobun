# Desktop (Electrobun)

Este proyecto desktop usa Electrobun + SvelteKit.

## Estructura

- `src/bun`: proceso principal de Electrobun.
- `src/mainview`: app SvelteKit (migrada desde el antiguo `frontend`).

## Comandos

- `bun run dev`: compila `mainview` y levanta Electrobun en desarrollo.
- `bun run build`: compila `mainview` y genera build de Electrobun.
- `bun run check`: ejecuta `svelte-check` del frontend.
- `bun run lint`: ejecuta ESLint del frontend.

## Notas

- Si `electrobun build` falla descargando el CLI en entornos Git Bash/MSYS, prueba ejecutar el comando desde PowerShell o CMD nativo.
