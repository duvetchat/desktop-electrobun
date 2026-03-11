export function getHostURL(): string {
    const base = "duvet-api.andremor.eu.org";
    const protocol = "https://";

    return protocol + base;
}

export function getWSHostURL(): string {
    const base = "duvet-ws.andremor.eu.org";
    const protocol = "wss://";

    return protocol + base;
}

const isDevServer = import.meta.env.DEV;

const routes: Record<string, string> = {
    "/index.html": "/",
    "/app.html": "/app",
    "/sign-in.html": "/sign-in",
    "/sign-up.html": "/sign-up",
    "/forgot-password.html": "/forgot-password",
    "/invite.html": "/invite",
};

export function route(path: string): string {
    if (!isDevServer) return path;
    const [base, query] = path.split("?");
    const clean = routes[base] ?? base;
    return query ? `${clean}?${query}` : clean;
}

// export function getHostURL(): string {
//     const base = 'localhost:8080';
//     const protocol = 'http://';

//     return protocol + base;
// }

// export function getWSHostURL(): string {
//     const base = 'localhost:8081';
//     const protocol = 'ws://';

//     return protocol + base;
// }
